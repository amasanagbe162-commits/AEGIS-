import type { Confidence } from "../schemas/common.js";

export interface Evidence {
  /** Relative path of the file that provided the evidence. */
  file: string;
  /** What was seen, for example "dependency 'next'" or "file exists". Never a secret value. */
  detail: string;
}

export interface DetectedItem {
  name: string;
  confidence: Confidence;
  evidence: Evidence[];
}

/** What the detectors learned about a project. All claims carry evidence. */
export interface ProjectProfile {
  root: string;
  languages: DetectedItem[];
  frameworks: DetectedItem[];
  packageManagers: DetectedItem[];
  /** Project tooling relevant to verification, such as "tsc" or "eslint". */
  tools: DetectedItem[];
  /** Things the detectors could not settle. Reported instead of guessed. */
  uncertainties: string[];
  filesIndexed: number;
  /** True when the file limit was hit and detection saw only part of the project. */
  truncated: boolean;
}

export interface DetectionContext {
  root: string;
  /** Relative POSIX paths of indexed files. */
  files: readonly string[];
  has(relativePath: string): boolean;
  /** Indexed files whose path matches the expression. */
  match(pattern: RegExp): string[];
  /**
   * Read a text file from the index. Returns undefined for files that are not indexed,
   * are too large, or are sensitive (such as .env files). Secret files are never read.
   */
  readText(relativePath: string): Promise<string | undefined>;
}

export interface PartialProfile {
  languages?: DetectedItem[];
  frameworks?: DetectedItem[];
  packageManagers?: DetectedItem[];
  tools?: DetectedItem[];
  uncertainties?: string[];
}

/** Detectors are small and independent. Add support for a new ecosystem by adding one. */
export interface ProjectDetector {
  name: string;
  detect(ctx: DetectionContext): Promise<PartialProfile>;
}
