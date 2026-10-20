import path from "node:path";
import { realpath } from "node:fs/promises";
import { createDetectionContext, indexProject, type IndexOptions } from "./index-files.js";
import { nodeDetector } from "./detectors/node.js";
import { pythonDetector } from "./detectors/python.js";
import { manifestDetector, sqlDetector } from "./detectors/other.js";
import type { DetectedItem, PartialProfile, ProjectDetector, ProjectProfile } from "./types.js";

export const DEFAULT_DETECTORS: readonly ProjectDetector[] = [
  nodeDetector,
  pythonDetector,
  manifestDetector,
  sqlDetector,
];

const ORDER = { low: 0, medium: 1, high: 2 } as const;

function mergeItems(lists: (DetectedItem[] | undefined)[]): DetectedItem[] {
  const byName = new Map<string, DetectedItem>();
  for (const list of lists) {
    for (const it of list ?? []) {
      const existing = byName.get(it.name);
      if (!existing) {
        byName.set(it.name, { ...it, evidence: [...it.evidence] });
      } else {
        if (ORDER[it.confidence] > ORDER[existing.confidence]) existing.confidence = it.confidence;
        existing.evidence.push(...it.evidence);
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Inspect a project and report what it appears to be, with evidence and uncertainty.
 * Only file names and non-secret manifest files are read. Dependency caches, build output
 * and .gitignore'd paths are skipped.
 */
export async function detectProject(
  rootInput: string,
  options: IndexOptions & { detectors?: readonly ProjectDetector[] } = {},
): Promise<ProjectProfile> {
  const root = await realpath(path.resolve(rootInput));
  const index = await indexProject(root, options);
  const ctx = createDetectionContext(root, index.files);

  const uncertainties: string[] = [];
  const parts: PartialProfile[] = [];
  for (const detector of options.detectors ?? DEFAULT_DETECTORS) {
    try {
      parts.push(await detector.detect(ctx));
    } catch (err) {
      uncertainties.push(
        `Detector '${detector.name}' failed: ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    }
  }

  const languages = mergeItems(parts.map((p) => p.languages));
  const frameworks = mergeItems(parts.map((p) => p.frameworks));
  for (const p of parts) uncertainties.push(...(p.uncertainties ?? []));

  if (languages.length === 0) {
    uncertainties.push(
      "No supported language was detected, so language-specific rules cannot be selected.",
    );
  }
  if (index.truncated) {
    uncertainties.push(
      "The project is large: detection stopped at the file limit and saw only part of it.",
    );
  }

  return {
    root,
    languages,
    frameworks,
    packageManagers: mergeItems(parts.map((p) => p.packageManagers)),
    tools: mergeItems(parts.map((p) => p.tools)),
    uncertainties,
    filesIndexed: index.files.length,
    truncated: index.truncated,
  };
}
