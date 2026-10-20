// Writes JSON Schema files into formats/ from the Zod schemas (the single source of truth).
// Usage: npm run schemas   (builds first)
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { configSchema, masterFileSchema, ruleSchema } from "../packages/core/dist/index.js";

const outputs = {
  "formats/rule-schema.json": ruleSchema,
  "formats/aegis-master-schema.json": masterFileSchema,
  "formats/config-schema.json": configSchema,
};

for (const [file, schema] of Object.entries(outputs)) {
  const json = z.toJSONSchema(schema, { io: "input" });
  await writeFile(new URL(`../${file}`, import.meta.url), JSON.stringify(json, null, 2) + "\n");
  console.log(`wrote ${file}`);
}
