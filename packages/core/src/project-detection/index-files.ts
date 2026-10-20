import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import ignore from "ignore";
import { isSensitivePath } from "../redaction/redact.js";
import type { DetectionContext } from "./types.js";

/** Directories that hold dependencies, caches or generated output. Never scanned. */
const ALWAYS_SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  "target",
  "vendor",
  ".gradle",
]);

export const DEFAULT_MAX_FILES = 5000;
export const DEFAULT_MAX_DEPTH = 8;
const MAX_READ_BYTES = 1024 * 1024;

export interface IndexOptions {
  /** Extra ignore patterns in .gitignore syntax (from aegis.config.json "scan.exclude"). */
  exclude?: readonly string[];
  maxFiles?: number;
  maxDepth?: number;
}

export interface ProjectIndex {
  files: string[];
  truncated: boolean;
}

async function readGitignore(root: string): Promise<string> {
  try {
    const file = path.join(root, ".gitignore");
    const info = await lstat(file);
    if (!info.isFile() || info.size > 256 * 1024) return "";
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * List the project's files without reading their contents.
 * Respects the root .gitignore and configured exclusions, skips dependency and build
 * directories, never follows symbolic links, and stops at a file limit.
 */
export async function indexProject(
  rootInput: string,
  options: IndexOptions = {},
): Promise<ProjectIndex> {
  const root = await realpath(rootInput);
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const ig = ignore()
    .add(await readGitignore(root))
    .add([...(options.exclude ?? [])]);

  const files: string[] = [];
  let truncated = false;

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated) return;
    if (depth > maxDepth) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip it
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name) || ig.ignores(`${rel}/`)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile()) {
        if (ig.ignores(rel)) continue;
        if (files.length >= maxFiles) {
          truncated = true;
          return;
        }
        files.push(rel);
      }
    }
  }

  await walk(root, 0);
  return { files, truncated };
}

export function createDetectionContext(root: string, files: readonly string[]): DetectionContext {
  const set = new Set(files);
  return {
    root,
    files,
    has: (p) => set.has(p),
    match: (re) => files.filter((f) => re.test(f)),
    async readText(rel) {
      if (!set.has(rel) || isSensitivePath(rel)) return undefined;
      try {
        const full = path.join(root, ...rel.split("/"));
        const info = await lstat(full);
        if (!info.isFile() || info.size > MAX_READ_BYTES) return undefined;
        return await readFile(full, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}
