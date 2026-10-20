import { z } from "zod";
import {
  agentSchema,
  categorySchema,
  protectionLevelSchema,
  relativePathSchema,
} from "./common.js";

/** Project configuration file: aegis.config.json */
export const configSchema = z
  .object({
    version: z.literal(1),
    protectionLevel: protectionLevelSchema.default("standard"),
    masterFile: relativePathSchema.default("AEGIS.aegis"),
    agents: z.array(agentSchema).max(10).default([]),
    ruleCollections: z.array(categorySchema).max(20).optional(),
    disabledRules: z
      .array(z.string().regex(/^AEGIS-(UNI|SEC|COD|DEP|CFG|TST|ARC)-\d{4}$/))
      .max(200)
      .default([]),
    scan: z
      .object({
        exclude: z.array(relativePathSchema).max(100).default([]),
        maxFileSizeKb: z.number().int().min(1).max(10240).default(1024),
      })
      .strict()
      .default({ exclude: [], maxFileSizeKb: 1024 }),
    selfCorrection: z
      .object({ maxAttempts: z.number().int().min(1).max(10).default(3) })
      .strict()
      .default({ maxAttempts: 3 }),
    updates: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .default({ enabled: false }),
  })
  .strict();

export type AegisConfig = z.infer<typeof configSchema>;
