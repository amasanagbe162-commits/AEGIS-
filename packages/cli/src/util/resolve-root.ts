import path from "node:path";
import type { Runtime } from "../runtime.js";
import { isDirectory } from "./fs.js";
import { findProjectRoot } from "./project-root.js";

export type RootOutcome =
  | { ok: true; root: string; explicit: boolean; foundMarkers: boolean }
  | { ok: false; message: string };

/** An explicit path argument wins. Otherwise search upward from the current folder. */
export async function resolveRoot(rt: Runtime, pathArg: string | undefined): Promise<RootOutcome> {
  if (pathArg) {
    const abs = path.resolve(rt.cwd, pathArg);
    if (!(await isDirectory(abs))) return { ok: false, message: `'${pathArg}' is not a folder` };
    return { ok: true, root: abs, explicit: true, foundMarkers: true };
  }
  const found = await findProjectRoot(rt.cwd, rt.homeDir);
  return { ok: true, root: found.root, explicit: false, foundMarkers: found.foundMarkers };
}
