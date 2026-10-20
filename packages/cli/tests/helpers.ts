import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/program.js";
import type { Prompter, Runtime } from "../src/runtime.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..", "..", "..");
export const fixture = (name: string) => path.join(repoRoot, "tests/fixtures", name);

export interface Script {
  selects?: number[];
  confirms?: boolean[];
}

export interface Captured {
  rt: Runtime;
  stdout: () => string;
  stderr: () => string;
  asked: string[];
}

/** A runtime that records output and answers prompts from a script. Nothing touches a real terminal. */
export function makeRuntime(
  cwd: string,
  over: Partial<Runtime> & { script?: Script } = {},
): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const selects = [...(over.script?.selects ?? [])];
  const confirms = [...(over.script?.confirms ?? [])];
  const prompter: Prompter = {
    async select(question, _choices, defaultIndex) {
      asked.push(question);
      return selects.shift() ?? defaultIndex;
    },
    async confirm(question) {
      asked.push(question);
      return confirms.shift() ?? false;
    },
  };
  const { script: _script, ...rest } = over;
  void _script;
  const rt: Runtime = {
    out: (t) => void out.push(t),
    err: (t) => void err.push(t),
    cwd,
    env: { PATH: "" },
    homeDir: path.join(os.tmpdir(), "aegis-fake-home-that-does-not-exist"),
    nodeVersion: process.version,
    version: "9.9.9",
    interactive: false,
    prompter,
    ...rest,
  };
  return { rt, stdout: () => out.join(""), stderr: () => err.join(""), asked };
}

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-cli-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function aegis(args: string[], cap: Captured): Promise<number> {
  return run(args, cap.rt);
}
