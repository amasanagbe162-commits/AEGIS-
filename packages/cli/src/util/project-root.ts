import path from "node:path";
import { exists } from "./fs.js";

const MARKERS = [
  ".git",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "go.mod",
  "Cargo.toml",
  "aegis.config.json",
];

export interface RootResult {
  root: string;
  /** False when no project markers were found and the starting folder is used as is. */
  foundMarkers: boolean;
}

/**
 * Find the project root: the nearest folder (starting at `start`, going upward) that holds a
 * project marker. The home folder and filesystem root are too broad to be a project, so they
 * are never chosen by searching.
 */
export async function findProjectRoot(start: string, homeDir: string): Promise<RootResult> {
  let dir = path.resolve(start);
  for (;;) {
    const broad = dir === path.resolve(homeDir) || dir === path.parse(dir).root;
    if (!broad) {
      for (const marker of MARKERS) {
        if (await exists(path.join(dir, marker))) return { root: dir, foundMarkers: true };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { root: path.resolve(start), foundMarkers: false };
}

/** True for places that should never be initialized by accident. */
export function isTooBroad(dir: string, homeDir: string): boolean {
  const resolved = path.resolve(dir);
  return resolved === path.resolve(homeDir) || resolved === path.parse(resolved).root;
}
