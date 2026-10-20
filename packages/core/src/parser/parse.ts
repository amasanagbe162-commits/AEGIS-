import { LineCounter, isMap, isScalar, parseDocument, visit, type Document } from "yaml";
import type { z } from "zod";
import { formatPath, type Diagnostic, type ParseResult } from "./diagnostics.js";

/** Hard cap on input size. Files larger than this are rejected before parsing. */
export const MAX_FILE_BYTES = 256 * 1024;

export type TextFormat = "yaml" | "json";

interface Position {
  line: number;
  col: number;
}

function locate(
  doc: Document.Parsed,
  lineCounter: LineCounter,
  path: readonly PropertyKey[],
): Position | undefined {
  for (let i = path.length; i >= 0; i--) {
    const sub = path.slice(0, i) as (string | number)[];
    let offset: number | undefined;
    const last = sub[sub.length - 1];
    if (typeof last === "string") {
      // Prefer the position of the key itself, it is where a human looks first.
      const parent = sub.length === 1 ? doc.contents : doc.getIn(sub.slice(0, -1), true);
      if (isMap(parent)) {
        const pair = parent.items.find((p) => isScalar(p.key) && p.key.value === last);
        if (pair && isScalar(pair.key) && pair.key.range) offset = pair.key.range[0];
      }
    }
    if (offset === undefined) {
      const node = i === 0 ? doc.contents : doc.getIn(sub, true);
      const range = (node as { range?: [number, number, number] | null } | null)?.range;
      if (range) offset = range[0];
    }
    if (offset !== undefined) return lineCounter.linePos(offset);
  }
  return undefined;
}

function jsonErrorPosition(text: string, message: string): Position | undefined {
  const m = /position (\d+)/.exec(message);
  if (!m) return undefined;
  const pos = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, pos).split("\n");
  return { line: before.length, col: (before[before.length - 1]?.length ?? 0) + 1 };
}

/**
 * Parse text as YAML (or strict JSON) and validate it against a Zod schema.
 *
 * Safety properties:
 * - Input size is capped.
 * - Only the YAML "core" schema is used: no custom tags, so nothing can be constructed or executed.
 * - YAML aliases are disallowed (prevents "billion laughs" expansion).
 * - Duplicate keys and multiple documents are errors.
 * - Unresolved tags are errors, not warnings.
 * - Nothing in the parsed content is ever evaluated.
 */
export function parseWithSchema<S extends z.ZodType>(
  input: string,
  schema: S,
  source: string,
  format: TextFormat = "yaml",
): ParseResult<z.output<S>> {
  const fail = (diag: Omit<Diagnostic, "source">[]): ParseResult<z.output<S>> => ({
    ok: false,
    diagnostics: diag.map((d) => ({ ...d, source })),
  });

  if (Buffer.byteLength(input, "utf8") > MAX_FILE_BYTES) {
    return fail([
      {
        severity: "error",
        path: "",
        message: `file is larger than the ${MAX_FILE_BYTES / 1024} KB limit`,
      },
    ]);
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (text.trim() === "") {
    return fail([{ severity: "error", path: "", message: "file is empty" }]);
  }

  if (format === "json") {
    try {
      JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : "invalid JSON";
      const pos = jsonErrorPosition(text, message);
      return fail([
        {
          severity: "error",
          path: "",
          message: `invalid JSON: ${message}`,
          ...(pos ? { line: pos.line, column: pos.col } : {}),
        },
      ]);
    }
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, {
    schema: "core",
    version: "1.2",
    uniqueKeys: true,
    lineCounter,
  });

  const syntax: Omit<Diagnostic, "source">[] = [];
  for (const e of [...doc.errors, ...doc.warnings]) {
    const pos = e.linePos?.[0];
    syntax.push({
      severity: "error",
      path: "",
      message: e.message.split("\n")[0] ?? "syntax error",
      ...(pos ? { line: pos.line, column: pos.col } : {}),
    });
  }
  // Aliases (*name) are refused outright: they allow exponential expansion attacks.
  visit(doc, {
    Alias(_key, node) {
      const pos = node.range ? lineCounter.linePos(node.range[0]) : undefined;
      syntax.push({
        severity: "error",
        path: "",
        message: "YAML aliases are not allowed",
        ...(pos ? { line: pos.line, column: pos.col } : {}),
      });
    },
  });
  if (syntax.length > 0) return fail(syntax);

  const data: unknown = doc.toJS({ maxAliasCount: 0 });
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, value: result.data, diagnostics: [] };
  }

  const problems: Omit<Diagnostic, "source">[] = [];
  for (const issue of result.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        const pos = locate(doc, lineCounter, [...issue.path, key]);
        problems.push({
          severity: "error",
          path: formatPath([...issue.path, key]),
          message: `unknown field '${key}'`,
          ...(pos ? { line: pos.line, column: pos.col } : {}),
        });
      }
      continue;
    }
    const pos = locate(doc, lineCounter, issue.path);
    problems.push({
      severity: "error",
      path: formatPath(issue.path),
      message: issue.message,
      ...(pos ? { line: pos.line, column: pos.col } : {}),
    });
  }
  return fail(problems);
}
