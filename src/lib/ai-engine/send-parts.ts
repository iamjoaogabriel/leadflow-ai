// src/lib/ai-engine/send-parts.ts
//
// Sends an AI reply as multiple short messages, with typing presence between
// each part. Every channel provider already implements `send(to, content)`
// that internally plays a "composing" presence and waits a realistic delay
// before firing the message — so calling it N times in a row gives us the
// WhatsApp-style "user typing…" feel that the founder wants.
//
// This module is the single place where an AI-generated string is turned
// into real outbound messages. Both `lead-processing` and `ai-response`
// workers delegate here.
//
// Extra features:
//   - splits on the explicit `|||` separator (see message-split.ts)
//   - extracts an optional `[FOLLOWUP:Xh]` / `[FOLLOWUP:Xd]` tag that tells
//     us to schedule a follow-up check X hours/days later (the tag is
//     stripped from the visible text).

import prisma from "@/lib/db/prisma";
import type { ChannelProvider, SendResult } from "@/lib/channels/types";
import { splitIntoMessages } from "./message-split";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "send-parts" });

const FOLLOWUP_RE = /\[FOLLOWUP:\s*(\d+)\s*([hd])\s*\]/i;

/** Strips the `[FOLLOWUP:Xh]` tag and returns the delay (hours) if present. */
export function extractFollowUpTag(text: string): {
  clean: string;
  followUpHours: number | null;
} {
  const match = text.match(FOLLOWUP_RE);
  if (!match) return { clean: text.trim(), followUpHours: null };
  const n = parseInt(match[1], 10) || 0;
  const unit = match[2].toLowerCase();
  const hours = Math.max(1, unit === "d" ? n * 24 : n);
  return { clean: text.replace(FOLLOWUP_RE, "").trim(), followUpHours: hours };
}

export interface SendPartsInput {
  accountId: string;
  conversationId: string;
  to: string;
  /** Raw AI output (may contain `|||` separators and `[FOLLOWUP:Xh]` tag) */
  fullText: string;
  provider: ChannelProvider;
  sendOpts?: Record<string, unknown>;
  extraMetadata?: Record<string, unknown>;
}

export interface SendPartsResult {
  /** Visible chunks after splitting (in send order) */
  parts: string[];
  /** One Message row per chunk, with delivery outcome */
  messages: { id: string; status: "SENT" | "FAILED"; externalId: string | null }[];
  /** Hours to schedule a follow-up, if the AI asked for one */
  followUpHours: number | null;
}

const BREATH_MS = 300;

export async function sendMessagesInParts(
  input: SendPartsInput
): Promise<SendPartsResult> {
  const { clean, followUpHours } = extractFollowUpTag(input.fullText);
  const parts = splitIntoMessages(clean);

  if (parts.length === 0) {
    return { parts: [], messages: [], followUpHours };
  }

  const messages: SendPartsResult["messages"] = [];

  for (let i = 0; i < parts.length; i++) {
    const content = parts[i];

    // 0. Kill-switch: re-check that the AI is still enabled on this
    //    conversation. If the user paused the AI while we were mid-send,
    //    stop here — don't flood the lead with stale messages.
    if (i > 0) {
      const conv = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { isAIEnabled: true, isActive: true },
      });
      if (!conv || !conv.isAIEnabled || !conv.isActive) {
        log.info("aborted mid-send: AI disabled by user", {
          conversationId: input.conversationId,
          sentSoFar: messages.length,
          remaining: parts.length - i,
        });
        break;
      }
    }

    // 1. Save OUTBOUND row (PENDING)
    const dbMsg = await prisma.message.create({
      data: {
        accountId: input.accountId,
        conversationId: input.conversationId,
        direction: "OUTBOUND",
        content,
        contentType: "TEXT",
        isAIGenerated: true,
        status: "PENDING",
        metadata: {
          ...(input.extraMetadata || {}),
          partIndex: i,
          totalParts: parts.length,
        },
      },
    });

    // 2. Provider handles: presence → wait → sendText
    let result: SendResult = { success: false };
    try {
      result = await input.provider.send(
        input.to,
        content,
        input.sendOpts
      );
    } catch (err: unknown) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 3. Update status
    await prisma.message.update({
      where: { id: dbMsg.id },
      data: {
        status: result.success ? "SENT" : "FAILED",
        externalId: result.externalId || null,
      },
    });

    messages.push({
      id: dbMsg.id,
      status: result.success ? "SENT" : "FAILED",
      externalId: result.externalId || null,
    });

    // 4. Small breath between parts — feels more human.
    //    Skipped after the last part and when a send failed.
    if (!result.success) break;
    if (i < parts.length - 1) {
      await new Promise((r) => setTimeout(r, BREATH_MS));
    }
  }

  // Update conversation timestamp once at the end
  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: new Date() },
  });

  return { parts, messages, followUpHours };
}
