import { createInterface } from "node:readline/promises";
import os from "node:os";
import { createDefaultRunners, type CheckRunner } from "@aegis/core";
import { SEMGREP_RULES_FILE } from "@aegis/rules";

/** Asks the person questions. Replaced by a fake in tests. */
export interface Prompter {
  /** Returns the zero-based index of the chosen option. */
  select(question: string, choices: readonly string[], defaultIndex: number): Promise<number>;
  confirm(question: string): Promise<boolean>;
}

/** Everything a command needs from the outside world, so commands can be tested without a terminal. */
export interface Runtime {
  out(text: string): void;
  err(text: string): void;
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  nodeVersion: string;
  version: string;
  /** True only when both input and output are a terminal. */
  interactive: boolean;
  prompter: Prompter;
  /** Check runners by id. Real scanners in production; fakes or none in tests. */
  runners?: Readonly<Record<string, CheckRunner>>;
  /** Clock, replaceable in tests. */
  now?: () => Date;
  /** Reads piped standard input (used by hooks). Returns "" when nothing is piped. */
  readStdin?: () => Promise<string>;
}

const MAX_STDIN_BYTES = 256 * 1024;
const STDIN_TIMEOUT_MS = 5000;

/** Read piped input with a size limit and a timeout, so a hook can never hang or be flooded. */
export async function readPipedStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = () => {
      clearTimeout(timer);
      process.stdin.removeAllListeners("data");
      process.stdin.removeAllListeners("end");
      process.stdin.pause();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    process.stdin.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_STDIN_BYTES) {
        chunks.length = 0;
        chunks.push(Buffer.alloc(MAX_STDIN_BYTES + 1));
        finish();
      } else chunks.push(c);
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

export function createTerminalPrompter(): Prompter {
  return {
    async select(question, choices, defaultIndex) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        process.stdout.write(`${question}\n`);
        choices.forEach((c, i) =>
          process.stdout.write(`  ${i + 1}) ${c}${i === defaultIndex ? " (default)" : ""}\n`),
        );
        for (;;) {
          const answer = (await rl.question(`Choose 1-${choices.length}: `)).trim();
          if (answer === "") return defaultIndex;
          const n = Number(answer);
          if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n - 1;
          process.stdout.write("Please enter one of the numbers shown.\n");
        }
      } finally {
        rl.close();
      }
    },
    async confirm(question) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
        return answer === "y" || answer === "yes";
      } finally {
        rl.close();
      }
    },
  };
}

export function createRuntime(version: string): Runtime {
  return {
    out: (t) => void process.stdout.write(t),
    err: (t) => void process.stderr.write(t),
    cwd: process.cwd(),
    env: process.env,
    homeDir: os.homedir(),
    nodeVersion: process.version,
    version,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompter: createTerminalPrompter(),
    runners: createDefaultRunners({ semgrepRulesFile: SEMGREP_RULES_FILE }),
    readStdin: readPipedStdin,
  };
}
