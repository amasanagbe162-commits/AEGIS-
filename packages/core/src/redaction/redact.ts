/**
 * Redaction removes likely secrets from text before it reaches a report or a record.
 * It is pattern based, so it is a safety net and NOT a guarantee. Unknown secret formats
 * can slip through, which is why AEGIS also avoids reading secret files in the first place.
 */

interface Pattern {
  kind: string;
  regex: RegExp;
  /** Replace only this capture group, keeping the surrounding text (such as a variable name). */
  group?: number;
}

const PATTERNS: Pattern[] = [
  {
    kind: "private-key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { kind: "aws-access-key", regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  {
    kind: "github-token",
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  },
  { kind: "slack-token", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe-key", regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}\b/g },
  { kind: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    kind: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  },
  { kind: "bearer-token", regex: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi, group: 0 },
  {
    kind: "url-credentials",
    regex: /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s/@]+(?=@)/gi,
    group: 0,
  },
  {
    // password = "value", api_key: value, SECRET_TOKEN=value ...
    kind: "credential-assignment",
    regex:
      /\b([A-Za-z0-9_.-]*(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|auth[_-]?(?:token|key))[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)([^\s"'`,;]{4,})\2/gi,
    group: 3,
  },
];

export function redactText(input: string): string {
  let out = input;
  for (const p of PATTERNS) {
    out = out.replace(p.regex, (...args: unknown[]) => {
      const match = String(args[0]);
      if (p.kind === "bearer-token") return `${String(args[1])}[REDACTED:${p.kind}]`;
      if (p.kind === "url-credentials") return `${String(args[1])}[REDACTED:${p.kind}]`;
      if (p.group === 3) {
        // credential-assignment: keep the name and quotes, hide the value
        return `${String(args[1])}${String(args[2])}[REDACTED:${p.kind}]${String(args[2])}`;
      }
      return match.length > 0 ? `[REDACTED:${p.kind}]` : match;
    });
  }
  return out;
}

/** Redact every string inside a JSON-like value (objects, arrays, strings). */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Paths whose contents AEGIS must never read during detection or scanning of project facts. */
const SENSITIVE_PATH =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials|secrets?\.(json|ya?ml|toml))$|\.(pem|key|p12|pfx|keystore|jks)$/i;

export function isSensitivePath(relativePath: string): boolean {
  const p = relativePath.split("\\").join("/");
  if (/(^|\/)\.env\.(example|sample|template)$/i.test(p)) return false;
  return SENSITIVE_PATH.test(p);
}
