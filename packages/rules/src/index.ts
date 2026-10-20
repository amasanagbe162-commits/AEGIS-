import path from "node:path";
import { fileURLToPath } from "node:url";

/** Protection rules bundled with AEGIS (data files, never executed). */
export const PACKAGE_NAME = "@aegis/rules";

/** Absolute path of the bundled rules directory. */
export const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

/** Absolute path of the bundled templates (master file and config) used by `aegis init`. */
export const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "templates",
);
