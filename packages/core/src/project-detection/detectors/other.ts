import type { DetectedItem, ProjectDetector } from "../types.js";

/** Languages detected from a manifest file only. No rules exist for them yet. */
const MANIFEST_LANGUAGES: [string, string][] = [
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
];

export const manifestDetector: ProjectDetector = {
  name: "manifests",
  async detect(ctx) {
    const languages: DetectedItem[] = [];
    for (const [file, name] of MANIFEST_LANGUAGES) {
      if (ctx.has(file)) {
        languages.push({
          name,
          confidence: "high",
          evidence: [{ file, detail: "manifest exists" }],
        });
      }
    }
    return { languages };
  },
};

export const sqlDetector: ProjectDetector = {
  name: "sql",
  async detect(ctx) {
    const files = ctx.match(/\.sql$/i);
    if (files.length === 0) return {};
    return {
      languages: [
        {
          name: "sql",
          confidence: "high",
          evidence: files.slice(0, 3).map((file) => ({ file, detail: "SQL file" })),
        },
      ],
    };
  },
};
