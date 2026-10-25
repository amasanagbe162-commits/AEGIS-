import type { LearningEvidence, LearningRecord } from "./schema.js";

export type Transition = { ok: true; record: LearningRecord } | { ok: false; message: string };

const fail = (message: string): Transition => ({ ok: false, message });
const touch = (r: LearningRecord, at: string, patch: Partial<LearningRecord>): Transition => ({
  ok: true,
  record: { ...r, ...patch, updatedAt: at },
});

/** True when the evidence is a real AEGIS run in which every planned check ran and the result was clean. */
export function isVerifyingEvidence(e: LearningEvidence): boolean {
  return (
    e.kind === "aegis-check" &&
    e.verdict === "clean" &&
    e.checksPlanned > 0 &&
    e.checksPerformed === e.checksPlanned
  );
}

/** observed -> proposed: needs a root cause and a correction. */
export function propose(r: LearningRecord, at: string): Transition {
  if (r.status !== "observed")
    return fail(`only an observed record can be proposed (this one is ${r.status})`);
  if (!r.rootCause) return fail("add a root cause first");
  if (!r.correction) return fail("add the correction first");
  return touch(r, at, { status: "proposed" });
}

/**
 * proposed -> verified: the LATEST AEGIS check must be clean and complete. Notes never count,
 * and an incomplete run is not enough, because a skipped check proves nothing.
 */
export function verify(r: LearningRecord, at: string): Transition {
  if (r.status !== "proposed")
    return fail(`only a proposed record can be verified (this one is ${r.status})`);
  const latest = [...r.evidence].reverse().find((e) => e.kind === "aegis-check");
  if (!latest) return fail("no AEGIS check has been recorded yet; run 'aegis learn verify'");
  if (!isVerifyingEvidence(latest)) {
    return fail(
      latest.kind === "aegis-check" && latest.verdict === "incomplete"
        ? "the latest check was INCOMPLETE (some checks did not run), which is not verification"
        : "the latest AEGIS check was not clean",
    );
  }
  return touch(r, at, { status: "verified" });
}

/** verified -> approved: a named human reviewer and a reason. Nothing is approved automatically. */
export function approve(
  r: LearningRecord,
  reviewer: string,
  reason: string,
  at: string,
): Transition {
  if (r.status !== "verified")
    return fail(`only a verified record can be approved (this one is ${r.status})`);
  return touch(r, at, {
    status: "approved",
    review: { decision: "approved", reviewer, reason, at },
  });
}

export function reject(
  r: LearningRecord,
  reviewer: string,
  reason: string,
  at: string,
): Transition {
  if (!["observed", "proposed", "verified"].includes(r.status)) {
    return fail(`a ${r.status} record cannot be rejected`);
  }
  return touch(r, at, {
    status: "rejected",
    review: { decision: "rejected", reviewer, reason, at },
  });
}

export function supersede(r: LearningRecord, by: string, at: string): Transition {
  if (r.status !== "approved")
    return fail(`only an approved record can be superseded (this one is ${r.status})`);
  if (by === r.id) return fail("a record cannot supersede itself");
  return touch(r, at, { status: "superseded", supersededBy: by });
}

/** Changing the substance of a record voids earlier verification: it goes back to observed. */
export function amend(
  r: LearningRecord,
  patch: Partial<Pick<LearningRecord, "rootCause" | "correction">>,
  at: string,
): Transition {
  if (["rejected", "superseded"].includes(r.status))
    return fail(`a ${r.status} record cannot be changed`);
  return touch(r, at, {
    ...patch,
    status: "observed",
    evidence: [],
    review: undefined,
  } as Partial<LearningRecord>);
}
