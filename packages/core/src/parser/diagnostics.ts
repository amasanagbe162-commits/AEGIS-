export type DiagnosticSeverity = "error" | "warning";

/** A problem found while reading or validating a file, with a location when one is known. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** File the problem came from (or a label such as "<input>"). */
  source: string;
  /** Field path such as "badExample.code" or "operatingRules[0].title". Empty for the whole file. */
  path: string;
  line?: number;
  column?: number;
}

export type ParseResult<T> =
  { ok: true; value: T; diagnostics: Diagnostic[] } | { ok: false; diagnostics: Diagnostic[] };

export function formatDiagnostic(d: Diagnostic): string {
  const where =
    d.line !== undefined ? `:${d.line}${d.column !== undefined ? `:${d.column}` : ""}` : "";
  const field = d.path ? ` [${d.path}]` : "";
  return `${d.severity}: ${d.source}${where}${field} ${d.message}`;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out ? `.${String(seg)}` : String(seg);
  }
  return out;
}
