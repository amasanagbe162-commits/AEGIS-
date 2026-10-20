import type { DetectedItem, Evidence, ProjectDetector } from "../types.js";

const LOCKFILES: [string, string][] = [
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];

const ESLINT_CONFIG =
  /^(eslint\.config\.(js|mjs|cjs|ts|mts|cts)|\.eslintrc(\.(js|cjs|json|ya?ml))?)$/;
const NEXT_CONFIG = /^next\.config\.(js|mjs|cjs|ts)$/;

function item(
  name: string,
  confidence: DetectedItem["confidence"],
  ...evidence: Evidence[]
): DetectedItem {
  return { name, confidence, evidence };
}

function dependencyNames(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const section = pkg[key];
    if (section && typeof section === "object" && !Array.isArray(section)) {
      for (const name of Object.keys(section)) names.add(name);
    }
  }
  return names;
}

export const nodeDetector: ProjectDetector = {
  name: "node",
  async detect(ctx) {
    const out = {
      languages: [] as DetectedItem[],
      frameworks: [] as DetectedItem[],
      packageManagers: [] as DetectedItem[],
      tools: [] as DetectedItem[],
      uncertainties: [] as string[],
    };

    const hasManifest = ctx.has("package.json");
    const tsFiles = ctx.match(/\.(ts|tsx|mts|cts)$/).filter((f) => !f.endsWith(".d.ts"));
    const jsFiles = ctx.match(/\.(js|jsx|mjs|cjs)$/);
    const manifestEv: Evidence = { file: "package.json", detail: "file exists" };

    let deps = new Set<string>();
    if (hasManifest) {
      const text = await ctx.readText("package.json");
      try {
        const parsed: unknown = text === undefined ? undefined : JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          deps = dependencyNames(parsed as Record<string, unknown>);
        } else {
          out.uncertainties.push(
            "package.json is not a JSON object; dependencies were not analyzed.",
          );
        }
      } catch {
        out.uncertainties.push("package.json could not be parsed; dependencies were not analyzed.");
      }
      out.languages.push(item("javascript", "high", manifestEv));
    } else if (jsFiles.length > 0) {
      out.languages.push(
        item("javascript", "medium", {
          file: jsFiles[0] as string,
          detail: "JavaScript source file (no package.json)",
        }),
      );
    }

    // TypeScript
    const tsconfig = ctx.has("tsconfig.json");
    if (tsconfig) {
      out.languages.push(
        item("typescript", "high", { file: "tsconfig.json", detail: "file exists" }),
      );
    } else if (deps.has("typescript")) {
      out.languages.push(
        item("typescript", "medium", { file: "package.json", detail: "dependency 'typescript'" }),
      );
    } else if (tsFiles.length > 0) {
      out.languages.push(
        item("typescript", "medium", {
          file: tsFiles[0] as string,
          detail: "TypeScript source file",
        }),
      );
    }

    // Frameworks. A dependency alone is only medium confidence.
    if (hasManifest) {
      out.frameworks.push(item("node.js", "medium", manifestEv));
      if (deps.has("next")) {
        const cfg = ctx.files.find((f) => NEXT_CONFIG.test(f));
        const ev: Evidence[] = [{ file: "package.json", detail: "dependency 'next'" }];
        if (cfg) ev.push({ file: cfg, detail: "Next.js config file exists" });
        out.frameworks.push(item("next.js", cfg ? "high" : "medium", ...ev));
      }
      for (const [dep, name] of [
        ["express", "express"],
        ["react", "react"],
      ] as const) {
        if (deps.has(dep)) {
          out.frameworks.push(
            item(name, "medium", { file: "package.json", detail: `dependency '${dep}'` }),
          );
        }
      }
    }

    // Package managers
    const foundLocks = LOCKFILES.filter(([file]) => ctx.has(file));
    for (const [file, name] of foundLocks) {
      out.packageManagers.push(item(name, "high", { file, detail: "lockfile exists" }));
    }
    const distinct = new Set(foundLocks.map(([, name]) => name));
    if (distinct.size > 1) {
      out.uncertainties.push(
        `Multiple package managers have lockfiles (${[...distinct].join(", ")}).`,
      );
    }
    if (hasManifest && foundLocks.length === 0) {
      out.uncertainties.push("package.json has no lockfile, so the package manager is unknown.");
    }

    // Tools used by verification
    if (tsconfig) {
      out.tools.push(
        item("tsc", deps.has("typescript") ? "high" : "medium", {
          file: "tsconfig.json",
          detail: "file exists",
        }),
      );
    }
    const eslintCfg = ctx.files.find((f) => !f.includes("/") && ESLINT_CONFIG.test(f));
    if (eslintCfg)
      out.tools.push(item("eslint", "high", { file: eslintCfg, detail: "ESLint config exists" }));
    else if (deps.has("eslint")) {
      out.tools.push(
        item("eslint", "low", {
          file: "package.json",
          detail: "dependency 'eslint' (no config file found)",
        }),
      );
    }

    // Monorepo hint
    const nested = ctx.match(/(^|\/)package\.json$/).filter((f) => f !== "package.json");
    if (nested.length > 0) {
      out.uncertainties.push(
        `Found ${nested.length} nested package.json file(s); only the root manifest was analyzed.`,
      );
    }
    return out;
  },
};
