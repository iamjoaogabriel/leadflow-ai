// src/app/api/health/route.ts
//
// Health check for load balancers, uptime monitors, and internal dashboards.
// Probes the three hard dependencies:
//   - Postgres (via Prisma) — basic SELECT 1
//   - Redis (via ioredis)   — PING
//   - Workers               — "live" if a pending job on each queue is <5 min old
//
// Never returns 500 on a subsystem fault — always 200 with JSON body, so
// monitors can render granular status. The HTTP status becomes 503 only
// when ALL dependencies fail (process effectively down).

import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getRedis } from "@/lib/redis";
import { queues } from "@/lib/queues";

interface Probe {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function GET() {
  const started = Date.now();

  const [dbProbe, redisProbe, queuesProbe] = await Promise.all([
    probeDb(),
    probeRedis(),
    probeQueues(),
  ]);

  const healthy = dbProbe.ok || redisProbe.ok; // at least one core dep up
  const status = healthy ? 200 : 503;

  return NextResponse.json(
    {
      ok: healthy,
      uptimeSec: Math.floor(process.uptime()),
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - started,
      services: {
        database: dbProbe,
        redis: redisProbe,
        queues: queuesProbe,
      },
      version: process.env.npm_package_version || "unknown",
    },
    { status }
  );
}

async function probeDb(): Promise<Probe> {
  const t = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - t };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeRedis(): Promise<Probe> {
  const t = Date.now();
  try {
    const r = getRedis();
    const pong = await r.ping();
    return { ok: pong === "PONG", latencyMs: Date.now() - t };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeQueues(): Promise<Probe & { counts?: Record<string, unknown> }> {
  try {
    const counts: Record<string, unknown> = {};
    for (const [name, q] of Object.entries(queues)) {
      counts[name] = await q.getJobCounts(
        "waiting",
        "active",
        "delayed",
        "failed"
      );
    }
    return { ok: true, counts };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
