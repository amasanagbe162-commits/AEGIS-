import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { z } from "zod";
import { semverSchema } from "../schemas/common.js";

/**
 * Signed rule bundles. A bundle is DATA: rule files as text plus a manifest and an Ed25519
 * signature over the manifest. Nothing in a bundle is ever executed, and a bundle cannot carry
 * scanner configurations or code, only rule text that passes the same validation as bundled rules.
 */
export const BUNDLE_FORMAT = "aegis-rules-bundle" as const;
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const MAX_BUNDLE_RULES = 200;
const MAX_RULE_BYTES = 64 * 1024;

export const keyIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,39}$/, "must be a short lowercase id");

/** A public key the person trusts: base64 of the SPKI DER encoding of an Ed25519 public key. */
export const trustedKeySchema = z
  .object({ id: keyIdSchema, publicKey: z.string().regex(/^[A-Za-z0-9+/]{40,100}={0,2}$/) })
  .strict();
export type TrustedKey = z.infer<typeof trustedKeySchema>;

const rulePathSchema = z
  .string()
  .regex(
    /^(universal|security|coding-errors|dependencies|configuration|testing|architecture)\/AEGIS-[A-Z]{3}-\d{4}\.yaml$/,
    "must look like security/AEGIS-SEC-0001.yaml",
  );

export const manifestSchema = z
  .object({
    bundleVersion: semverSchema,
    /** Oldest AEGIS version that can use this bundle. */
    minAegisVersion: semverSchema,
    createdAt: z.string().datetime(),
    keyId: keyIdSchema,
    rules: z
      .array(
        z
          .object({
            path: rulePathSchema,
            content: z.string().min(1).max(MAX_RULE_BYTES),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BUNDLE_RULES),
  })
  .strict();
export type BundleManifest = z.infer<typeof manifestSchema>;

export const bundleSchema = z
  .object({
    format: z.literal(BUNDLE_FORMAT),
    formatVersion: z.literal(1),
    manifest: manifestSchema,
    signature: z.string().regex(/^[A-Za-z0-9+/]{80,100}={0,2}$/),
  })
  .strict();
export type SignedBundle = z.infer<typeof bundleSchema>;

/** Deterministic JSON (sorted keys), so signer and verifier hash exactly the same bytes. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
    .join(",")}}`;
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function generateSigningKey(): { privatePem: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function signBundle(manifest: BundleManifest, privatePem: string): SignedBundle {
  const parsed = manifestSchema.parse(manifest);
  const key = createPrivateKey(privatePem);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("the signing key must be an Ed25519 key");
  const signature = cryptoSign(null, Buffer.from(canonicalize(parsed)), key).toString("base64");
  return { format: BUNDLE_FORMAT, formatVersion: 1, manifest: parsed, signature };
}

export type VerifyFailure =
  | "too-large"
  | "malformed"
  | "unknown-key"
  | "bad-signature"
  | "incompatible"
  | "not-newer"
  | "same-version";

export type VerifyResult =
  { ok: true; bundle: SignedBundle } | { ok: false; code: VerifyFailure; message: string };

const fail = (code: VerifyFailure, message: string): VerifyResult => ({ ok: false, code, message });

export interface VerifyOptions {
  trustedKeys: readonly TrustedKey[];
  /** Version of AEGIS that would use the bundle. */
  aegisVersion: string;
  /** Version of the rules in use now. A bundle must be newer, so an old bundle cannot be replayed. */
  currentVersion: string;
}

/**
 * Check a downloaded bundle. The signature is verified BEFORE anything else in the manifest is
 * trusted. A checksum alone would not do: whoever can change the bundle can change the checksum.
 */
export function verifyBundle(text: string, o: VerifyOptions): VerifyResult {
  if (Buffer.byteLength(text, "utf8") > MAX_BUNDLE_BYTES) {
    return fail("too-large", `the bundle is larger than ${MAX_BUNDLE_BYTES / 1024 / 1024} MB`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("malformed", "the bundle is not valid JSON");
  }
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(
      "malformed",
      `the bundle is malformed: ${i?.path.join(".") || "document"} ${i?.message ?? ""}`.trim(),
    );
  }
  const bundle = parsed.data;

  const trusted = o.trustedKeys.find((k) => k.id === bundle.manifest.keyId);
  if (!trusted) {
    return fail(
      "unknown-key",
      `the bundle is signed with key '${bundle.manifest.keyId}', which you do not trust. Add its public key to updates.trustedKeys in aegis.config.json only if you got it from the publisher through a channel you trust`,
    );
  }
  let valid: boolean;
  try {
    const key = createPublicKey({
      key: Buffer.from(trusted.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    valid =
      key.asymmetricKeyType === "ed25519" &&
      cryptoVerify(
        null,
        Buffer.from(canonicalize(bundle.manifest)),
        key,
        Buffer.from(bundle.signature, "base64"),
      );
  } catch {
    valid = false;
  }
  if (!valid)
    return fail(
      "bad-signature",
      "the signature does not match: the bundle was changed or is not from the key's owner",
    );

  if (compareSemver(bundle.manifest.minAegisVersion, o.aegisVersion) > 0) {
    return fail(
      "incompatible",
      `the bundle needs AEGIS ${bundle.manifest.minAegisVersion} or newer (this is ${o.aegisVersion})`,
    );
  }
  const cmp = compareSemver(bundle.manifest.bundleVersion, o.currentVersion);
  if (cmp === 0) return fail("same-version", `rules ${o.currentVersion} are already in use`);
  if (cmp < 0) {
    return fail(
      "not-newer",
      `bundle ${bundle.manifest.bundleVersion} is older than the rules in use (${o.currentVersion}); downgrades are refused`,
    );
  }
  return { ok: true, bundle };
}
