import { access, constants, stat } from "node:fs/promises";
import path from "node:path";

/** Find an executable on PATH WITHOUT running it. Returns its absolute path, or undefined. */
export async function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return undefined;
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue; // a relative PATH entry would make the lookup depend on the current folder
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
