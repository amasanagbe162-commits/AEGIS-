import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  REVIEW_GATES,
  loadRulesFromDir,
  redactText,
  type Rule,
} from "../../packages/core/src/index.js";
import { RULES_DIR, SEMGREP_RULES_FILE } from "../../packages/rules/src/index.js";

/**
 * These tests are the executable evidence behind each rule's "examples are technically correct"
 * and "the corrected example solves the problem" gates.
 *
 * Rule examples are inert text for AEGIS itself: the loader and scanners never run them. Only these
 * tests do, inside a fresh node:vm context that exposes nothing except in-memory fakes (no
 * network, no file system, no real database). A vm context is not a security boundary, which is
 * why this only ever runs the repository's own reviewed rule files, never a downloaded bundle.
 */
const loaded = await loadRulesFromDir(RULES_DIR);
const rules = new Map<string, Rule>(loaded.rules.map((r) => [r.rule.id, r.rule]));
const rule = (id: string): Rule => {
  const r = rules.get(id);
  if (!r) throw new Error(`missing rule ${id}`);
  return r;
};

/** Run example code as the body of an async function with the given globals. */
async function run(code: string, globals: Record<string, unknown>): Promise<unknown> {
  const context = { ...globals };
  return runInNewContext(`(async () => {\n${code}\n})()`, context, { timeout: 1000 });
}

describe("every bundled rule meets the approval record requirements", () => {
  it("loads without diagnostics and every rule is approved with a complete review", () => {
    expect(loaded.diagnostics).toEqual([]);
    expect(rules.size).toBe(6);
    for (const r of rules.values()) {
      expect(r.status, r.id).toBe("approved");
      expect(r.review, r.id).toBeDefined();
      expect([...(r.review?.gates ?? [])].sort(), r.id).toEqual([...REVIEW_GATES].sort());
      // honesty: an AI-assisted review must say that a person has not confirmed it yet
      if (r.review?.reviewerKind === "ai-assisted") {
        expect(r.review.notes, r.id).toContain("A human maintainer has not yet confirmed it");
      }
      expect(r.references.length, r.id).toBeGreaterThan(0);
      expect(r.limitations.length, r.id).toBeGreaterThan(0);
      expect(r.tests.length, r.id).toBeGreaterThan(0);
    }
  });

  it("rule text contains no real credential shapes (the repository's real Gitleaks scan covers the rest)", () => {
    const shapes = [
      /AKIA[0-9A-Z]{16}/,
      /ghp_[A-Za-z0-9]{30,}/,
      /github_pat_[A-Za-z0-9_]{30,}/,
      /sk-[A-Za-z0-9]{20,}/,
      /xox[baprs]-[A-Za-z0-9-]{10,}/,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    ];
    for (const dir of readdirSync(RULES_DIR)) {
      for (const file of readdirSync(path.join(RULES_DIR, dir))) {
        const text = readFileSync(path.join(RULES_DIR, dir, file), "utf8");
        for (const shape of shapes) expect(text, `${file} ${shape}`).not.toMatch(shape);
      }
    }
  });

  it("every rule reference is https, and none point at private or local addresses", () => {
    for (const r of rules.values()) {
      for (const url of r.references) {
        const u = new URL(url);
        expect(u.protocol, url).toBe("https:");
        expect(u.hostname, url).not.toMatch(/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/);
      }
    }
  });
});

describe("scanner configuration is consistent and safe", () => {
  const semgrep = parseYaml(readFileSync(SEMGREP_RULES_FILE, "utf8")) as {
    rules: { id: string; metadata?: { aegis_rule_id?: string } }[];
  };
  const semgrepIds = new Set(semgrep.rules.map((r) => r.id));

  it("every Semgrep rule maps to an existing AEGIS rule, and every referenced Semgrep rule exists", () => {
    for (const s of semgrep.rules) {
      const target = s.metadata?.aegis_rule_id;
      expect(target, s.id).toBeDefined();
      expect(rules.has(target ?? ""), `${s.id} -> ${target}`).toBe(true);
    }
    for (const r of rules.values()) {
      if (r.scanner?.tool === "semgrep") {
        expect(semgrepIds.has(r.scanner.ruleRef ?? ""), r.id).toBe(true);
      }
    }
  });

  it("the Semgrep file is local-only: no registry references and no automatic fixes", () => {
    const text = readFileSync(SEMGREP_RULES_FILE, "utf8");
    expect(text).not.toMatch(/^\s*(fix|fix-regex):/m);
    expect(text).not.toMatch(/https?:\/\//i.test(text) ? /semgrep\.dev|r\/[a-z]/ : /$^/);
    expect(text).not.toMatch(/\bconfig:\s*(p|r)\//);
  });
});

describe("AEGIS-SEC-0001: SQL injection", () => {
  const payload = "x' OR '1'='1";
  async function exercise(code: string) {
    const calls: { sql: string; params?: unknown }[] = [];
    const pool = {
      query: async (sql: string, params?: unknown) => {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    await run(code, { pool, req: { query: { email: payload } } });
    return calls;
  }

  it("the unsafe example puts the attacker's text inside the SQL", async () => {
    const [call] = await exercise(rule("AEGIS-SEC-0001").badExample.code);
    expect(call?.sql).toContain(payload);
    expect(call?.params).toBeUndefined();
  });

  it("the corrected example sends fixed SQL and passes the value separately", async () => {
    const [call] = await exercise(rule("AEGIS-SEC-0001").goodExample.code);
    expect(call?.sql).toBe("SELECT id, email FROM users WHERE email = $1");
    expect(call?.sql).not.toContain(payload);
    expect(call?.params).toEqual([payload]);
  });
});

describe("AEGIS-SEC-0002: cross-site scripting", () => {
  const html = "<img src=x onerror=alert(1)>";
  function element() {
    const writes = { html: [] as string[], text: [] as string[] };
    return {
      writes,
      el: {
        set innerHTML(v: string) {
          writes.html.push(v);
        },
        set textContent(v: string) {
          writes.text.push(v);
        },
      },
    };
  }

  it("the unsafe example gives the browser the text to parse as HTML", async () => {
    const { el, writes } = element();
    await run(rule("AEGIS-SEC-0002").badExample.code, {
      commentElement: el,
      comment: { text: html },
    });
    expect(writes.html).toEqual([html]);
  });

  it("the corrected example sets it as text and never as HTML", async () => {
    const { el, writes } = element();
    await run(rule("AEGIS-SEC-0002").goodExample.code, {
      commentElement: el,
      comment: { text: html },
    });
    expect(writes.text).toEqual([html]);
    expect(writes.html).toEqual([]);
  });
});

describe("AEGIS-SEC-0003: hardcoded credentials", () => {
  function client(env: Record<string, string>) {
    const made: { apiKey?: string }[] = [];
    class PaymentClient {
      constructor(options: { apiKey?: string }) {
        made.push(options);
      }
    }
    return { made, globals: { PaymentClient, process: { env } } };
  }

  it("the unsafe example embeds a literal key and ignores the environment", async () => {
    const { made, globals } = client({ PAYMENT_API_KEY: "value-from-environment" });
    await run(rule("AEGIS-SEC-0003").badExample.code, globals);
    expect(made[0]?.apiKey).toBe("EXAMPLE-NOT-A-REAL-KEY-0000");
    expect(rule("AEGIS-SEC-0003").badExample.code).toContain('"EXAMPLE-NOT-A-REAL-KEY-0000"');
  });

  it("the corrected example reads the environment and fails loudly when it is missing", async () => {
    const present = client({ PAYMENT_API_KEY: "value-from-environment" });
    await run(rule("AEGIS-SEC-0003").goodExample.code, present.globals);
    expect(present.made[0]?.apiKey).toBe("value-from-environment");
    expect(rule("AEGIS-SEC-0003").goodExample.code).not.toMatch(/apiKey:\s*"/);

    const absent = client({});
    await expect(run(rule("AEGIS-SEC-0003").goodExample.code, absent.globals)).rejects.toThrow(
      "PAYMENT_API_KEY is not set",
    );
    expect(absent.made).toEqual([]);
  });
});

describe("AEGIS-SEC-0004: server-side ownership check", () => {
  type Invoice = { id: string; ownerId: string; total: number };
  const invoices: Invoice[] = [{ id: "7", ownerId: "user-b", total: 100 }];

  async function request(code: string, userId: string) {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
    const app = {
      get: (_route: string, _auth: unknown, h: typeof handler) => {
        handler = h;
      },
    };
    const db = {
      invoices: {
        findById: async (id: string) => invoices.find((i) => i.id === id) ?? null,
        findOne: async (q: Partial<Invoice>) =>
          invoices.find((i) => Object.entries(q).every(([k, v]) => i[k as keyof Invoice] === v)) ??
          null,
      },
    };
    await run(code, { app, db, requireLogin: () => undefined });
    const out: { status?: number; body?: unknown } = {};
    const res = {
      json(body: unknown) {
        out.body = body;
        return res;
      },
      status(code: number) {
        out.status = code;
        return res;
      },
    };
    await handler?.({ params: { id: "7" }, user: { id: userId } }, res);
    return out;
  }

  it("the unsafe example shows user B's invoice to user A", async () => {
    const out = await request(rule("AEGIS-SEC-0004").badExample.code, "user-a");
    expect(out.body).toEqual(invoices[0]);
  });

  it("the corrected example denies user A, and still serves the owner", async () => {
    const code = rule("AEGIS-SEC-0004").goodExample.code;
    const other = await request(code, "user-a");
    expect(other.status).toBe(404);
    expect(other.body).not.toEqual(invoices[0]);
    const owner = await request(code, "user-b");
    expect(owner.body).toEqual(invoices[0]);
  });
});

describe("AEGIS-COD-0001: asynchronous errors", () => {
  /** A failing operation that records whether anything ever consumed (awaited or caught) it. */
  async function post(code: string) {
    let handler: ((req: unknown, res: unknown) => unknown) | undefined;
    const state = { consumed: false, status: undefined as number | undefined, ended: false };
    const failing = {
      then(_ok: unknown, fail: (e: Error) => void) {
        state.consumed = true;
        fail(new Error("db down"));
      },
    };
    const app = {
      post: (_route: string, h: typeof handler) => {
        handler = h;
      },
    };
    const res = {
      status(c: number) {
        state.status = c;
        return res;
      },
      json() {
        state.ended = true;
        return res;
      },
      end() {
        state.ended = true;
        return res;
      },
    };
    await run(code, { app, saveOrder: () => failing, console: { error: () => undefined } });
    await handler?.({ body: {} }, res);
    return state;
  }

  it("the unsafe example reports success while the failure is never handled", async () => {
    const s = await post(rule("AEGIS-COD-0001").badExample.code);
    expect(s.status).toBe(201);
    expect(s.consumed).toBe(false);
  });

  it("the corrected example handles the failure and tells the caller", async () => {
    const s = await post(rule("AEGIS-COD-0001").goodExample.code);
    expect(s.consumed).toBe(true);
    expect(s.status).toBe(500);
  });
});

describe("AEGIS-DEP-0001: verify packages before installing", () => {
  const commands = (code: string) =>
    code
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#"));
  const distance = (a: string, b: string): number => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [
      i,
      ...Array<number>(b.length).fill(0),
    ]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i]![j] = Math.min(
          d[i - 1]![j]! + 1,
          d[i]![j - 1]! + 1,
          d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
    return d[a.length]![b.length]!;
  };

  it("the unsafe example installs an unpinned, uninspected name that is one typo from a popular package", () => {
    const cmds = commands(rule("AEGIS-DEP-0001").badExample.code);
    expect(cmds).toEqual(["npm install expresss"]);
    expect(cmds.some((c) => c.startsWith("npm view"))).toBe(false);
    expect(cmds[0]).not.toMatch(/@\d/);
    expect(distance("expresss", "express")).toBe(1);
  });

  it("the corrected example inspects first, installs an exact version, then reviews the change", () => {
    const cmds = commands(rule("AEGIS-DEP-0001").goodExample.code);
    const view = cmds.findIndex((c) => c.startsWith("npm view express"));
    const install = cmds.findIndex((c) => /^npm install express@\d+\.\d+\.\d+$/.test(c));
    const diff = cmds.findIndex((c) => c.startsWith("git diff") && c.includes("package-lock.json"));
    expect(view).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(view);
    expect(diff).toBeGreaterThan(install);
  });
});
