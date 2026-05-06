// src/lib/dashboard/overview.ts
//
// Single source of truth for the dashboard home data.
// Consumed by:
//   - the Server Component (first paint, SSR)
//   - /api/dashboard/overview (client-side polling)

import prisma from "@/lib/db/prisma";

export interface SparklinePoint {
  date: string; // ISO date yyyy-mm-dd
  count: number;
}

export interface ActivityItem {
  id: string;
  event: string;
  createdAt: string;
  data: Record<string, unknown> | null;
}

export interface GoalProgress {
  /** Canonical id stored in AIConfig.persona.pipelineGoal (e.g. "close_sale") */
  id: string | null;
  /** i18n key under `pipeline.goal.<key>.title` — e.g. "closeSale" */
  labelKey: string | null;
  /** Leads that already reached the goal */
  achieved: number;
  /** Universe being compared against (usually totalLeads) */
  total: number;
  /** Round1 percentage */
  percent: number;
  /** True if the account never configured a funnel goal */
  isEmpty: boolean;
}

export interface DashboardOverview {
  generatedAt: string;

  kpis: {
    totalLeads: number;
    leadsThisMonth: number;
    leadsChange: number;
    activeConversations: number;
    conversionRate: number;
    messagesThisMonth: number;
    messagesChange: number;
    aiResponseRate: number;
    avgResponseSeconds: number;
    convertedTotal: number;
    messagesToday: number;
  };

  goal: GoalProgress;

  sparklines: {
    leads7d: SparklinePoint[];
    messages7d: SparklinePoint[];
  };

  leadsByDay14d: SparklinePoint[];

  recentLeads: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    source: string;
    createdAt: string;
  }[];

  campaigns: {
    id: string;
    name: string;
    totalLeads: number;
    convertedLeads: number;
    conversionRate: number;
  }[];

  channelDistribution: {
    channel: string;
    count: number;
    percentage: number;
  }[];

  activity: ActivityItem[];
}

export async function loadDashboardOverview(
  accountId: string
): Promise<DashboardOverview> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Run reads in 4 sequential batches of 5 parallel queries each.
  // With Supabase pgBouncer (default pool = 15), firing 20 parallel
  // reads on every dashboard refresh exhausts the pool under load
  // (`EMAXCONNSESSION`). Capping concurrency at 5 keeps us safely below
  // and total wall time stays low because each batch is fast.
  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    activeConversations,
    convertedTotal,
    messagesThisMonth,
    messagesLastMonth,
    totalMessages,
    aiMessages,
    messagesToday,
    recentLeads,
    campaignsRaw,
    channelsRaw,
    leadsPerDay14Raw,
    messagesPerDay7Raw,
    avgResponseRaw,
    activityRaw,
    aiConfigForGoal,
    qualifiedCount,
    meetingsScheduledCount,
  ] = await runChunked([
    prisma.lead.count({ where: { accountId } }),
    prisma.lead.count({ where: { accountId, createdAt: { gte: startOfMonth } } }),
    prisma.lead.count({
      where: { accountId, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
    }),
    prisma.conversation.count({ where: { accountId, isActive: true } }),
    prisma.lead.count({ where: { accountId, status: "CONVERTED" } }),
    prisma.message.count({
      where: { accountId, createdAt: { gte: startOfMonth } },
    }),
    prisma.message.count({
      where: { accountId, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
    }),
    prisma.message.count({ where: { accountId } }),
    prisma.message.count({ where: { accountId, isAIGenerated: true } }),
    prisma.message.count({
      where: { accountId, createdAt: { gte: startOfToday } },
    }),
    prisma.lead.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        status: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.campaign.findMany({
      where: { accountId },
      orderBy: { totalLeads: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        totalLeads: true,
        convertedLeads: true,
      },
    }),
    prisma.conversation.groupBy({
      by: ["channel"],
      where: { accountId },
      _count: { id: true },
    }),
    prisma.$queryRaw<{ date: Date; count: bigint | number }[]>`
      SELECT DATE(created_at) AS date, COUNT(*)::int AS count
      FROM leads
      WHERE account_id = ${accountId}
        AND created_at >= ${fourteenDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
    prisma.$queryRaw<{ date: Date; count: bigint | number }[]>`
      SELECT DATE(created_at) AS date, COUNT(*)::int AS count
      FROM messages
      WHERE account_id = ${accountId}
        AND created_at >= ${sevenDaysAgo}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `,
    prisma.$queryRaw<{ avg_seconds: number | null }[]>`
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (next_out.created_at - m.created_at))), 0)::float AS avg_seconds
      FROM messages m
      JOIN LATERAL (
        SELECT created_at FROM messages n
        WHERE n.conversation_id = m.conversation_id
          AND n.direction = 'OUTBOUND'
          AND n.created_at > m.created_at
        ORDER BY n.created_at ASC
        LIMIT 1
      ) next_out ON TRUE
      WHERE m.account_id = ${accountId}
        AND m.direction = 'INBOUND'
        AND m.created_at >= NOW() - INTERVAL '30 days'
    `,
    prisma.eventLog.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, event: true, data: true, createdAt: true },
    }),
    prisma.aIConfig.findUnique({
      where: { accountId },
      select: { persona: true },
    }),
    prisma.lead.count({
      where: { accountId, status: { in: ["QUALIFIED", "CONVERTED"] } },
    }),
    prisma.eventLog.count({
      where: { accountId, event: "lead.meeting_scheduled" },
    }),
  ]);

  // ── Derived numbers ──
  const leadsChange =
    leadsLastMonth > 0
      ? ((leadsThisMonth - leadsLastMonth) / leadsLastMonth) * 100
      : leadsThisMonth > 0
        ? 100
        : 0;

  const messagesChange =
    messagesLastMonth > 0
      ? ((messagesThisMonth - messagesLastMonth) / messagesLastMonth) * 100
      : messagesThisMonth > 0
        ? 100
        : 0;

  const conversionRate =
    totalLeads > 0 ? (convertedTotal / totalLeads) * 100 : 0;
  const aiResponseRate =
    totalMessages > 0 ? (aiMessages / totalMessages) * 100 : 0;

  const totalConversations = channelsRaw.reduce(
    (sum, ch) => sum + ch._count.id,
    0
  );

  const avgResponseSeconds = Math.max(
    0,
    Math.round(Number(avgResponseRaw[0]?.avg_seconds ?? 0))
  );

  // ── Goal progress ──
  const persona =
    (aiConfigForGoal?.persona as Record<string, unknown> | null) || {};
  const goalId =
    typeof persona.pipelineGoal === "string" && persona.pipelineGoal
      ? (persona.pipelineGoal as string)
      : null;

  const goal = resolveGoalProgress({
    goalId,
    totalLeads,
    convertedTotal,
    qualifiedCount,
    meetingsScheduledCount,
  });

  // ── Sparkline series (filled with 0 on missing days) ──
  const leadsByDay14d = fillDays(leadsPerDay14Raw, 14, now);
  const leadsSpark7d = fillDays(
    leadsPerDay14Raw.filter((r) => new Date(r.date) >= sevenDaysAgo),
    7,
    now
  );
  const messagesSpark7d = fillDays(messagesPerDay7Raw, 7, now);

  return {
    generatedAt: new Date().toISOString(),

    kpis: {
      totalLeads,
      leadsThisMonth,
      leadsChange: round1(leadsChange),
      activeConversations,
      conversionRate: round1(conversionRate),
      messagesThisMonth,
      messagesChange: round1(messagesChange),
      aiResponseRate: round1(aiResponseRate),
      avgResponseSeconds,
      convertedTotal,
      messagesToday,
    },

    goal,

    sparklines: {
      leads7d: leadsSpark7d,
      messages7d: messagesSpark7d,
    },

    leadsByDay14d,

    recentLeads: recentLeads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      source: l.source,
      createdAt: l.createdAt.toISOString(),
    })),

    campaigns: campaignsRaw.map((c) => ({
      id: c.id,
      name: c.name,
      totalLeads: c.totalLeads,
      convertedLeads: c.convertedLeads,
      conversionRate:
        c.totalLeads > 0
          ? round1((c.convertedLeads / c.totalLeads) * 100)
          : 0,
    })),

    channelDistribution: channelsRaw.map((ch) => ({
      channel: ch.channel,
      count: ch._count.id,
      percentage:
        totalConversations > 0
          ? round1((ch._count.id / totalConversations) * 100)
          : 0,
    })),

    activity: activityRaw.map((e) => ({
      id: e.id,
      event: e.event,
      createdAt: e.createdAt.toISOString(),
      data: (e.data as Record<string, unknown> | null) ?? null,
    })),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Awaits a list of (lazy) PrismaPromises in fixed-size parallel chunks so we
 * never blow past the connection pool. Preserves order and full per-element
 * typing of the input tuple.
 */
async function runChunked<T extends readonly Promise<unknown>[]>(
  tasks: [...T],
  chunkSize: number = 5
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const out: unknown[] = [];
  for (let i = 0; i < tasks.length; i += chunkSize) {
    const slice = tasks.slice(i, i + chunkSize) as Promise<unknown>[];
    const results = await Promise.all(slice);
    out.push(...results);
  }
  return out as { -readonly [K in keyof T]: Awaited<T[K]> };
}

function resolveGoalProgress(input: {
  goalId: string | null;
  totalLeads: number;
  convertedTotal: number;
  qualifiedCount: number;
  meetingsScheduledCount: number;
}): GoalProgress {
  const { goalId, totalLeads, convertedTotal, qualifiedCount, meetingsScheduledCount } = input;

  if (!goalId) {
    return {
      id: null,
      labelKey: null,
      achieved: 0,
      total: totalLeads,
      percent: 0,
      isEmpty: true,
    };
  }

  let achieved = 0;
  let labelKey = "";

  switch (goalId) {
    case "close_sale":
      achieved = convertedTotal;
      labelKey = "closeSale";
      break;
    case "schedule_meeting":
      achieved = meetingsScheduledCount;
      labelKey = "scheduleMeeting";
      break;
    case "qualify_transfer":
      achieved = qualifiedCount;
      labelKey = "qualifyTransfer";
      break;
    case "collect_send":
      achieved = qualifiedCount;
      labelKey = "collectSend";
      break;
    default:
      labelKey = "closeSale";
      achieved = convertedTotal;
  }

  const percent = totalLeads > 0 ? (achieved / totalLeads) * 100 : 0;

  return {
    id: goalId,
    labelKey,
    achieved,
    total: totalLeads,
    percent: round1(percent),
    isEmpty: false,
  };
}

function fillDays(
  rows: { date: Date; count: bigint | number }[],
  days: number,
  now: Date
): SparklinePoint[] {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const key = toISODate(new Date(r.date));
    byDate.set(key, Number(r.count));
  }
  const out: SparklinePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = toISODate(d);
    out.push({ date: key, count: byDate.get(key) ?? 0 });
  }
  return out;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
