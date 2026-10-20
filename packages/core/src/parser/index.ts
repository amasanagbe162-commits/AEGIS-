export * from "./diagnostics.js";
export * from "./parse.js";
import { parseWithSchema } from "./parse.js";
import { configSchema, masterFileSchema, ruleSchema } from "../schemas/index.js";

export const parseRule = (text: string, source = "<rule>") =>
  parseWithSchema(text, ruleSchema, source);

export const parseMasterFile = (text: string, source = "<master>") =>
  parseWithSchema(text, masterFileSchema, source);

export const parseConfig = (text: string, source = "aegis.config.json") =>
  parseWithSchema(text, configSchema, source, "json");
