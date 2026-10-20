import { access, constants, lstat, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { MAX_FILE_BYTES } from "@aegis/core";

/** Read a regular file as text. Refuses symbolic links, non-files, and oversized files. */
export async function readRegularFile(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile())
    throw new Error(`${file} is not a regular file (symbolic links are not followed)`);
  if (info.size > MAX_FILE_BYTES) {
    throw new Error(`${file} is larger than the ${MAX_FILE_BYTES / 1024} KB limit`);
  }
  return readFile(file, "utf8");
}

export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isDirectory();
  } catch {
    return false;
  }
}

/** Find an executable on PATH WITHOUT running it. Returns its path, or undefined. */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not here, keep looking
      }
    }
  }
  return undefined;
}
