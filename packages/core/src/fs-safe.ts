import { lstat } from "node:fs/promises";
import path from "node:path";

/**
 * Throw if any EXISTING part of `rel` (a path inside `root`) is a symbolic link or a non-folder.
 * AEGIS writes small files under `.aegis/`. A repository you did not write could ship `.aegis` as a
 * link to another folder, so every write checks the path first and refuses to follow links.
 */
export async function assertPlainFolderPath(root: string, rel: string): Promise<void> {
  let current = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    if (info.isSymbolicLink())
      throw new Error(`${rel} is or contains a symbolic link, which AEGIS will not write through`);
    if (!info.isDirectory()) throw new Error(`${rel} has a part that is not a folder`);
  }
}
