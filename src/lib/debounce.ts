// src/lib/debounce.ts
//
// ══════════════════════════════════════════════════════════
// MESSAGE DEBOUNCE SYSTEM
// ══════════════════════════════════════════════════════════
//
// Problem: Users send 2-3 messages in quick succession.
// Without debounce, AI responds to each one separately → robotic.
//
// Solution:
// 1. Inbound message arrives → saved to DB immediately
// 2. Message ID pushed to Redis list: debounce:{conversationId}
// 3. BullMQ job scheduled with 8s delay (the "debounce timer")
// 4. If ANOTHER message arrives before 8s → old job REMOVED, new one created (timer resets)
// 5. When timer finally fires → ALL accumulated message IDs are read, combined, sent to AI as one context
//
// This means:
// - User sends "oi" → 8s timer starts
// - User sends "tudo bem?" 3s later → timer resets to 8s
// - User sends "quero saber o preco" 2s later → timer resets to 8s
// - 8s pass with no new messages → AI receives: "oi\ntudo bem?\nquero saber o preco"
//

import { getRedis } from "./redis";
import { queues } from "./queues";
import prisma from "@/lib/db/prisma";

const DEFAULT_DEBOUNCE_MS = 8000;
const MIN_DEBOUNCE_MS = 2000;
const MAX_DEBOUNCE_MS = 60_000;
const DEBOUNCE_PREFIX = "debounce:msgs:";
const DEBOUNCE_JOB_PREFIX = "debounce:job:";

/** Reads `aiConfig.persona.debounceSeconds` for the account and clamps it. */
async function resolveDebounceMs(accountId: string): Promise<number> {
  try {
    const cfg = await prisma.aIConfig.findUnique({
      where: { accountId },
      select: { persona: true },
    });
    const persona = (cfg?.persona as Record<string, unknown> | null) || {};
    const raw = persona.debounceSeconds;
    const seconds = typeof raw === "number" && raw > 0 ? raw : null;
    if (!seconds) return DEFAULT_DEBOUNCE_MS;
    const ms = seconds * 1000;
    return Math.min(MAX_DEBOUNCE_MS, Math.max(MIN_DEBOUNCE_MS, ms));
  } catch {
    return DEFAULT_DEBOUNCE_MS;
  }
}

/**
 * Add a message to the debounce buffer and reset the timer.
 * Called every time an inbound message arrives (text or transcribed audio).
 */
export async function debounceMessage(opts: {
  conversationId: string;
  messageId: string;
  accountId: string;
  leadId: string;
  channel: "WHATSAPP" | "EMAIL" | "SMS";
}): Promise<void> {
  const redis = getRedis();
  const listKey = `${DEBOUNCE_PREFIX}${opts.conversationId}`;
  const jobIdKey = `${DEBOUNCE_JOB_PREFIX}${opts.conversationId}`;

  // 1. Push this message ID to the accumulator list
  await redis.rpush(listKey, opts.messageId);
  await redis.expire(listKey, 300); // 5 min TTL safety net

  // 2. Cancel any existing debounce job for this conversation
  const existingJobId = await redis.get(jobIdKey);
  if (existingJobId) {
    try {
      const job = await queues.aiResponse.getJob(existingJobId);
      if (job) {
        const state = await job.getState();
        if (state === "delayed" || state === "waiting") {
          await job.remove();
        }
      }
    } catch {
      // Job may have already been processed — that's fine
    }
  }

  // 3. Schedule a NEW debounce job with fresh delay (per-account configurable)
  const delayMs = await resolveDebounceMs(opts.accountId);
  const newJobId = `debounce-${opts.conversationId}-${Date.now()}`;
  const job = await queues.aiResponse.add(
    "debounced-respond",
    {
      conversationId: opts.conversationId,
      accountId: opts.accountId,
      leadId: opts.leadId,
      channel: opts.channel,
    },
    {
      delay: delayMs,
      jobId: newJobId,
      removeOnComplete: true,
      removeOnFail: 50,
    }
  );

  // 4. Store the new job ID so we can cancel it later
  await redis.set(jobIdKey, job.id!, "EX", 60);
}

/**
 * Flush the debounce buffer.
 * Returns all accumulated message IDs and clears the Redis list.
 * Called by the AI worker when the debounce timer fires.
 */
export async function flushDebounceBuffer(
  conversationId: string
): Promise<string[]> {
  const redis = getRedis();
  const listKey = `${DEBOUNCE_PREFIX}${conversationId}`;
  const jobIdKey = `${DEBOUNCE_JOB_PREFIX}${conversationId}`;

  // Atomically read all + delete
  const messageIds = await redis.lrange(listKey, 0, -1);
  await redis.del(listKey, jobIdKey);

  return messageIds;
}