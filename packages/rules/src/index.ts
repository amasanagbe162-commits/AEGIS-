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

/** Absolute path of AEGIS's own Semgrep rules (local only; the Semgrep registry is never used). */
export const SEMGREP_RULES_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "semgrep",
  "aegis.yaml",
);

/** Version of the rule set that ships inside this package. Bump it when bundled rules change. */
export const BASELINE_RULES_VERSION = "0.1.0";

/**
 * Public keys built into AEGIS that may sign rule bundles. EMPTY on purpose: no official signing key
 * exists yet. The project owner creates one with `aegis rules keygen`, keeps the private key offline,
 * and adds the public key here in a reviewed commit. Until then, only keys that a person adds to
 * their own aegis.config.json are trusted.
 */
export const TRUSTED_KEYS: readonly { id: string; publicKey: string }[] = [];
