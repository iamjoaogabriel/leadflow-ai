// src/app/api/webhooks/meta/leadgen/route.ts
//
// Facebook / Instagram Lead Ads webhook endpoint.
//
// 1) GET  — hub.challenge verification (Meta calls this once when the webhook
//    is configured in the Developers dashboard).
// 2) POST — leadgen events. Meta only sends us `leadgen_id` + `page_id`, so
//    we:
//       - find which account owns that Page (via MetaIntegration.pages JSON)
//       - pull the full lead via Graph API using the Page access token
//       - normalize the field data
//       - dedupe + create the Lead row
//       - enqueue `leadProcessing` so the AI reaches out immediately
//
// Configure this URL in Meta Developers:
//   https://SEU_DOMINIO/api/webhooks/meta/leadgen
//   Verify Token: META_WEBHOOK_VERIFY_TOKEN
//   Object: page → fields: leadgen

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { queues } from "@/lib/queues";
import { normalizePhone } from "@/lib/utils/normalize-phone";
import {
  verifyWebhookSubscription,
  findAccountForPage,
  fetchLeadgenDetails,
  normalizeLeadgenFields,
} from "@/lib/integrations/meta";
import { verifyMetaSignature } from "@/lib/webhook-security";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "webhook/meta-leadgen" });

// ── GET: verification handshake ─────────────
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge");
  const result = verifyWebhookSubscription(mode, token, challenge);
  if (result) return new NextResponse(result, { status: 200 });
  return NextResponse.json({ error: "verification_failed" }, { status: 403 });
}

// ── POST: leadgen event ingestion ───────────
interface LeadgenChangeValue {
  leadgen_id?: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  created_time?: number;
}
interface WebhookEntry {
  id?: string;
  changes?: { field?: string; value?: LeadgenChangeValue }[];
}
interface WebhookBody {
  object?: string;
  entry?: WebhookEntry[];
}

export async function POST(req: NextRequest) {
  // Rate limit by IP — protects against accidental floods
  const rl = await rateLimit({
    key: `meta:${getClientIp(req)}`,
    max: 120,
    windowSec: 60,
  });
  if (!rl.allowed) {
    log.warn("rate limited", { ip: getClientIp(req) });
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.resetInMs / 1000)) } }
    );
  }

  // Read raw body ONCE so we can verify the signature and still parse it
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const sigCheck = verifyMetaSignature(raw, signature);
  if (!sigCheck.valid) {
    log.warn("bad signature", { reason: sigCheck.reason });
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  // Meta expects a 200 fast — process each entry individually and always
  // acknowledge even when one of them fails.
  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (body.object !== "page" || !Array.isArray(body.entry)) {
    return NextResponse.json({ status: "ignored", reason: "not_page_object" });
  }

  const results: {
    leadgenId?: string;
    status: string;
    leadId?: string;
    error?: string;
  }[] = [];

  for (const entry of body.entry) {
    for (const change of entry.changes || []) {
      if (change.field !== "leadgen") continue;
      const value = change.value || {};
      const leadgenId = value.leadgen_id;
      const pageId = value.page_id || entry.id;

      if (!leadgenId || !pageId) {
        results.push({ status: "skipped_missing_ids" });
        continue;
      }

      try {
        const mapped = await findAccountForPage(pageId);
        if (!mapped) {
          results.push({ leadgenId, status: "no_account_for_page" });
          continue;
        }

        const details = await fetchLeadgenDetails(
          leadgenId,
          mapped.pageAccessToken
        );
        const norm = normalizeLeadgenFields(details.fields);

        if (!norm.email && !norm.phone) {
          results.push({ leadgenId, status: "no_contact_info" });
          continue;
        }

        const phone = norm.phone ? normalizePhone(norm.phone, "BR") : null;
        const email = norm.email ? norm.email.toLowerCase() : null;

        // Dedupe
        const orConditions: { phone?: string; email?: string }[] = [];
        if (phone) orConditions.push({ phone });
        if (email) orConditions.push({ email });

        const existing = orConditions.length
          ? await prisma.lead.findFirst({
              where: { accountId: mapped.accountId, OR: orConditions },
            })
          : null;

        if (existing) {
          if (existing.status === "NEW") {
            await queues.leadProcessing.add("retry-contact", {
              leadId: existing.id,
              accountId: mapped.accountId,
              channel: existing.phone ? "WHATSAPP" : "EMAIL",
            });
          }
          results.push({
            leadgenId,
            status: "duplicate",
            leadId: existing.id,
          });
          continue;
        }

        // Resolve campaign (match by campaign_name if present)
        let campaignId: string | null = null;
        if (details.campaignName) {
          const camp = await prisma.campaign.findFirst({
            where: {
              accountId: mapped.accountId,
              name: { contains: details.campaignName, mode: "insensitive" },
            },
            select: { id: true },
          });
          if (camp) campaignId = camp.id;
        }

        const lead = await prisma.lead.create({
          data: {
            accountId: mapped.accountId,
            name: norm.name,
            email,
            phone,
            source: "MARKETING",
            status: "NEW",
            campaignId,
            metadata: {
              platform: "meta",
              pageId,
              leadgenId,
              adId: details.adId,
              adName: details.adName,
              formId: details.formId,
              campaignId: details.campaignId,
              campaignName: details.campaignName,
              customFields: norm.customFields,
              createdTime: details.createdTime,
            },
          },
        });

        if (campaignId) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { totalLeads: { increment: 1 } },
          });
        }

        const channel: "WHATSAPP" | "EMAIL" = phone ? "WHATSAPP" : "EMAIL";
        await queues.leadProcessing.add(
          "new-lead",
          { leadId: lead.id, accountId: mapped.accountId, channel },
          { priority: 1 }
        );

        await prisma.eventLog.create({
          data: {
            accountId: mapped.accountId,
            event: "lead.meta_leadgen_received",
            data: {
              leadId: lead.id,
              leadgenId,
              pageId,
              adId: details.adId,
              campaignName: details.campaignName,
            },
          },
        });

        results.push({ leadgenId, status: "created", leadId: lead.id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[meta/leadgen] entry error:", msg);
        results.push({ leadgenId, status: "error", error: msg });
      }
    }
  }

  return NextResponse.json({ status: "processed", results });
}
