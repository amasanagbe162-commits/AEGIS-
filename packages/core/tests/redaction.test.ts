import { describe, expect, it } from "vitest";
import { isSensitivePath, redactDeep, redactText } from "../src/index.js";

// Token-shaped strings are built at runtime so this file itself contains no secret-looking literals.
const ghToken = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0".repeat(2);
const awsKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const slack = "xo" + "xb-" + "1234567890-abcdefghij";
const stripe = "sk" + "_live_" + "abcdefghij1234567890";

describe("redactText", () => {
  it.each([
    ["GitHub token", ghToken],
    ["AWS access key", awsKey],
    ["Slack token", slack],
    ["Stripe key", stripe],
  ])("removes a %s", (_name, secret) => {
    const out = redactText(`found ${secret} in file`);
    expect(out).not.toContain(secret);
    expect(out).toContain("[REDACTED:");
  });

  it("removes private key blocks, including unterminated ones", () => {
    const body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC";
    const full = `-----BEGIN ${"PRIVATE"} KEY-----\n${body}\n-----END ${"PRIVATE"} KEY-----`;
    expect(redactText(full)).not.toContain(body);
    expect(redactText(`-----BEGIN ${"RSA PRIVATE"} KEY-----\n${body}`)).not.toContain(body);
  });

  it("keeps the variable name but hides the value of credential assignments", () => {
    const out = redactText('const password = "hunter2hunter2";');
    expect(out).toContain("password");
    expect(out).not.toContain("hunter2hunter2");
    expect(redactText("API_KEY=abcd1234efgh")).toBe("API_KEY=[REDACTED:credential-assignment]");
  });

  it("hides passwords inside URLs and bearer tokens", () => {
    expect(redactText("postgres://admin:s3cretpass@db.example.com/app")).not.toContain(
      "s3cretpass",
    );
    expect(redactText("Authorization: Bearer abcdefghijklmnop1234")).not.toContain(
      "abcdefghijklmnop1234",
    );
  });

  it("hides JWT-shaped tokens", () => {
    const jwt = [
      "eyJ" + "hbGciOiJIUzI1NiJ9",
      "eyJ" + "zdWIiOiIxMjM0NTYifQ",
      "c2lnbmF0dXJlMTIzNDU",
    ].join(".");
    expect(redactText(jwt)).not.toContain(jwt);
  });

  it("leaves ordinary text unchanged", () => {
    const text = "Use parameterized queries. The author wrote tests for src/index.ts line 42.";
    expect(redactText(text)).toBe(text);
  });

  it("is idempotent", () => {
    const once = redactText("token=abcdef123456");
    expect(redactText(once)).toBe(once);
  });
});

describe("redactDeep", () => {
  it("redacts strings nested in objects and arrays without changing other values", () => {
    const input = {
      n: 3,
      ok: true,
      list: [`key ${awsKey}`],
      nested: { msg: "password=letmein123" },
    };
    const out = redactDeep(input);
    expect(JSON.stringify(out)).not.toContain(awsKey);
    expect(JSON.stringify(out)).not.toContain("letmein123");
    expect(out.n).toBe(3);
    expect(out.ok).toBe(true);
  });
});

describe("isSensitivePath", () => {
  it.each([
    ".env",
    ".env.local",
    "config/.env.production",
    "certs/server.pem",
    "id_rsa",
    ".npmrc",
    "keys/app.key",
  ])("treats %s as sensitive", (p) => expect(isSensitivePath(p)).toBe(true));
  it.each(["package.json", ".env.example", "src/environment.ts", "README.md"])("allows %s", (p) =>
    expect(isSensitivePath(p)).toBe(false),
  );
});
