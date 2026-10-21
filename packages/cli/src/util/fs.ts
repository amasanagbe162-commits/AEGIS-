import { lstat, readFile, stat } from "node:fs/promises";
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

export { findExecutable } from "@aegis/core";
