import { describe, expect, it } from "vitest";
import type { Rule } from "@aegis/core";
import { ADAPTERS } from "../src/adapters.js";
import {
  CHATGPT_BUDGET_CHARS,
  COMPACT_BUDGET_BYTES,
  FULL_BUDGET_BYTES,
  buildChatGptInstructions,
  buildCompactInstructions,
  buildFullInstructions,
  byteLength,
} from "../src/content.js";
import { makeInput, realRules } from "./helpers.js";

/** Many large rules, to prove the budgets hold when a project selects far more rules than today. */
async function manyRules(count: number): Promise<Rule[]> {
  const [base] = await realRules();
  if (!base) throw new Error("no bundled rules");
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `AEGIS-SEC-${String(9000 + i).padStart(4, "0")}`,
    title: `Synthetic rule ${i}`,
  }));
}

describe("generated instructions", () => {
  it("full instructions contain the operating rules, every selected rule, and the verification workflow", async () => {
    const input = await makeInput({ level: "advanced" });
    const text = buildFullInstructions(input);
    expect(text).toContain("Inspect before modifying");
    expect(text).toContain("Do not fabricate verification");
    for (const r of input.rules) expect(text).toContain(r.id);
    expect(text).toContain("npx --no-install aegis check");
    expect(text).toContain("Exit code 3: INCOMPLETE");
    expect(text).toContain("Finish every task with an AEGIS report");
    expect(text).toContain("Stop after 3 failed attempts");
    expect(byteLength(text)).toBeLessThanOrEqual(FULL_BUDGET_BYTES);
  });

  it("includes both unsafe and safe examples while they fit", async () => {
    const text = buildFullInstructions(await makeInput());
    expect(text).toContain("Unsafe:");
    expect(text).toContain("Safe:");
  });

  it("stays inside the size budget by reducing detail before leaving any rule out", async () => {
    const input = await makeInput({ rules: await manyRules(60) });
    const text = buildFullInstructions(input);
    expect(byteLength(text)).toBeLessThanOrEqual(FULL_BUDGET_BYTES);
    expect(text).not.toContain("Unsafe:");
    expect(text).toContain("AEGIS-SEC-9059");
  });

  it("as a last resort leaves out the least severe rules and says how many", async () => {
    const input = await makeInput({ rules: await manyRules(400) });
    const text = buildFullInstructions(input);
    expect(byteLength(text)).toBeLessThanOrEqual(FULL_BUDGET_BYTES);
    expect(text).toMatch(/\d+ more rule\(s\): run `aegis rules list`/);
  });

  it("compact instructions fit the AGENTS.md budget even with many rules, and point to the rest", async () => {
    const small = buildCompactInstructions(await makeInput());
    expect(byteLength(small)).toBeLessThanOrEqual(COMPACT_BUDGET_BYTES);
    const big = buildCompactInstructions(await makeInput({ rules: await manyRules(200) }));
    expect(byteLength(big)).toBeLessThanOrEqual(COMPACT_BUDGET_BYTES);
    expect(big).toContain("more rule(s): run `aegis rules list`");
  });

  it("the ChatGPT text fits 1,500 characters and is honest that ChatGPT cannot run checks", async () => {
    const text = buildChatGptInstructions(await makeInput());
    expect(text.length).toBeLessThanOrEqual(CHATGPT_BUDGET_CHARS);
    expect(text).toContain("You cannot run code");
    expect(text).toContain("paste the output");
    expect(text).not.toContain("aegis:generated");
  });

  it("uses the configured command and attempt limit", async () => {
    const input = await makeInput({
      cliCommand: "node bin/aegis.js",
      checkCommand: "node bin/aegis.js check",
      maxAttempts: 5,
    });
    expect(buildFullInstructions(input)).toContain("`node bin/aegis.js check`");
    expect(buildCompactInstructions(input)).toContain("After 5 failed attempts");
  });

  it("does not claim guarantees", async () => {
    for (const text of [
      buildFullInstructions(await makeInput()),
      buildCompactInstructions(await makeInput()),
      buildChatGptInstructions(await makeInput()),
    ]) {
      // "does not guarantee ..." is the honest wording; a bare promise is not allowed
      expect(text.toLowerCase()).not.toMatch(/(?<!not )(?<!n't )guarantee[sd]?\b/);
      expect(text.toLowerCase()).not.toContain("zero bugs");
    }
  });
});

describe("agent adapters", () => {
  it("every adapter is honest about its limits and names its enforcement level", () => {
    for (const adapter of Object.values(ADAPTERS)) {
      expect(adapter.limitations.length).toBeGreaterThan(0);
      expect(["hook", "advisory", "manual"]).toContain(adapter.enforcement);
    }
    expect(ADAPTERS["claude-code"].enforcement).toBe("hook");
    expect(ADAPTERS.chatgpt.enforcement).toBe("manual");
    expect(ADAPTERS["github-copilot"].enforcement).toBe("advisory");
    expect(ADAPTERS.codex.enforcement).toBe("advisory");
  });

  it("never targets a user's existing instruction file with a whole-file write", async () => {
    const input = await makeInput();
    for (const adapter of Object.values(ADAPTERS)) {
      for (const spec of adapter.files(input, { hooks: true })) {
        if (
          ["CLAUDE.md", ".github/copilot-instructions.md", "AGENTS.override.md"].includes(spec.path)
        ) {
          throw new Error(`${adapter.id} writes ${spec.path}`);
        }
        if (spec.path === "AGENTS.md") expect(spec.mode).toBe("block");
      }
    }
  });

  it("Copilot's file starts with applyTo front matter", async () => {
    const [spec] = ADAPTERS["github-copilot"].files(await makeInput(), { hooks: false });
    expect(spec?.frontMatter).toBe('---\napplyTo: "**"\n---\n');
    expect(spec?.path).toBe(".github/instructions/aegis.instructions.md");
  });

  it("only Claude Code adds hook settings, and only when asked", async () => {
    const input = await makeInput();
    expect(ADAPTERS["claude-code"].files(input, { hooks: false }).map((f) => f.path)).toEqual([
      ".claude/rules/aegis.md",
    ]);
    const withHooks = ADAPTERS["claude-code"].files(input, { hooks: true });
    const settings = withHooks.find((f) => f.path === ".claude/settings.json");
    expect(settings?.mode).toBe("create-only");
    const parsed = JSON.parse(settings?.body ?? "{}") as {
      hooks: { Stop: { hooks: { type: string; command: string }[] }[] };
    };
    expect(parsed.hooks.Stop[0]?.hooks[0]).toMatchObject({
      type: "command",
      command: "npx --no-install aegis hook claude-stop",
    });
  });
});
