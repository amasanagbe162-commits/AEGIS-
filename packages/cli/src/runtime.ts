import { createInterface } from "node:readline/promises";
import os from "node:os";

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
  };
}
