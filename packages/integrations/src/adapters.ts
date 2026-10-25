import {
  buildChatGptInstructions,
  buildCompactInstructions,
  buildFullInstructions,
} from "./content.js";
import type { AgentAdapter, AgentId, FileSpec, InstructionInput } from "./types.js";

/** Settings file that registers the AEGIS Stop hook for Claude Code. */
export function claudeHookSettings(input: InstructionInput): string {
  const settings = {
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${input.cliCommand} hook claude-stop`,
              timeout: 300,
            },
          ],
        },
      ],
    },
  };
  return JSON.stringify(settings, null, 2) + "\n";
}

const claudeCode: AgentAdapter = {
  id: "claude-code",
  label: "Claude Code",
  mechanism:
    "A project rules file (.claude/rules/aegis.md, loaded at session start) and an optional Stop hook that runs `aegis check` before Claude finishes.",
  enforcement: "hook",
  limitations: [
    "The rules file is advisory context. Claude can still ignore it.",
    "The Stop hook is the only enforcement: it can send Claude back to fix blocking findings, up to your attempt limit. It does not stop Claude from running commands or editing files.",
    "The hook is off unless you pass --hooks. It runs your scanners at the end of every Claude turn, so it adds time. Incomplete checks (missing tools) never block it.",
    "Hook behavior depends on your Claude Code version. The settings format follows Anthropic's documentation but has not been tested inside a live Claude Code session by the AEGIS tests.",
  ],
  files(input, options) {
    const specs: FileSpec[] = [
      {
        path: ".claude/rules/aegis.md",
        mode: "owned",
        body: buildFullInstructions(input),
        purpose:
          "AEGIS rules loaded by Claude Code at session start (your CLAUDE.md is not touched)",
      },
    ];
    if (options.hooks) {
      specs.push({
        path: ".claude/settings.json",
        mode: "create-only",
        body: claudeHookSettings(input),
        purpose: "registers the AEGIS Stop hook (created only if the file does not exist)",
      });
    }
    return specs;
  },
};

const githubCopilot: AgentAdapter = {
  id: "github-copilot",
  label: "GitHub Copilot",
  mechanism:
    'A path-specific instructions file (.github/instructions/aegis.instructions.md with applyTo: "**"). Your .github/copilot-instructions.md is not touched.',
  enforcement: "advisory",
  limitations: [
    "Instructions are advisory. Copilot can ignore them and nothing blocks it.",
    "Path-specific instruction files are not supported by every Copilot surface or version. If yours ignores the file, run `aegis agents print github-copilot` and paste the text into .github/copilot-instructions.md.",
    "AEGIS configures no Copilot hooks. Use `aegis check` in CI as the enforcement layer.",
  ],
  files(input) {
    return [
      {
        path: ".github/instructions/aegis.instructions.md",
        mode: "owned",
        frontMatter: '---\napplyTo: "**"\n---\n',
        body: buildFullInstructions(input),
        purpose:
          "AEGIS rules for Copilot, applied to every file (your existing instructions are not touched)",
      },
    ];
  },
};

const codex: AgentAdapter = {
  id: "codex",
  label: "OpenAI Codex (AGENTS.md)",
  mechanism:
    "A marked AEGIS block in AGENTS.md at the project root. Codex, GitHub Copilot's CLI and other tools read AGENTS.md.",
  enforcement: "advisory",
  limitations: [
    "Instructions are advisory. Codex can ignore them and nothing blocks it.",
    "Codex loads AGENTS.md files up to a combined size limit (32 KiB by default), so AEGIS writes a compact block. Run `aegis rules list` for the full rule text.",
    "If AGENTS.md already exists, AEGIS leaves it alone unless you pass --merge-existing. AEGIS never creates AGENTS.override.md, because that would replace your existing instructions.",
    "AEGIS configures no Codex hooks. Use `aegis check` in CI as the enforcement layer.",
  ],
  files(input) {
    return [
      {
        path: "AGENTS.md",
        mode: "block",
        body: buildCompactInstructions(input),
        purpose: "AEGIS block in AGENTS.md (text you wrote outside the block is never changed)",
      },
    ];
  },
};

const chatgpt: AgentAdapter = {
  id: "chatgpt",
  label: "ChatGPT (chat window)",
  mechanism:
    "A ready-to-paste text (.aegis/chatgpt-instructions.md, or `aegis agents print chatgpt`) for Customize ChatGPT or a Project's instructions.",
  enforcement: "manual",
  limitations: [
    "You must paste the text into ChatGPT yourself. AEGIS cannot see or verify what is configured in your account.",
    "ChatGPT in the browser cannot read your repository or run commands, so AEGIS cannot check its work. The text tells ChatGPT to say so and to work from `aegis check` output that you paste back.",
    "Instructions are advisory. ChatGPT can ignore them.",
    "ChatGPT's instruction limits can change. The text is kept under 1,500 characters to fit the smallest limit AEGIS knows of.",
  ],
  files(input) {
    const text = buildChatGptInstructions(input);
    return [
      {
        path: ".aegis/chatgpt-instructions.md",
        mode: "owned",
        body: [
          "# AEGIS instructions for ChatGPT",
          "",
          "Copy the text below into **Customize ChatGPT** (Settings), or into the instructions of a ChatGPT Project.",
          "AEGIS does not send it anywhere and cannot see what is configured in your account.",
          "",
          "```text",
          text,
          "```",
          "",
          "Run `aegis agents print chatgpt` to print the text alone, ready to copy.",
        ].join("\n"),
        printable: text + "\n",
        purpose:
          "text to paste into ChatGPT's custom instructions (nothing is sent anywhere by AEGIS)",
      },
    ];
  },
};

export const ADAPTERS: Readonly<Record<AgentId, AgentAdapter>> = {
  "claude-code": claudeCode,
  "github-copilot": githubCopilot,
  codex,
  chatgpt,
};

export function getAdapter(id: AgentId): AgentAdapter {
  return ADAPTERS[id];
}
