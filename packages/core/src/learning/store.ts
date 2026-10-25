import { lstat, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactDeep } from "../redaction/redact.js";
import { learningRecordSchema, type LearningRecord } from "./schema.js";

const DIR = path.join(".aegis", "learning");
const FILE = /^LR-(\d{4})\.json$/;
const MAX_BYTES = 64 * 1024;

export interface LearningLoad {
  records: LearningRecord[];
  /** Files that could not be used, with the reason. They are reported, never silently dropped. */
  problems: { file: string; message: string }[];
}

export async function loadRecords(root: string): Promise<LearningLoad> {
  const dir = path.join(root, DIR);
  const out: LearningLoad = { records: [], problems: [] };
  let names: string[];
  try {
    const info = await lstat(dir);
    if (!info.isDirectory())
      return { ...out, problems: [{ file: DIR, message: "is not a folder" }] };
    names = (await readdir(dir)).sort();
  } catch {
    return out;
  }
  for (const name of names) {
    if (!FILE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      const info = await lstat(file);
      if (!info.isFile())
        throw new Error("is not a regular file (symbolic links are not followed)");
      if (info.size > MAX_BYTES) throw new Error("is larger than 64 KB");
      const parsed = learningRecordSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
      if (!parsed.success) {
        const i = parsed.error.issues[0];
        throw new Error(`invalid: ${i?.path.join(".") || "record"} ${i?.message ?? ""}`.trim());
      }
      if (`${parsed.data.id}.json` !== name) throw new Error("the id does not match the file name");
      out.records.push(parsed.data);
    } catch (err) {
      out.problems.push({ file: name, message: err instanceof Error ? err.message : "unreadable" });
    }
  }
  return out;
}

export function nextId(
  records: readonly LearningRecord[],
  problems: LearningLoad["problems"] = [],
): string {
  const used = [
    ...records.map((r) => r.id),
    ...problems.map((p) => p.file.replace(".json", "")),
  ].map((id) => Number(/^LR-(\d{4})/.exec(id)?.[1] ?? 0));
  return `LR-${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

export interface SaveResult {
  record: LearningRecord;
  /** True when redaction changed something, so the person can be told. */
  redacted: boolean;
}

/**
 * Validate, redact and write one record. New records use an exclusive create so two writers can
 * never take the same id; updates replace the file through a temporary file.
 */
export async function saveRecord(
  root: string,
  input: LearningRecord,
  isNew: boolean,
): Promise<SaveResult> {
  const clean = redactDeep(input);
  const redacted = JSON.stringify(clean) !== JSON.stringify(input);
  const record = learningRecordSchema.parse(clean);
  const dir = path.join(root, DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${record.id}.json`);
  const text = JSON.stringify(record, null, 2) + "\n";
  if (isNew) {
    await writeFile(file, text, { flag: "wx", mode: 0o644 });
  } else {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, text, { flag: "wx", mode: 0o644 });
    await rename(tmp, file);
  }
  return { record, redacted };
}
