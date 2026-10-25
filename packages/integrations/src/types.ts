import type { AGENTS, MasterFile, ProtectionLevel, Rule } from "@aegis/core";

export type AgentId = (typeof AGENTS)[number];

/**
 * How strongly an integration can influence the agent.
 *  - hook:      a deterministic program runs and can block the agent (Claude Code Stop hook)
 *  - advisory:  the agent reads instructions and may ignore them
 *  - manual:    the person must copy the text into the product themselves
 */
export type Enforcement = "hook" | "advisory" | "manual";

/** Everything needed to render instructions. Plain data, so rendering stays pure and testable. */
export interface InstructionInput {
  master: MasterFile;
  /** Rules already selected for this project and protection level. */
  rules: readonly Rule[];
  level: ProtectionLevel;
  maxAttempts: number;
  /**
   * How to start AEGIS, for example "npx --no-install aegis". `--no-install` matters: without it
   * npx could download an unrelated package that happens to be called "aegis".
   */
  cliCommand: string;
  /** Command the agent should run to verify its work, for example "npx --no-install aegis check". */
  checkCommand: string;
  /** Name of the project's master file, for example "AEGIS.aegis". */
  masterFileName: string;
}

/**
 * How AEGIS treats a file on disk.
 *  - owned:       a whole file AEGIS generated. Updated only while it is byte-for-byte what AEGIS wrote.
 *  - block:       one marked block inside a file the user may also edit. Text outside it is never touched.
 *  - create-only: written once if missing, never modified afterwards (for example hook settings).
 */
export type WriteMode = "owned" | "block" | "create-only";

export interface FileSpec {
  /** POSIX-style path relative to the project root. */
  path: string;
  mode: WriteMode;
  /** Text that must stay at the very start of the file (YAML front matter). Owned files only. */
  frontMatter?: string;
  body: string;
  /** Text `aegis agents print` shows when it differs from the file body (for example paste-in text). */
  printable?: string;
  purpose: string;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  /** The supported mechanism AEGIS uses, in plain words. */
  mechanism: string;
  enforcement: Enforcement;
  /** What this integration cannot do. Shown to the user, never hidden. */
  limitations: readonly string[];
  /** Files for this agent. `hooks` adds hook configuration where the agent supports it. */
  files(input: InstructionInput, options: { hooks: boolean }): FileSpec[];
}
