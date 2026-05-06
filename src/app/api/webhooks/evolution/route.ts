// src/app/api/webhooks/evolution/route.ts
//
// Evolution API v2 webhook — delegates to the shared inbound handler.

import { NextRequest, NextResponse } from "next/server";
import { handleWhatsAppInbound } from "@/lib/ai-engine/whatsapp-inbound";
import { verifyEvolutionWebhook } from "@/lib/webhook-security";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "webhook/evolution" });

export async function POST(req: NextRequest) {
  const rl = await rateLimit({
    key: `evo:${getClientIp(req)}`,
    max: 240,
    windowSec: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(Math.ceil(rl.resetInMs / 1000)) } }
    );
  }

  try {
    const body = await req.json();
    const instanceName: string = body?.instance || body?.data?.instance || "";

    // Optional per-tenant secret guard
    const headerSecret = req.headers.get("x-webhook-secret");
    const sec = await verifyEvolutionWebhook(instanceName, headerSecret);
    if (!sec.valid) {
      log.warn("webhook rejected", { instanceName, reason: sec.reason });
      return NextResponse.json(
        { error: "unauthorized", reason: sec.reason },
        { status: 401 }
      );
    }

    const result = await handleWhatsAppInbound(body);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "unknown";
    log.error("handler crashed", { err: e });
    return NextResponse.json({ error: "Internal error", message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", message: "Evolution webhook active" });
}
