import type { DetectedItem, ProjectDetector } from "../types.js";

const MANIFESTS = ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "Pipfile"];
const FRAMEWORKS = ["django", "flask", "fastapi"] as const;

function requirementNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line);
    if (m?.[1]) names.add(m[1].toLowerCase().replace(/_/g, "-"));
  }
  return names;
}

export const pythonDetector: ProjectDetector = {
  name: "python",
  async detect(ctx) {
    const found = MANIFESTS.filter((m) => ctx.has(m));
    const pyFiles = ctx.match(/\.py$/);
    const out = {
      languages: [] as DetectedItem[],
      frameworks: [] as DetectedItem[],
      packageManagers: [] as DetectedItem[],
      uncertainties: [] as string[],
    };
    if (found.length === 0 && pyFiles.length === 0) return out;

    if (found.length > 0) {
      out.languages.push({
        name: "python",
        confidence: "high",
        evidence: found.map((file) => ({ file, detail: "Python manifest exists" })),
      });
    } else {
      out.languages.push({
        name: "python",
        confidence: "medium",
        evidence: [{ file: pyFiles[0] as string, detail: "Python source file (no manifest)" }],
      });
    }

    const lockTools: [string, string][] = [
      ["poetry.lock", "poetry"],
      ["uv.lock", "uv"],
      ["Pipfile.lock", "pipenv"],
    ];
    for (const [file, name] of lockTools) {
      if (ctx.has(file)) {
        out.packageManagers.push({
          name,
          confidence: "high",
          evidence: [{ file, detail: "lockfile exists" }],
        });
      }
    }
    if (ctx.has("requirements.txt")) {
      out.packageManagers.push({
        name: "pip",
        confidence: "medium",
        evidence: [{ file: "requirements.txt", detail: "file exists" }],
      });
    }

    // Framework detection from declared dependencies (medium: a dependency alone is not proof).
    const names = new Set<string>();
    const req = await ctx.readText("requirements.txt");
    if (req) for (const n of requirementNames(req)) names.add(n);
    const pyproject = await ctx.readText("pyproject.toml");
    const fromPyproject = new Set<string>();
    if (pyproject) {
      for (const fw of FRAMEWORKS) {
        if (new RegExp(`["']\\s*${fw}(?![A-Za-z0-9_-])`, "i").test(pyproject))
          fromPyproject.add(fw);
      }
    }
    for (const fw of FRAMEWORKS) {
      const file = names.has(fw)
        ? "requirements.txt"
        : fromPyproject.has(fw)
          ? "pyproject.toml"
          : undefined;
      if (file) {
        out.frameworks.push({
          name: fw,
          confidence: "medium",
          evidence: [{ file, detail: `dependency '${fw}'` }],
        });
      }
    }
    return out;
  },
};
