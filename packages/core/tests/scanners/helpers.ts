import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  CheckContext,
  ProjectProfile,
  RunOptions,
  RunResult,
  ScannerDeps,
} from "../../src/index.js";

export function profile(over: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    root: "/x",
    languages: [],
    frameworks: [],
    packageManagers: [],
    tools: [],
    uncertainties: [],
    filesIndexed: 0,
    truncated: false,
    ...over,
  };
}

export const npmProfile = () =>
  profile({
    packageManagers: [
      {
        name: "npm",
        confidence: "high",
        evidence: [{ file: "package-lock.json", detail: "lockfile exists" }],
      },
    ],
  });

export function ctx(root: string, over: Partial<CheckContext> = {}): CheckContext {
  return { root, profile: profile(), allowProjectTools: false, timeoutMs: 5000, ...over };
}

export interface Fake {
  deps: ScannerDeps;
  calls: RunOptions[];
}

/** Fake scanner dependencies: `tools` says which programs exist, `result` is what running one returns. */
export function fakeDeps(tools: string[], result: RunResult | (() => RunResult)): Fake {
  const calls: RunOptions[] = [];
  return {
    calls,
    deps: {
      env: { PATH: "/fake", SECRET_TOKEN: "must-not-matter" },
      which: async (name) => (tools.includes(name) ? `/fake/bin/${name}` : undefined),
      run: async (o) => {
        calls.push(o);
        return typeof result === "function" ? result() : result;
      },
    },
  };
}

export const exited = (exitCode: number, stdout = "", stderr = ""): RunResult => ({
  kind: "exited",
  exitCode,
  stdout,
  stderr,
});

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aegis-scan-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
