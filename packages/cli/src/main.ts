#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "./program.js";
import { createRuntime } from "./runtime.js";

function readVersion(): string {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

process.exitCode = await run(process.argv.slice(2), createRuntime(readVersion()));
