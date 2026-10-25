import { createHash } from "node:crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Hashes are computed on LF text so Git's CRLF conversion does not look like a user edit. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

const GENERATED_LINE = /^<!-- aegis:generated sha256=([0-9a-f]{64}) -->\n/m;
// Tolerates CRLF so that indexes stay valid in the ORIGINAL text and bytes outside the block are never rewritten.
const BLOCK =
  /<!-- aegis:begin sha256=([0-9a-f]{64}) -->\r?\n([\s\S]*?)\r?\n<!-- aegis:end -->(?:\r?\n)?/g;

/** Render a whole file that AEGIS owns. The hash covers everything except the marker line. */
export function renderOwned(frontMatter: string, body: string): string {
  const fm = frontMatter === "" || frontMatter.endsWith("\n") ? frontMatter : `${frontMatter}\n`;
  const text = body.endsWith("\n") ? body : `${body}\n`;
  const hash = sha256(fm + text);
  return `${fm}<!-- aegis:generated sha256=${hash} -->\n${text}`;
}

export type OwnedState =
  | { kind: "none" }
  /** The marker exists and the file is exactly what AEGIS wrote. `content` is the file without the marker line. */
  | { kind: "intact"; content: string }
  /** The marker exists but the file was edited afterwards. */
  | { kind: "edited" };

export function inspectOwned(fileText: string): OwnedState {
  const text = normalizeNewlines(fileText);
  const m = GENERATED_LINE.exec(text);
  if (!m || m.index === undefined) return { kind: "none" };
  const content = text.slice(0, m.index) + text.slice(m.index + m[0].length);
  return sha256(content) === m[1] ? { kind: "intact", content } : { kind: "edited" };
}

export function renderBlock(body: string): string {
  const inner = normalizeNewlines(body).trimEnd();
  return `<!-- aegis:begin sha256=${sha256(inner)} -->\n${inner}\n<!-- aegis:end -->\n`;
}

export type BlockState =
  | { kind: "none" }
  | { kind: "intact"; start: number; end: number; inner: string }
  | { kind: "edited" }
  /** More than one AEGIS block, or a begin marker without a matching end. AEGIS will not guess. */
  | { kind: "ambiguous" };

export function inspectBlock(fileText: string): BlockState {
  const text = fileText;
  const begins = text.split("<!-- aegis:begin").length - 1;
  if (begins === 0) return { kind: "none" };
  const matches = [...text.matchAll(BLOCK)];
  if (begins !== 1 || matches.length !== 1) return { kind: "ambiguous" };
  const m = matches[0];
  if (!m || m.index === undefined) return { kind: "ambiguous" };
  const inner = normalizeNewlines(m[2] ?? "");
  if (sha256(inner) !== m[1]) return { kind: "edited" };
  return { kind: "intact", start: m.index, end: m.index + m[0].length, inner };
}
