import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AGENTS,
  CONFIG_FILE_NAME,
  PROTECTION_LEVELS,
  LEVEL_POLICIES,
  configSchema,
  detectProject,
  formatDiagnostic,
  hasErrors,
  loadProjectConfig,
  parseMasterFile,
  type ProtectionLevel,
} from "@aegis/core";
import { TEMPLATES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { exists, readRegularFile } from "../util/fs.js";
import { isTooBroad } from "../util/project-root.js";
import { resolveRoot } from "../util/resolve-root.js";
import { renderDoctor, runDoctor } from "./doctor.js";

type Agent = (typeof AGENTS)[number];

export interface InitOptions {
  level?: ProtectionLevel;
  agent?: Agent[];
  dryRun?: boolean;
  yes?: boolean;
}

const MASTER_FILE_NAME = "AEGIS.aegis";
const AGENT_LABELS: Record<Agent, string> = {
  "claude-code": "Claude Code",
  "github-copilot": "GitHub Copilot",
};

interface PlannedFile {
  name: string;
  content: string;
  /** "create" or "keep" (already exists, never modified). */
  action: "create" | "keep";
}

function buildConfigText(level: ProtectionLevel, agents: Agent[]): string {
  const config = configSchema.parse({
    version: 1,
    protectionLevel: level,
    masterFile: MASTER_FILE_NAME,
    agents,
  });
  return JSON.stringify(config, null, 2) + "\n";
}

/** Take the shipped master template, set the default level, and make sure the result is valid. */
async function buildMasterText(level: ProtectionLevel): Promise<string> {
  const template = await readRegularFile(path.join(TEMPLATES_DIR, MASTER_FILE_NAME));
  const text = template.replace(
    /^defaultProtectionLevel: .*$/m,
    `defaultProtectionLevel: ${level}`,
  );
  const parsed = parseMasterFile(text, MASTER_FILE_NAME);
  if (!parsed.ok) {
    throw new Error(
      `the bundled master template is invalid: ${parsed.diagnostics.map(formatDiagnostic).join("; ")}`,
    );
  }
  return text;
}

/**
 * Set up AEGIS in a project. Creates aegis.config.json and AEGIS.aegis, and NEVER overwrites
 * an existing file (files are created with an exclusive-create flag, so even a race cannot
 * overwrite one). Nothing is written without confirmation, --yes, or in --dry-run mode.
 */
export async function initCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: InitOptions,
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const { root } = resolved;
  if (!resolved.explicit && isTooBroad(root, rt.homeDir)) {
    rt.err(
      "aegis: refusing to initialize your home folder or the filesystem root. Move into a project folder, or pass a path.\n",
    );
    return 2;
  }

  // 1. Project
  rt.out(`Project folder: ${root}\n`);
  if (!resolved.explicit && !resolved.foundMarkers) {
    rt.out("  No project files were found, so the current folder is used.\n");
  }
  const profile = await detectProject(root);
  const lang =
    profile.languages.map((l) => `${l.name} (${l.confidence})`).join(", ") || "none detected";
  const fw =
    profile.frameworks.map((f) => `${f.name} (${f.confidence})`).join(", ") || "none detected";
  rt.out(`  Languages: ${lang}\n  Frameworks: ${fw}\n`);
  for (const u of profile.uncertainties) rt.out(`  Uncertain: ${u}\n`);
  rt.out("\n");

  // 2. Existing config
  const existing = await loadProjectConfig(root);
  if (existing.found && hasErrors(existing.diagnostics)) {
    rt.err(`aegis: the existing ${CONFIG_FILE_NAME} is invalid, so init will not continue:\n`);
    for (const d of existing.diagnostics) rt.err(`  ${formatDiagnostic(d)}\n`);
    rt.err("Fix the file (or move it away) and run init again. AEGIS never rewrites it for you.\n");
    return 2;
  }

  // 3. Protection level
  let level: ProtectionLevel;
  if (opts.level) {
    level = opts.level;
  } else if (existing.found) {
    level = existing.config.protectionLevel;
    rt.out(`Using the protection level from the existing ${CONFIG_FILE_NAME}: ${level}.\n`);
  } else if (rt.interactive) {
    const choices = PROTECTION_LEVELS.map((l) => `${l}: ${LEVEL_POLICIES[l].summary}`);
    level =
      PROTECTION_LEVELS[
        await rt.prompter.select("Which protection level do you want?", choices, 0)
      ] ?? "standard";
  } else {
    level = "standard";
    rt.out("No --level given and no terminal to ask, so 'standard' is used.\n");
  }

  // 4. Agents
  let agents: Agent[];
  if (opts.agent) {
    agents = [...new Set(opts.agent)];
  } else if (existing.found) {
    agents = existing.config.agents;
  } else if (rt.interactive) {
    const choices = ["Claude Code", "GitHub Copilot", "Both", "None or not sure yet"];
    const i = await rt.prompter.select("Which AI coding agent do you use?", choices, 3);
    agents =
      i === 0
        ? ["claude-code"]
        : i === 1
          ? ["github-copilot"]
          : i === 2
            ? ["claude-code", "github-copilot"]
            : [];
  } else {
    agents = [];
  }

  // 5. Plan. Existing files are kept as they are.
  const configPath = path.join(root, CONFIG_FILE_NAME);
  const masterPath = path.join(root, MASTER_FILE_NAME);
  const plan: PlannedFile[] = [
    {
      name: CONFIG_FILE_NAME,
      content: buildConfigText(level, agents),
      action: (await exists(configPath)) ? "keep" : "create",
    },
    {
      name: MASTER_FILE_NAME,
      content: await buildMasterText(level),
      action: (await exists(masterPath)) ? "keep" : "create",
    },
  ];

  rt.out("Plan:\n");
  for (const f of plan) {
    rt.out(
      f.action === "create"
        ? `  create  ${f.name}\n`
        : `  keep    ${f.name} (already exists, will not be modified)\n`,
    );
  }
  rt.out(
    `  protection level: ${level}\n  agents: ${agents.length > 0 ? agents.map((a) => AGENT_LABELS[a]).join(", ") : "none selected"}\n\n`,
  );

  const toCreate = plan.filter((f) => f.action === "create");
  if (opts.dryRun) {
    rt.out("Dry run: no files were written.\n");
    return 0;
  }
  if (toCreate.length === 0) {
    rt.out("Nothing to create: everything already exists.\n");
  } else {
    if (!opts.yes) {
      if (!rt.interactive) {
        rt.err(
          "aegis: not running in a terminal, so nothing was written. Re-run with --yes to create these files, or --dry-run to preview.\n",
        );
        return 2;
      }
      if (!(await rt.prompter.confirm("Create these files?"))) {
        rt.out("Nothing was changed.\n");
        return 0;
      }
    }
    for (const f of toCreate) {
      try {
        await writeFile(path.join(root, f.name), f.content, { flag: "wx", mode: 0o644 });
        rt.out(`Created ${f.name}\n`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST")
          rt.out(`Kept ${f.name}: it appeared while init was running, so it was not touched.\n`);
        else {
          rt.err(
            `aegis: could not write ${f.name}: ${err instanceof Error ? err.message : "unknown error"}\n`,
          );
          return 2;
        }
      }
    }
  }

  // 6. Initial diagnostic
  rt.out("\nDiagnostic:\n");
  const doctor = await runDoctor(rt, root);
  rt.out(renderDoctor(doctor));

  // 7. Next steps
  rt.out("\nNext steps:\n");
  rt.out(`  1. Read ${MASTER_FILE_NAME} and adjust it to your project.\n`);
  rt.out(
    "  2. Run 'aegis scan' to see what AEGIS detects. Until scanner integrations exist, the result is INCOMPLETE by design.\n",
  );
  rt.out("  3. Run 'aegis rules list' to see the protection rules.\n");
  if (agents.length > 0) {
    rt.out(
      "  4. Agent instruction files (CLAUDE.md, Copilot instructions) are NOT generated yet: that arrives in a later version. Your existing instruction files were not touched.\n",
    );
  }
  return doctor.ok ? 0 : 2;
}
