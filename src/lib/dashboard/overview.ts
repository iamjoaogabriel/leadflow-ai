// src/lib/dashboard/overview.ts
//
// Single source of truth for the dashboard home data — pure Supabase REST.
// No Prisma anywhere on this hot path, so we never depend on the
// Postgres connection pool / pgBouncer (the SaaS was hitting
// `Tenant or user not found` and `EMAXCONNSESSION` here).
//
// Reads are batched in chunks of 5 parallel REST calls — Supabase REST has
// no connection-pool ceiling like the pooler does, but we still keep the
// fan-out reasonable.

import { getSupabaseAdmin } from "@/lib/db/supabase-server";

export interface SparklinePoint {
  date: string;
  count: number;
}

export interface ActivityItem {
  id: string;
  event: string;
  createdAt: string;
  data: Record<string, unknown> | null;
}

export interface GoalProgress {
  id: string | null;
  labelKey: string | null;
  achieved: number;
  total: number;
  percent: number;
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
  const sb = getSupabaseAdmin();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(
    now.getTime() - 14 * 24 * 60 * 60 * 1000
  ).toISOString();

  // Refine callback receives a Supabase filter builder. We type it as
  // `any` here because the public types from supabase-js make chaining
  // .gte/.eq/.in across multiple call sites painful — it's an internal
  // helper, scoped to this file only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Refine = (q: any) => any;
  const countLeads = (refine?: Refine) =>
    headCount(sb, "leads", accountId, refine);
  const countMessages = (refine?: Refine) =>
    headCount(sb, "messages", accountId, refine);
  const countConversations = (refine?: Refine) =>
    headCount(sb, "conversations", accountId, refine);
  const countEvents = (refine?: Refine) =>
    headCount(sb, "event_logs", accountId, refine);

  // ─── batch 1: kpi counts ───────────────────────────────────
  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    activeConversations,
    convertedTotal,
  ] = await Promise.all([
    countLeads(),
    countLeads((q) => q.gte("created_at", startOfMonth)),
    countLeads((q) =>
      q.gte("created_at", startOfLastMonth).lte("created_at", endOfLastMonth)
    ),
    countConversations((q) => q.eq("is_active", true)),
    countLeads((q) => q.eq("status", "CONVERTED")),
  ]);

  // ─── batch 2: message counts ───────────────────────────────
  const [
    messagesThisMonth,
    messagesLastMonth,
    totalMessages,
    aiMessages,
    messagesToday,
  ] = await Promise.all([
    countMessages((q) => q.gte("created_at", startOfMonth)),
    countMessages((q) =>
      q.gte("created_at", startOfLastMonth).lte("created_at", endOfLastMonth)
    ),
    countMessages(),
    countMessages((q) => q.eq("is_ai_generated", true)),
    countMessages((q) => q.gte("created_at", startOfToday)),
  ]);

  // ─── batch 3: lists + channel distribution + goal-related counts ──
  const [
    recentLeadsRes,
    campaignsRes,
    activityRes,
    aiConfigRes,
    qualifiedCount,
    meetingsScheduledCount,
    waCount,
    emailCount,
    smsCount,
  ] = await Promise.all([
    sb
      .from("leads")
      .select("id, name, phone, email, status, source, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(6),
    sb
      .from("campaigns")
      .select("id, name, total_leads, converted_leads")
      .eq("account_id", accountId)
      .order("total_leads", { ascending: false })
      .limit(5),
    sb
      .from("event_logs")
      .select("id, event, data, created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(8),
    sb
      .from("ai_configs")
      .select("persona")
      .eq("account_id", accountId)
      .maybeSingle(),
    countLeads((q) => q.in("status", ["QUALIFIED", "CONVERTED"])),
    countEvents((q) => q.eq("event", "lead.meeting_scheduled")),
    countConversations((q) => q.eq("channel", "WHATSAPP")),
    countConversations((q) => q.eq("channel", "EMAIL")),
    countConversations((q) => q.eq("channel", "SMS")),
  ]);

  // ─── batch 4: time-series for sparklines ───────────────────
  const [leadsRows14d, messagesRows7d] = await Promise.all([
    sb
      .from("leads")
      .select("created_at")
      .eq("account_id", accountId)
      .gte("created_at", fourteenDaysAgo),
    sb
      .from("messages")
      .select("created_at")
      .eq("account_id", accountId)
      .gte("created_at", sevenDaysAgo),
  ]);

  // ─── derive ──────────────────────────────────────────────────
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

  const channelTotals = waCount + emailCount + smsCount;
  const channelDistribution = [
    { channel: "WHATSAPP", count: waCount },
    { channel: "EMAIL", count: emailCount },
    { channel: "SMS", count: smsCount },
  ]
    .filter((c) => c.count > 0)
    .map((c) => ({
      ...c,
      percentage: channelTotals > 0 ? round1((c.count / channelTotals) * 100) : 0,
    }));

  const leadsByDay14d = bucketByDay(leadsRows14d.data || [], 14, now);
  const leadsSpark7d = bucketByDay(
    (leadsRows14d.data || []).filter(
      (r) => new Date((r as { created_at: string }).created_at) >= new Date(sevenDaysAgo)
    ),
    7,
    now
  );
  const messagesSpark7d = bucketByDay(messagesRows7d.data || [], 7, now);

  const persona =
    (aiConfigRes.data?.persona as Record<string, unknown> | null) || {};
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
      // avg response time would require a SQL function (RPC) — we keep it
      // at 0 in REST-only mode. Add a Supabase RPC later if needed.
      avgResponseSeconds: 0,
      convertedTotal,
      messagesToday,
    },
    goal,
    sparklines: { leads7d: leadsSpark7d, messages7d: messagesSpark7d },
    leadsByDay14d,
    recentLeads: (recentLeadsRes.data || []).map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      email: l.email,
      status: l.status,
      source: l.source,
      createdAt: l.created_at,
    })),
    campaigns: (campaignsRes.data || []).map((c) => ({
      id: c.id,
      name: c.name,
      totalLeads: c.total_leads,
      convertedLeads: c.converted_leads,
      conversionRate:
        c.total_leads > 0
          ? round1((c.converted_leads / c.total_leads) * 100)
          : 0,
    })),
    channelDistribution,
    activity: (activityRes.data || []).map((e) => ({
      id: e.id,
      event: e.event,
      createdAt: e.created_at,
      data: (e.data as Record<string, unknown> | null) ?? null,
    })),
  };
}

// ───────────────────────────────────────────────────────────────
// helpers
// ───────────────────────────────────────────────────────────────

async function headCount(
  sb: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  accountId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refine?: (q: any) => any
): Promise<number> {
  let q = sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (refine) q = refine(q);
  const { count, error } = await q;
  if (error) {
    // Fail-soft so a single missing table doesn't take the dashboard down.
    return 0;
  }
  return count || 0;
}

function bucketByDay(
  rows: { created_at: string }[],
  days: number,
  now: Date
): SparklinePoint[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = toISODate(new Date(r.created_at));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const out: SparklinePoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = toISODate(d);
    out.push({ date: key, count: counts.get(key) || 0 });
  }
  return out;
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
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
    return { id: null, labelKey: null, achieved: 0, total: totalLeads, percent: 0, isEmpty: true };
  }
  let achieved = 0;
  let labelKey = "closeSale";
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
