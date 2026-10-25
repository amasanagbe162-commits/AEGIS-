import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { assertPlainFolderPath } from "../fs-safe.js";
import { loadRulesFromDir, type RuleLoadResult } from "../loader/rules.js";
import { semverSchema } from "../schemas/common.js";
import { compareSemver, keyIdSchema, type BundleManifest } from "./bundle.js";

const INSTALL_DIR = path.join(".aegis", "rules");
const INFO_FILE = "installed.json";

const infoSchema = z
  .object({
    formatVersion: z.literal(1),
    bundleVersion: semverSchema,
    keyId: keyIdSchema,
    installedAt: z.string().datetime(),
    files: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/)),
  })
  .strict();
export type InstalledInfo = z.infer<typeof infoSchema>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Staged {
  dir: string;
  load: RuleLoadResult;
}

/** Write the bundle's rules to a temporary folder and run the normal rule validation on them. */
export async function stageBundle(root: string, manifest: BundleManifest): Promise<Staged> {
  const base = path.join(root, ".aegis");
  await assertPlainFolderPath(root, ".aegis");
  await mkdir(base, { recursive: true });
  const dir = path.join(base, `rules.tmp-${process.pid}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = {};
  for (const r of manifest.rules) {
    const target = path.join(dir, ...r.path.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, r.content, { flag: "wx" });
    files[r.path] = sha(r.content);
  }
  const info: InstalledInfo = {
    formatVersion: 1,
    bundleVersion: manifest.bundleVersion,
    keyId: manifest.keyId,
    installedAt: new Date().toISOString(),
    files,
  };
  await writeFile(path.join(dir, INFO_FILE), JSON.stringify(info, null, 2) + "\n", { flag: "wx" });
  const load = await loadRulesFromDir(dir);
  if (load.rules.length !== manifest.rules.length && load.diagnostics.length === 0) {
    load.diagnostics.push({
      severity: "error",
      source: "bundle",
      path: "",
      message: "not every rule file was loaded",
    });
  }
  return { dir, load };
}

export async function discardStaged(staged: Staged): Promise<void> {
  await rm(staged.dir, { recursive: true, force: true });
}

/**
 * Replace the installed rules with a staged, validated bundle. The rules in use stay in place until
 * the new ones are fully written and validated; if the swap fails, the old ones are put back.
 */
export async function activateStaged(root: string, staged: Staged): Promise<void> {
  await assertPlainFolderPath(root, ".aegis");
  const live = path.join(root, INSTALL_DIR);
  const prev = `${live}.prev-${process.pid}`;
  let hadOld = false;
  try {
    await rename(live, prev);
    hadOld = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  try {
    await rename(staged.dir, live);
  } catch (err) {
    if (hadOld) await rename(prev, live).catch(() => {});
    throw err;
  }
  if (hadOld) await rm(prev, { recursive: true, force: true });
}

export interface RulesInUse {
  dir: string;
  source: "installed" | "baseline";
  version: string;
  keyId?: string;
  /** Why an installed bundle is not being used, when that is the case. */
  warning?: string;
}

/**
 * Decide which rules to use: an installed bundle, if it is intact and newer than the baseline,
 * otherwise the baseline that ships with AEGIS. A damaged install never breaks scanning and
 * never silently weakens it: the problem is reported in `warning`.
 */
export async function resolveRulesInUse(
  root: string,
  baseline: { dir: string; version: string },
): Promise<RulesInUse> {
  const base: RulesInUse = { dir: baseline.dir, source: "baseline", version: baseline.version };
  const dir = path.join(root, INSTALL_DIR);
  try {
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory())
      return {
        ...base,
        warning: ".aegis/rules is not a plain folder, so the baseline rules are used",
      };
  } catch {
    return base;
  }
  try {
    const parsed = infoSchema.safeParse(
      JSON.parse(await readFile(path.join(dir, INFO_FILE), "utf8")),
    );
    if (!parsed.success) throw new Error("installed.json is invalid");
    const meta = parsed.data;
    for (const [rel, hash] of Object.entries(meta.files)) {
      if (sha(await readFile(path.join(dir, ...rel.split("/")), "utf8")) !== hash) {
        throw new Error(`${rel} was changed after installation`);
      }
    }
    const load = await loadRulesFromDir(dir);
    if (load.diagnostics.length > 0 || load.rules.length !== Object.keys(meta.files).length) {
      throw new Error("the installed rules no longer validate");
    }
    if (compareSemver(meta.bundleVersion, baseline.version) <= 0) {
      return {
        ...base,
        warning: `installed rules ${meta.bundleVersion} are not newer than the baseline ${baseline.version}, so the baseline is used`,
      };
    }
    return { dir, source: "installed", version: meta.bundleVersion, keyId: meta.keyId };
  } catch (err) {
    return {
      ...base,
      warning: `installed rules are not used (${err instanceof Error ? err.message : "unreadable"}); baseline ${baseline.version} is in use`,
    };
  }
}
