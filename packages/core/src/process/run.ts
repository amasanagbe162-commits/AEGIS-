import { spawn } from "node:child_process";

export interface RunOptions {
  /** Absolute path of the executable. Never a shell command line. */
  command: string;
  /** Arguments as an array. They are passed to the program as-is; no shell interprets them. */
  args: readonly string[];
  /** Fixed working directory. */
  cwd: string;
  timeoutMs: number;
  /** Maximum bytes kept per output stream. Exceeding it stops the process. */
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
}

export type RunResult =
  | { kind: "exited"; exitCode: number; stdout: string; stderr: string }
  | { kind: "timeout" }
  | { kind: "output-limit"; stream: "stdout" | "stderr" }
  | { kind: "spawn-error"; message: string };

/** Runs one program. Injected into scanner adapters so tests can replace it. */
export type ProcessRunner = (options: RunOptions) => Promise<RunResult>;

/**
 * Environment variables passed to scanner processes. This is an allowlist: anything not listed
 * (API tokens, cloud credentials, NODE_OPTIONS and so on) is NOT inherited.
 */
const ENV_ALLOWLIST = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LANGUAGE",
  "TERM",
  "SystemRoot",
  "SYSTEMROOT",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // CA bundle paths are needed behind TLS-inspecting proxies. (NODE_OPTIONS is deliberately NOT allowed.)
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
]);

export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ENV_ALLOWLIST.has(key) || key.startsWith("LC_") || /^npm_config_/i.test(key))
      out[key] = value;
  }
  return out;
}

/**
 * The only place in AEGIS that starts another program. Safe by construction:
 * no shell, arguments as an array, fixed working directory, timeout, output cap, filtered
 * environment, and the whole process group is killed on timeout.
 */
export const runProcess: ProcessRunner = (options) =>
  new Promise<RunResult>((resolve) => {
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const posix = process.platform !== "win32";
    let child;
    try {
      child = spawn(options.command, [...options.args], {
        cwd: options.cwd,
        env: sanitizeEnv(options.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: posix,
      });
    } catch (err) {
      resolve({
        kind: "spawn-error",
        message: err instanceof Error ? err.message : "could not start process",
      });
      return;
    }

    const kill = () => {
      try {
        if (posix && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // already gone
      }
    };

    const timer = setTimeout(() => {
      kill();
      finish({ kind: "timeout" });
    }, options.timeoutMs);

    const chunks: Record<"stdout" | "stderr", Buffer[]> = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    const collect = (stream: "stdout" | "stderr") => (data: Buffer) => {
      sizes[stream] += data.length;
      if (sizes[stream] > options.maxOutputBytes) {
        kill();
        finish({ kind: "output-limit", stream });
        return;
      }
      chunks[stream].push(data);
    };
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));

    child.on("error", (err) => finish({ kind: "spawn-error", message: err.message }));
    child.on("close", (code, signal) => {
      if (code === null) {
        finish({
          kind: "spawn-error",
          message: `process was stopped by signal ${signal ?? "unknown"}`,
        });
        return;
      }
      finish({
        kind: "exited",
        exitCode: code,
        stdout: Buffer.concat(chunks.stdout).toString("utf8"),
        stderr: Buffer.concat(chunks.stderr).toString("utf8"),
      });
    });
  });
