import { z } from "zod";
import { trustedKeySchema } from "../updates/bundle.js";
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
        /**
         * Allow running tools installed inside the project (node_modules/.bin/tsc and eslint).
         * Off by default because that executes code that comes with the project.
         */
        allowProjectTools: z.boolean().default(false),
        /** Time limit for each external tool run. */
        toolTimeoutSeconds: z.number().int().min(5).max(1800).default(120),
      })
      .strict()
      .default({
        exclude: [],
        maxFileSizeKb: 1024,
        allowProjectTools: false,
        toolTimeoutSeconds: 120,
      }),
    selfCorrection: z
      .object({ maxAttempts: z.number().int().min(1).max(10).default(3) })
      .strict()
      .default({ maxAttempts: 3 }),
    updates: z
      .object({
        /** Off by default. Nothing contacts the network unless this is true. */
        enabled: z.boolean().default(false),
        /** Where `aegis rules update` fetches the signed bundle (https only), or a local file. */
        source: z.string().min(1).max(500).optional(),
        /** Public keys you trust to sign rule bundles, in addition to any built into AEGIS. */
        trustedKeys: z.array(trustedKeySchema).max(10).default([]),
      })
      .strict()
      .default({ enabled: false, trustedKeys: [] }),
  })
  .strict();

export type AegisConfig = z.infer<typeof configSchema>;
