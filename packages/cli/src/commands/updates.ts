import { createPublicKey } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_BUNDLE_BYTES,
  activateStaged,
  discardStaged,
  formatDiagnostic,
  generateSigningKey,
  keyIdSchema,
  loadProjectConfig,
  loadRulesFromDir,
  signBundle,
  stageBundle,
  verifyBundle,
  hasErrors,
  type TrustedKey,
} from "@aegis/core";
import { RULES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { resolveRoot } from "../util/resolve-root.js";
import { BASELINE_RULES_VERSION, TRUSTED_KEYS, rulesInUse } from "../util/rules-source.js";

export async function rulesStatusCommand(
  rt: Runtime,
  pathArg: string | undefined,
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const cfg = await loadProjectConfig(resolved.root);
  const use = await rulesInUse(resolved.root);
  rt.out(
    `Rules in use: ${use.source} ${use.version}${use.keyId ? ` (signed by key '${use.keyId}')` : ""}\n`,
  );
  rt.out(`Baseline shipped with AEGIS: ${BASELINE_RULES_VERSION}\n`);
  if (use.warning) rt.out(`Warning: ${use.warning}\n`);
  rt.out(
    `Updates: ${cfg.config.updates.enabled ? "enabled" : "off (set updates.enabled to true in aegis.config.json to allow 'aegis rules update')"}\n`,
  );
  rt.out(`Update source: ${cfg.config.updates.source ?? "not set"}\n`);
  rt.out(
    `Trusted signing keys: ${TRUSTED_KEYS.length} built in, ${cfg.config.updates.trustedKeys.length} in aegis.config.json\n`,
  );
  return 0;
}

async function readLocalBundle(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile()) throw new Error("is not a regular file (symbolic links are not followed)");
  if (info.size > MAX_BUNDLE_BYTES) throw new Error("is too large for a rule bundle");
  return readFile(file, "utf8");
}

export interface UpdateOptions {
  source?: string;
  dryRun?: boolean;
  yes?: boolean;
}

/**
 * Optional, off by default. The only network request is one HTTPS GET of the bundle URL. Nothing
 * about the project is sent. The bundle is verified (signature, version, compatibility, rule
 * validation) before anything is written, and the rules in use stay in place until the swap.
 */
export async function rulesUpdateCommand(
  rt: Runtime,
  pathArg: string | undefined,
  opts: UpdateOptions,
): Promise<number> {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return 2;
  }
  const { root } = resolved;
  const cfg = await loadProjectConfig(root);
  if (hasErrors(cfg.diagnostics)) {
    rt.err(
      `aegis: aegis.config.json is invalid: ${cfg.diagnostics.map(formatDiagnostic).join("; ")}\n`,
    );
    return 2;
  }
  if (!cfg.config.updates.enabled) {
    rt.err(
      "aegis: rule updates are off. To allow them, set updates.enabled to true in aegis.config.json. The only network request is one HTTPS GET of the bundle URL; nothing about your project is sent.\n",
    );
    return 2;
  }
  const source = opts.source ?? cfg.config.updates.source;
  if (!source) {
    rt.err(
      "aegis: no update source. Set updates.source in aegis.config.json or pass --source (an https URL or a local file).\n",
    );
    return 2;
  }

  const trusted: TrustedKey[] = [...TRUSTED_KEYS, ...cfg.config.updates.trustedKeys];
  if (trusted.length === 0) {
    rt.err(
      "aegis: no trusted signing key is configured, so no update can be accepted. Add the publisher's public key to updates.trustedKeys in aegis.config.json.\n",
    );
    return 2;
  }

  let text: string;
  try {
    if (/^https:\/\//i.test(source)) {
      if (!rt.fetchText) throw new Error("this environment cannot make network requests");
      rt.out(`Downloading ${source}\n`);
      text = await rt.fetchText(source);
    } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
      throw new Error("only https:// URLs or local files are allowed");
    } else {
      text = await readLocalBundle(path.resolve(rt.cwd, source));
    }
  } catch (err) {
    rt.err(
      `aegis: could not get the bundle: ${err instanceof Error ? err.message : "unknown error"}. Nothing was changed.\n`,
    );
    return 2;
  }

  const use = await rulesInUse(root);
  const verdict = verifyBundle(text, {
    trustedKeys: trusted,
    aegisVersion: rt.version,
    currentVersion: use.version,
  });
  if (!verdict.ok) {
    if (verdict.code === "same-version") {
      rt.out(`Already up to date: ${verdict.message}.\n`);
      return 0;
    }
    rt.err(`aegis: update rejected: ${verdict.message}. Nothing was changed.\n`);
    return 2;
  }
  const { manifest } = verdict.bundle;

  const staged = await stageBundle(root, manifest);
  try {
    if (staged.load.diagnostics.length > 0) {
      rt.err(
        "aegis: update rejected: the signed bundle contains rules that fail validation. Nothing was changed.\n",
      );
      for (const d of staged.load.diagnostics.slice(0, 5)) rt.err(`  ${formatDiagnostic(d)}\n`);
      return 2;
    }
    const current = await loadRulesFromDir(use.dir);
    const before = new Map(current.rules.map((r) => [r.rule.id, JSON.stringify(r.rule)]));
    const after = new Map(staged.load.rules.map((r) => [r.rule.id, JSON.stringify(r.rule)]));
    const added = [...after.keys()].filter((id) => !before.has(id));
    const removed = [...before.keys()].filter((id) => !after.has(id));
    const changed = [...after.keys()].filter(
      (id) => before.has(id) && before.get(id) !== after.get(id),
    );

    rt.out(
      `Verified: rules ${manifest.bundleVersion}, signed by key '${manifest.keyId}' (current: ${use.version}).\n`,
    );
    rt.out(
      `  added: ${added.join(", ") || "none"}\n  changed: ${changed.join(", ") || "none"}\n  removed: ${removed.join(", ") || "none"}\n`,
    );
    if (opts.dryRun) {
      rt.out("Dry run: nothing was installed.\n");
      return 0;
    }
    if (!opts.yes) {
      if (!rt.interactive) {
        rt.err(
          "aegis: not running in a terminal, so nothing was installed. Re-run with --yes, or --dry-run to preview.\n",
        );
        return 2;
      }
      if (!(await rt.prompter.confirm("Install these rules?"))) {
        rt.out("Nothing was changed.\n");
        return 0;
      }
    }
    await activateStaged(root, staged);
    rt.out(
      `Installed rules ${manifest.bundleVersion} in .aegis/rules. Your project files were not touched. Run 'aegis agents sync' to refresh agent instructions.\n`,
    );
    return 0;
  } catch (err) {
    rt.err(
      `aegis: the update could not be installed: ${err instanceof Error ? err.message : "unknown error"}. The previous rules are still in use.\n`,
    );
    return 2;
  } finally {
    await discardStaged(staged).catch(() => {});
  }
}

/** For maintainers: create a signing key. The private key is written to a file and never printed. */
export async function rulesKeygenCommand(
  rt: Runtime,
  o: { outDir: string; keyId: string },
): Promise<number> {
  const id = keyIdSchema.safeParse(o.keyId);
  if (!id.success) {
    rt.err("aegis: --key-id must be a short lowercase id such as 'aegis-2026'\n");
    return 2;
  }
  const dir = path.resolve(rt.cwd, o.outDir);
  const { privatePem, publicKey } = generateSigningKey();
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id.data}.private.pem`), privatePem, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (err) {
    rt.err(
      `aegis: could not write the private key: ${(err as NodeJS.ErrnoException).code === "EEXIST" ? "that key file already exists and is never overwritten" : err instanceof Error ? err.message : "unknown error"}\n`,
    );
    return 2;
  }
  rt.out(
    `Wrote ${path.join(dir, `${id.data}.private.pem`)} (private: keep it offline, never commit it, never share it).\n`,
  );
  rt.out("Public key, to put in aegis.config.json under updates.trustedKeys:\n");
  rt.out(JSON.stringify({ id: id.data, publicKey }, null, 2) + "\n");
  return 0;
}

export interface BundleOptions {
  key: string;
  keyId: string;
  bundleVersion: string;
  minAegis: string;
  rulesDir?: string;
  out: string;
}

/** For maintainers: sign a folder of rules into a bundle. Refuses to overwrite and checks its own output. */
export async function rulesBundleCommand(rt: Runtime, o: BundleOptions): Promise<number> {
  try {
    const dir = path.resolve(rt.cwd, o.rulesDir ?? RULES_DIR);
    const loaded = await loadRulesFromDir(dir);
    if (hasErrors(loaded.diagnostics) || loaded.rules.length === 0) {
      rt.err(
        `aegis: the rules do not validate, so no bundle was made: ${loaded.diagnostics.map(formatDiagnostic).slice(0, 3).join("; ") || "no rules found"}\n`,
      );
      return 2;
    }
    const keyFile = path.resolve(rt.cwd, o.key);
    const info = await lstat(keyFile);
    if (!info.isFile()) throw new Error("the key must be a regular file");
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      rt.err(
        "aegis: warning: the private key file is readable by other users. Run chmod 600 on it.\n",
      );
    }
    const privatePem = await readFile(keyFile, "utf8");
    const rules = [];
    for (const r of loaded.rules)
      rules.push({
        path: r.file,
        content: await readFile(path.join(dir, ...r.file.split("/")), "utf8"),
      });
    const bundle = signBundle(
      {
        bundleVersion: o.bundleVersion,
        minAegisVersion: o.minAegis,
        createdAt: (rt.now ?? (() => new Date()))().toISOString(),
        keyId: o.keyId,
        rules,
      },
      privatePem,
    );
    const publicKey = createPublicKey(privatePem)
      .export({ type: "spki", format: "der" })
      .toString("base64");
    const text = JSON.stringify(bundle, null, 2) + "\n";
    const check = verifyBundle(text, {
      trustedKeys: [{ id: o.keyId, publicKey }],
      aegisVersion: o.minAegis,
      currentVersion: "0.0.0",
    });
    if (!check.ok) throw new Error(`the bundle failed its own verification: ${check.message}`);
    await writeFile(path.resolve(rt.cwd, o.out), text, { flag: "wx", mode: 0o644 });
    rt.out(
      `Wrote ${o.out}: ${rules.length} rules, version ${o.bundleVersion}, signed by '${o.keyId}'. Publish it over HTTPS.\n`,
    );
    return 0;
  } catch (err) {
    rt.err(
      `aegis: could not create the bundle: ${(err as NodeJS.ErrnoException).code === "EEXIST" ? "the output file already exists and is never overwritten" : err instanceof Error ? err.message : "unknown error"}\n`,
    );
    return 2;
  }
}
