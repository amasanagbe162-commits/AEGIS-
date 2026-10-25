import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  inspectBlock,
  inspectOwned,
  normalizeNewlines,
  renderBlock,
  renderOwned,
} from "./managed.js";
import type { FileSpec } from "./types.js";

const MAX_EXISTING_BYTES = 512 * 1024;

export type PlanAction =
  /** The file does not exist and will be created. */
  | "create"
  /** AEGIS wrote this file or block earlier and nobody edited it: it will be refreshed. */
  | "update"
  /** The file exists without an AEGIS block: a block will be appended after your text. */
  | "append"
  /** Already exactly what AEGIS would write. */
  | "unchanged"
  /** The file will not be touched. `reason` says why. */
  | "keep";

export interface PlannedFile {
  spec: FileSpec;
  action: PlanAction;
  reason: string;
  /** Complete new file content, set for create, update and append. */
  next?: string;
}

export interface PlanOptions {
  /** Allow appending an AEGIS block to an existing file that has none (for example AGENTS.md). */
  mergeExisting?: boolean;
}

/** Relative POSIX path check. Specs are built by AEGIS, but the check keeps writes inside the project. */
function assertSafeRelative(rel: string): void {
  if (
    rel === "" ||
    rel.startsWith("/") ||
    /^[a-zA-Z]:/.test(rel) ||
    rel.includes("\0") ||
    rel.split("/").includes("..")
  ) {
    throw new Error(`unsafe path: ${rel}`);
  }
}

type Existing =
  { kind: "missing" } | { kind: "file"; text: string } | { kind: "unsafe"; reason: string };

/** Read an existing file without following symbolic links, including in parent folders inside the project. */
async function readExisting(root: string, rel: string): Promise<Existing> {
  assertSafeRelative(rel);
  const parts = rel.split("/");
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i] as string);
    let info;
    try {
      info = await lstat(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
      return { kind: "unsafe", reason: "could not be inspected" };
    }
    if (info.isSymbolicLink())
      return { kind: "unsafe", reason: "is or sits inside a symbolic link" };
    const last = i === parts.length - 1;
    if (last) {
      if (!info.isFile()) return { kind: "unsafe", reason: "is not a regular file" };
      if (info.size > MAX_EXISTING_BYTES) return { kind: "unsafe", reason: "is unusually large" };
    } else if (!info.isDirectory()) {
      return { kind: "unsafe", reason: "has a parent that is not a folder" };
    }
  }
  return { kind: "file", text: await readFile(current, "utf8") };
}

export async function planFile(
  root: string,
  spec: FileSpec,
  options: PlanOptions = {},
): Promise<PlannedFile> {
  const existing = await readExisting(root, spec.path);
  const keep = (reason: string): PlannedFile => ({ spec, action: "keep", reason });

  if (existing.kind === "unsafe") return keep(`left alone: ${spec.path} ${existing.reason}`);

  if (spec.mode === "create-only") {
    if (existing.kind === "missing") {
      return { spec, action: "create", reason: "does not exist yet", next: spec.body };
    }
    return keep("already exists; AEGIS never edits this file, so add the snippet yourself");
  }

  if (spec.mode === "owned") {
    const fresh = renderOwned(spec.frontMatter ?? "", spec.body);
    if (existing.kind === "missing") {
      return { spec, action: "create", reason: "does not exist yet", next: fresh };
    }
    const state = inspectOwned(existing.text);
    if (state.kind === "none") {
      return keep("a file with this name already exists and was not written by AEGIS");
    }
    if (state.kind === "edited") {
      return keep("edited by hand since AEGIS wrote it, so it is kept as is");
    }
    return existing.text.replace(/\r\n/g, "\n") === fresh
      ? { spec, action: "unchanged", reason: "already up to date" }
      : { spec, action: "update", reason: "refreshed from the current rules", next: fresh };
  }

  // block mode
  const block = renderBlock(spec.body);
  if (existing.kind === "missing") {
    return { spec, action: "create", reason: "does not exist yet", next: block };
  }
  const state = inspectBlock(existing.text);
  switch (state.kind) {
    case "ambiguous":
      return keep("contains a damaged or duplicated AEGIS block, so AEGIS will not guess");
    case "edited":
      return keep("the AEGIS block was edited by hand, so it is kept as is");
    case "intact": {
      const next = existing.text.slice(0, state.start) + block + existing.text.slice(state.end);
      return next === existing.text
        ? { spec, action: "unchanged", reason: "already up to date" }
        : {
            spec,
            action: "update",
            reason: "AEGIS block refreshed (your other text is untouched)",
            next,
          };
    }
    case "none": {
      if (!options.mergeExisting) {
        return keep(
          "already exists without an AEGIS block; pass --merge-existing to append one after your text",
        );
      }
      const sep = existing.text === "" || existing.text.endsWith("\n") ? "\n" : "\n\n";
      return {
        spec,
        action: "append",
        reason: "AEGIS block appended after your existing text",
        next: existing.text + sep + block,
      };
    }
  }
}

export async function planFiles(
  root: string,
  specs: readonly FileSpec[],
  options: PlanOptions = {},
): Promise<PlannedFile[]> {
  const out: PlannedFile[] = [];
  for (const spec of specs) out.push(await planFile(root, spec, options));
  return out;
}

export interface ApplyResult {
  path: string;
  action: PlanAction;
  written: boolean;
  note?: string;
}

/**
 * Write the planned files. Creates use an exclusive-create flag, so a file that appears while AEGIS
 * runs is never overwritten. Updates re-read the file first and give up if it changed, then replace
 * it through a temporary file so a crash cannot leave half a file behind.
 */
export async function applyPlan(
  root: string,
  plan: readonly PlannedFile[],
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const item of plan) {
    const rel = item.spec.path;
    const base = { path: rel, action: item.action };
    if (item.next === undefined || item.action === "keep" || item.action === "unchanged") {
      results.push({ ...base, written: false });
      continue;
    }
    const file = path.join(root, ...rel.split("/"));
    try {
      if (item.action === "create") {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, item.next, { flag: "wx", mode: 0o644 });
      } else {
        const now = await readExisting(root, rel);
        const replan = await planFile(root, item.spec, { mergeExisting: item.action === "append" });
        if (now.kind !== "file" || replan.next !== item.next) {
          results.push({
            ...base,
            written: false,
            note: "the file changed while AEGIS was running, so it was not touched",
          });
          continue;
        }
        const tmp = `${file}.aegis-tmp-${process.pid}`;
        await writeFile(tmp, item.next, { flag: "wx", mode: 0o644 });
        try {
          await rename(tmp, file);
        } catch (err) {
          await rm(tmp, { force: true });
          throw err;
        }
      }
      results.push({ ...base, written: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      results.push({
        ...base,
        written: false,
        note:
          code === "EEXIST"
            ? "the file appeared while AEGIS was running, so it was not touched"
            : `could not write: ${err instanceof Error ? err.message : "unknown error"}`,
      });
    }
  }
  return results;
}

export type VerifyStatus =
  | "current"
  | "stale"
  | "missing"
  | "modified"
  | "foreign"
  | "unsafe"
  /** create-only file that exists; AEGIS does not manage its content. */
  | "present";

export interface VerifiedFile {
  path: string;
  status: VerifyStatus;
  detail: string;
}

/** Compare what is on disk with what `aegis agents sync` would write now. Changes nothing. */
export async function verifyFiles(
  root: string,
  specs: readonly FileSpec[],
): Promise<VerifiedFile[]> {
  const out: VerifiedFile[] = [];
  for (const spec of specs) {
    const existing = await readExisting(root, spec.path);
    const done = (status: VerifyStatus, detail: string) =>
      out.push({ path: spec.path, status, detail });

    if (existing.kind === "unsafe") {
      done("unsafe", `${spec.path} ${existing.reason}`);
    } else if (existing.kind === "missing") {
      done("missing", "not installed; run `aegis agents sync`");
    } else if (spec.mode === "create-only") {
      done("present", "exists (AEGIS does not manage its content)");
    } else if (spec.mode === "owned") {
      const state = inspectOwned(existing.text);
      if (state.kind === "none") done("foreign", "exists but was not written by AEGIS");
      else if (state.kind === "edited") done("modified", "edited by hand after AEGIS wrote it");
      else {
        const fresh = renderOwned(spec.frontMatter ?? "", spec.body);
        if (existing.text.replace(/\r\n/g, "\n") === fresh) done("current", "up to date");
        else done("stale", "out of date; run `aegis agents sync`");
      }
    } else {
      const state = inspectBlock(existing.text);
      if (state.kind === "none") done("foreign", "exists without an AEGIS block");
      else if (state.kind === "ambiguous") done("modified", "damaged or duplicated AEGIS block");
      else if (state.kind === "edited") done("modified", "the AEGIS block was edited by hand");
      else if (state.inner === normalizeNewlines(spec.body).trimEnd())
        done("current", "up to date");
      else done("stale", "out of date; run `aegis agents sync`");
    }
  }
  return out;
}
