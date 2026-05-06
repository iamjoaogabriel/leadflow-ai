// src/lib/webhook-security.ts
//
// Signature verification for incoming webhooks.
//   - Meta (Facebook/Instagram/WhatsApp Cloud): X-Hub-Signature-256
//   - Evolution API: optional shared apikey header, validated per tenant
//   - Generic: constant-time compare helper

import crypto from "crypto";
import prisma from "@/lib/db/prisma";

/**
 * Verify a Meta webhook signature using META_APP_SECRET.
 * Header: `X-Hub-Signature-256: sha256=<hex>`
 *
 * If META_APP_SECRET is not set, returns true to allow local dev —
 * but logs that the verification is disabled.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null
): { valid: boolean; reason?: string } {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return { valid: true, reason: "meta_secret_unset" };
  }
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const [algo, sent] = signatureHeader.split("=");
  if (algo !== "sha256" || !sent) return { valid: false, reason: "bad_format" };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

  const a = Buffer.from(sent, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return { valid: false, reason: "length_mismatch" };
  const equal = crypto.timingSafeEqual(a, b);
  return equal ? { valid: true } : { valid: false, reason: "signature_mismatch" };
}

/**
 * Evolution doesn't sign payloads by default (as of 2.3.7). The SaaS owner
 * can opt-in to a per-tenant shared secret stored in
 * `channel.config.webhookSecret` — if present, we require the webhook to
 * send it as the `x-webhook-secret` header.
 *
 * `instanceName` comes from the webhook body (body.instance) — used to
 * find the owning account.
 */
export async function verifyEvolutionWebhook(
  instanceName: string,
  headerSecret: string | null
): Promise<{ valid: boolean; accountId?: string; reason?: string }> {
  if (!instanceName) return { valid: false, reason: "no_instance" };

  const channel = await prisma.channel.findFirst({
    where: {
      type: "WHATSAPP",
      isEnabled: true,
      config: { path: ["instanceName"], equals: instanceName },
    },
    select: { accountId: true, config: true },
  });

  if (!channel) {
    return { valid: false, reason: "unknown_instance" };
  }

  const cfg = (channel.config as Record<string, unknown>) || {};
  const expected = typeof cfg.webhookSecret === "string" ? cfg.webhookSecret : null;

  // If no secret configured for this tenant, we accept the request but
  // rely on the instance-name guard (above) as the tenant mapping.
  if (!expected) {
    return { valid: true, accountId: channel.accountId };
  }

  if (!headerSecret) {
    return { valid: false, accountId: channel.accountId, reason: "missing_secret_header" };
  }

  const a = Buffer.from(headerSecret);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return { valid: false, accountId: channel.accountId, reason: "secret_mismatch" };
  }
  const equal = crypto.timingSafeEqual(a, b);
  return equal
    ? { valid: true, accountId: channel.accountId }
    : { valid: false, accountId: channel.accountId, reason: "secret_mismatch" };
}

/**
 * Constant-time secret compare utility for everything else.
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
