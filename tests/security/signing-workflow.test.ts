import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowsDir = path.join(root, ".github/workflows");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { environment?: string; steps: Step[] }>;
}
const load = (name: string) =>
  parseYaml(readFileSync(path.join(workflowsDir, name), "utf8")) as Workflow;

describe("the signing workflow cannot leak or misuse the key", () => {
  const wf = load("sign-rules.yml");
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps);

  it("only runs when a person starts it, with read-only repository access", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read" });
  });

  it("runs in a protected environment so required reviewers can gate the secret", () => {
    expect(wf.jobs["sign"]?.environment).toBe("release-signing");
  });

  it("references the secret only through an env block, never inside script text", () => {
    for (const s of steps) {
      expect(s.run ?? "", s.name).not.toMatch(/\$\{\{\s*secrets\./);
      expect(s.run ?? "", s.name).not.toMatch(/\$\{\{\s*(inputs|vars)\.[^}]*\}\}/); // inputs reach scripts via env, never by interpolation
    }
    const sign = steps.find((s) => s.name === "Sign the bundle");
    expect(sign?.env?.["SIGNING_KEY"]).toBe("${{ secrets.AEGIS_RULES_SIGNING_KEY }}");
  });

  it("never prints the key, and writes it to an owner-only temp file that is always removed", () => {
    const script = steps.find((s) => s.name === "Sign the bundle")?.run ?? "";
    expect(script).toContain("umask 077");
    expect(script).toMatch(/trap 'rm -f "\$keyfile"' EXIT/);
    // Every line that expands the key's VALUE must be the emptiness test or the redirect into the temp file.
    for (const line of script.split("\n").filter((l) => /\$\{?SIGNING_KEY\b/.test(l))) {
      const allowed =
        /^test -n "\$SIGNING_KEY" \|\|/.test(line.trim()) ||
        /^printf '%s\\n' "\$SIGNING_KEY" > "\$keyfile"$/.test(line.trim());
      expect(allowed, line).toBe(true);
    }
    expect(script).not.toMatch(/\bset -x\b|set -o xtrace/);
    expect(script).not.toMatch(/\bcat\b[^\n]*keyfile/);
  });

  it("verifies before delivering, and only attaches the result to the run", () => {
    const names = steps.map((s) => s.name ?? s.uses ?? "");
    expect(names.indexOf("Validate the rules before signing anything")).toBeLessThan(
      names.indexOf("Sign the bundle"),
    );
    expect(names.indexOf("Sign the bundle")).toBeLessThan(
      names.indexOf("Verify the bundle against the keys built into AEGIS"),
    );
    expect(steps.filter((s) => s.uses?.startsWith("actions/upload-artifact")).length).toBe(1);
    expect(
      steps.find((s) => s.uses?.startsWith("actions/checkout"))?.with?.["persist-credentials"],
    ).toBe(false);
  });

  it("no workflow in the repository publishes, pushes or releases anything", () => {
    for (const file of readdirSync(workflowsDir)) {
      const text = readFileSync(path.join(workflowsDir, file), "utf8");
      expect(text, file).not.toMatch(
        /npm publish|git push|gh release|create-release|softprops\/action-gh-release|pypi-publish/,
      );
      expect(text, file).not.toMatch(/^\s*(contents|packages|id-token):\s*write/m);
    }
  });
});

describe("the repository contains no private keys", () => {
  const skip = new Set(["node_modules", "dist", ".git", "coverage"]);
  function* files(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      const info = statSync(full);
      if (info.isDirectory()) yield* files(full);
      else if (info.size < 1024 * 1024) yield full;
    }
  }

  it("no file holds a PEM private key block, and no key file is checked in", () => {
    const header = new RegExp("-----BEGIN [A-Z ]*PRIVATE KEY-----");
    for (const file of files(root)) {
      const rel = path.relative(root, file);
      expect(rel, "key file name").not.toMatch(/\.(pem|key|p12|pfx)$/);
      expect(readFileSync(file, "utf8"), rel).not.toMatch(header);
    }
  });

  it(".gitignore blocks key files so one careless 'git add' cannot publish them", () => {
    const ignore = readFileSync(path.join(root, ".gitignore"), "utf8").split("\n");
    for (const pattern of ["*.private.pem", "*.pem", "*.key", "*.p12"])
      expect(ignore).toContain(pattern);
  });

  it("no official signing key is built in yet: the trusted list is empty until the owner adds one", async () => {
    const { TRUSTED_KEYS } = await import("../../packages/rules/src/index.js");
    expect(TRUSTED_KEYS).toEqual([]);
  });
});
