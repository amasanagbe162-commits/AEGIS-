import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { MAX_FILE_BYTES, parseConfig } from "../parser/index.js";
import type { Diagnostic } from "../parser/diagnostics.js";
import { configSchema, type AegisConfig } from "../schemas/config.js";

export const CONFIG_FILE_NAME = "aegis.config.json";

export interface ConfigLoadResult {
  config: AegisConfig;
  /** False when no config file exists and defaults are in use. */
  found: boolean;
  diagnostics: Diagnostic[];
}

export function defaultConfig(): AegisConfig {
  return configSchema.parse({ version: 1 });
}

/** Read aegis.config.json from the project root. Missing file means defaults. */
export async function loadProjectConfig(root: string): Promise<ConfigLoadResult> {
  const file = path.join(root, CONFIG_FILE_NAME);
  let size: number;
  try {
    const info = await lstat(file);
    if (!info.isFile()) {
      return fail("aegis.config.json must be a regular file (symbolic links are not followed)");
    }
    size = info.size;
  } catch {
    return { config: defaultConfig(), found: false, diagnostics: [] };
  }
  if (size > MAX_FILE_BYTES)
    return fail(`file is larger than the ${MAX_FILE_BYTES / 1024} KB limit`);

  const parsed = parseConfig(await readFile(file, "utf8"), CONFIG_FILE_NAME);
  if (!parsed.ok) {
    return { config: defaultConfig(), found: true, diagnostics: parsed.diagnostics };
  }
  return { config: parsed.value, found: true, diagnostics: [] };

  function fail(message: string): ConfigLoadResult {
    return {
      config: defaultConfig(),
      found: true,
      diagnostics: [{ severity: "error", source: CONFIG_FILE_NAME, path: "", message }],
    };
  }
}
