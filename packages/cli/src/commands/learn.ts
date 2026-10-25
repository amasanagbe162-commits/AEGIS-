import {
  amend,
  approve,
  inspectProject,
  learningRecordSchema,
  loadRecords,
  nextId,
  propose,
  reject,
  saveRecord,
  supersede,
  verify,
  type Category,
  type LearningRecord,
  type LearningStatus,
  type Transition,
} from "@aegis/core";
import { RULES_DIR } from "@aegis/rules";
import type { Runtime } from "../runtime.js";
import { resolveRoot } from "../util/resolve-root.js";

const nowIso = (rt: Runtime) => (rt.now ?? (() => new Date()))().toISOString();

async function context(rt: Runtime, pathArg: string | undefined) {
  const resolved = await resolveRoot(rt, pathArg);
  if (!resolved.ok) {
    rt.err(`aegis: ${resolved.message}\n`);
    return undefined;
  }
  const loaded = await loadRecords(resolved.root);
  for (const p of loaded.problems) rt.err(`aegis: ${p.file} ${p.message}\n`);
  return { root: resolved.root, ...loaded };
}

async function persist(
  rt: Runtime,
  root: string,
  record: LearningRecord,
  isNew: boolean,
): Promise<boolean> {
  try {
    const { redacted } = await saveRecord(root, record, isNew);
    if (redacted) rt.out("Note: something that looked like a secret was redacted before saving.\n");
    return true;
  } catch (err) {
    rt.err(
      `aegis: could not save ${record.id}: ${err instanceof Error ? err.message : "unknown error"}\n`,
    );
    return false;
  }
}

function find(
  rt: Runtime,
  records: readonly LearningRecord[],
  id: string,
): LearningRecord | undefined {
  const r = records.find((x) => x.id === id.toUpperCase());
  if (!r) rt.err(`aegis: no record ${id}. Run 'aegis learn list'.\n`);
  return r;
}

function applyTransition(rt: Runtime, t: Transition): LearningRecord | undefined {
  if (!t.ok) {
    rt.err(`aegis: ${t.message}\n`);
    return undefined;
  }
  return t.record;
}

export interface AddOptions {
  title: string;
  issue: string;
  category: Category;
  language?: string[];
  rootCause?: string;
  correction?: string;
}

export async function learnAddCommand(
  rt: Runtime,
  pathArg: string | undefined,
  o: AddOptions,
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const at = nowIso(rt);
  const draft = {
    version: 1 as const,
    id: nextId(ctx.records, ctx.problems),
    status: "observed" as const,
    createdAt: at,
    updatedAt: at,
    title: o.title,
    category: o.category,
    languages: o.language ?? [],
    issue: o.issue,
    ...(o.rootCause ? { rootCause: o.rootCause } : {}),
    ...(o.correction ? { correction: o.correction } : {}),
    evidence: [],
  };
  const parsed = learningRecordSchema.safeParse(draft);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    rt.err(`aegis: ${i?.path.join(".") || "record"}: ${i?.message ?? "invalid"}\n`);
    return 2;
  }
  let record = parsed.data;
  if (record.rootCause && record.correction) {
    const p = propose(record, at);
    if (p.ok) record = p.record;
  }
  if (!(await persist(rt, ctx.root, record, true))) return 2;
  rt.out(`Saved ${record.id} (${record.status}): ${record.title}\n`);
  rt.out(
    record.status === "observed"
      ? "Next: add the root cause and correction with 'aegis learn amend', then run 'aegis learn verify'.\n"
      : `Next: fix is in place? Run 'aegis learn verify ${record.id}' to record a real AEGIS check.\n`,
  );
  return 0;
}

export async function learnListCommand(
  rt: Runtime,
  pathArg: string | undefined,
  o: { status?: LearningStatus; json?: boolean },
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const shown = ctx.records.filter((r) => !o.status || r.status === o.status);
  if (o.json) {
    rt.out(JSON.stringify(shown, null, 2) + "\n");
    return ctx.problems.length > 0 ? 2 : 0;
  }
  if (shown.length === 0) rt.out("No learning records.\n");
  for (const r of shown)
    rt.out(`${r.id}  ${r.status.padEnd(10)} ${r.category.padEnd(14)} ${r.title}\n`);
  return ctx.problems.length > 0 ? 2 : 0;
}

export async function learnShowCommand(
  rt: Runtime,
  id: string,
  pathArg: string | undefined,
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const r = find(rt, ctx.records, id);
  if (!r) return 2;
  rt.out(
    `${r.id} [${r.status}] ${r.title}\n  category: ${r.category}  languages: ${r.languages.join(", ") || "any"}\n`,
  );
  rt.out(
    `  issue: ${r.issue}\n  root cause: ${r.rootCause ?? "(not recorded)"}\n  correction: ${r.correction ?? "(not recorded)"}\n`,
  );
  for (const e of r.evidence) {
    rt.out(
      e.kind === "aegis-check"
        ? `  evidence: AEGIS check at ${e.level} level on ${e.at}: ${e.verdict} (${e.checksPerformed}/${e.checksPlanned} checks ran)\n`
        : `  note (self-reported, never verifies): ${e.text}\n`,
    );
  }
  if (r.review)
    rt.out(`  review: ${r.review.decision} by ${r.review.reviewer}: ${r.review.reason}\n`);
  if (r.supersededBy) rt.out(`  superseded by ${r.supersededBy}\n`);
  return 0;
}

export async function learnAmendCommand(
  rt: Runtime,
  id: string,
  pathArg: string | undefined,
  o: { rootCause?: string; correction?: string },
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const r = find(rt, ctx.records, id);
  if (!r) return 2;
  if (!o.rootCause && !o.correction) {
    rt.err("aegis: pass --root-cause and/or --correction\n");
    return 2;
  }
  const at = nowIso(rt);
  let next = applyTransition(
    rt,
    amend(
      r,
      {
        ...(o.rootCause ? { rootCause: o.rootCause } : {}),
        ...(o.correction ? { correction: o.correction } : {}),
      },
      at,
    ),
  );
  if (!next) return 2;
  if (next.rootCause && next.correction) next = applyTransition(rt, propose(next, at)) ?? next;
  if (!learningRecordSchema.safeParse(next).success) {
    rt.err("aegis: the change is not valid (do not paste code; describe it in words)\n");
    return 2;
  }
  if (!(await persist(rt, ctx.root, next, false))) return 2;
  rt.out(`Updated ${next.id} (${next.status}). Earlier verification, if any, was cleared.\n`);
  return 0;
}

/** Runs the real checks and records what AEGIS saw. Only a clean, complete run can verify a record. */
export async function learnVerifyCommand(
  rt: Runtime,
  id: string,
  pathArg: string | undefined,
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const r = find(rt, ctx.records, id);
  if (!r) return 2;
  if (r.status !== "proposed") {
    rt.err(`aegis: only a proposed record can be verified (${r.id} is ${r.status})\n`);
    return 2;
  }
  const report = await inspectProject({
    root: ctx.root,
    rulesDir: RULES_DIR,
    toolVersion: rt.version,
    ...(rt.runners ? { runners: rt.runners } : {}),
  });
  const at = nowIso(rt);
  const withEvidence: LearningRecord = {
    ...r,
    updatedAt: at,
    evidence: [
      ...r.evidence,
      {
        kind: "aegis-check",
        at,
        level: report.protectionLevel,
        verdict: report.verdict,
        checksPerformed: report.summary.checksPerformed,
        checksPlanned: report.summary.checksPlanned,
      },
    ],
  };
  const result = verify(withEvidence, at);
  const final = result.ok ? result.record : withEvidence;
  if (!(await persist(rt, ctx.root, final, false))) return 2;
  rt.out(
    `AEGIS check: ${report.verdict.toUpperCase()} (${report.summary.checksPerformed}/${report.summary.checksPlanned} checks ran, ${report.summary.blockingFindings} blocking finding(s)).\n`,
  );
  if (result.ok) {
    rt.out(
      `${r.id} is now verified. A person must review it before it is used: aegis learn review ${r.id} --approve ...\n`,
    );
    return 0;
  }
  rt.out(`${r.id} stays proposed: ${result.message}.\n`);
  return 1;
}

export interface ReviewOptions {
  approve?: boolean;
  reject?: boolean;
  reviewer: string;
  reason: string;
}

/**
 * Approval is a human decision, so it needs a terminal and a confirmation. It cannot be
 * scripted with --yes, which keeps an agent that runs shell commands from approving its own work.
 */
export async function learnReviewCommand(
  rt: Runtime,
  id: string,
  pathArg: string | undefined,
  o: ReviewOptions,
): Promise<number> {
  if (o.approve === o.reject) {
    rt.err("aegis: choose exactly one of --approve or --reject\n");
    return 2;
  }
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const r = find(rt, ctx.records, id);
  if (!r) return 2;
  const at = nowIso(rt);
  const t = o.approve ? approve(r, o.reviewer, o.reason, at) : reject(r, o.reviewer, o.reason, at);
  const next = applyTransition(rt, t);
  if (!next) return 2;
  if (o.approve) {
    if (!rt.interactive) {
      rt.err(
        "aegis: approving a lesson needs a person at a terminal, so it cannot run here. Nothing was changed.\n",
      );
      return 2;
    }
    rt.out(`${r.id}: ${r.title}\n  correction: ${r.correction ?? ""}\n`);
    if (!(await rt.prompter.confirm(`Approve ${r.id} so agents are told to follow it?`))) {
      rt.out("Nothing was changed.\n");
      return 0;
    }
  }
  if (!(await persist(rt, ctx.root, next, false))) return 2;
  rt.out(`${next.id} is now ${next.status}.\n`);
  if (o.approve) rt.out("Run 'aegis agents sync' so agent instruction files include it.\n");
  return 0;
}

export async function learnSupersedeCommand(
  rt: Runtime,
  id: string,
  pathArg: string | undefined,
  o: { by: string },
): Promise<number> {
  const ctx = await context(rt, pathArg);
  if (!ctx) return 2;
  const r = find(rt, ctx.records, id);
  const by = find(rt, ctx.records, o.by);
  if (!r || !by) return 2;
  if (by.status !== "approved") {
    rt.err(`aegis: ${by.id} must be approved to replace another record\n`);
    return 2;
  }
  const next = applyTransition(rt, supersede(r, by.id, nowIso(rt)));
  if (!next || !(await persist(rt, ctx.root, next, false))) return 2;
  rt.out(`${next.id} is now superseded by ${by.id}.\n`);
  return 0;
}
