// src/app/api/notifications/route.ts
//
// Reads recent, user-visible events from the `eventLog` table and returns
// them as notifications. "Unread" = created after account.notificationsReadAt
// (a per-account watermark we store in persona for now to avoid a new table).

import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

const VISIBLE_EVENTS = [
  "lead.first_contact",
  "lead.converted",
  "lead.escalated",
  "lead.meeting_scheduled",
  "lead.meta_leadgen_received",
] as const;

export interface NotificationItem {
  id: string;
  event: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [events, account] = await Promise.all([
    prisma.eventLog.findMany({
      where: { accountId: session.accountId, event: { in: VISIBLE_EVENTS as unknown as string[] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, event: true, data: true, createdAt: true },
    }),
    // We piggy-back the watermark on accounts (stripeSubStatus is not it — we
    // use a dedicated metadata stored in aiConfig.persona for simplicity).
    prisma.aIConfig.findUnique({
      where: { accountId: session.accountId },
      select: { persona: true },
    }),
  ]);

  const persona = (account?.persona as Record<string, unknown> | null) || {};
  const watermarkRaw = persona.notificationsReadAt as string | undefined;
  const watermark = watermarkRaw ? new Date(watermarkRaw) : new Date(0);

  const notifications: NotificationItem[] = events.map((e) => {
    const data = (e.data as Record<string, unknown> | null) || {};
    const { title, message } = describe(e.event, data);
    return {
      id: e.id,
      event: e.event,
      title,
      message,
      createdAt: e.createdAt.toISOString(),
      read: e.createdAt <= watermark,
    };
  });

  const unreadCount = notifications.filter((n) => !n.read).length;
  return NextResponse.json({ notifications, unreadCount });
}

export async function POST() {
  // Mark all as read by advancing the watermark
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.aIConfig.findUnique({
    where: { accountId: session.accountId },
    select: { persona: true },
  });
  const persona = (existing?.persona as Record<string, unknown> | null) || {};

  await prisma.aIConfig.upsert({
    where: { accountId: session.accountId },
    update: {
      persona: { ...persona, notificationsReadAt: new Date().toISOString() },
    },
    create: {
      accountId: session.accountId,
      provider: "openai",
      model: "gpt-4o",
      systemPrompt: "",
      temperature: 0.7,
      maxTokens: 500,
      persona: { notificationsReadAt: new Date().toISOString() },
    },
  });

  return NextResponse.json({ ok: true });
}

function describe(
  event: string,
  data: Record<string, unknown>
): { title: string; message: string } {
  const d = data as {
    leadId?: string;
    channel?: string;
    campaignName?: string;
    adName?: string;
    startISO?: string;
  };
  switch (event) {
    case "lead.first_contact":
      return {
        title: "IA iniciou atendimento",
        message: `Primeira mensagem enviada${d.channel ? ` via ${String(d.channel).toLowerCase()}` : ""}.`,
      };
    case "lead.converted":
      return {
        title: "Lead convertido",
        message: "A IA concluiu o objetivo com este lead.",
      };
    case "lead.escalated":
      return {
        title: "Conversa escalada",
        message: "Lead solicitou atendimento humano.",
      };
    case "lead.meeting_scheduled":
      return {
        title: "Reunião agendada",
        message: d.startISO
          ? `Agendada para ${new Date(d.startISO).toLocaleString("pt-BR")}.`
          : "A IA criou um evento no Google Calendar.",
      };
    case "lead.meta_leadgen_received":
      return {
        title: "Novo lead da Meta",
        message: d.campaignName
          ? `Campanha: ${String(d.campaignName)}.`
          : "Lead recebido via formulário da Meta.",
      };
    default:
      return { title: event, message: "" };
  }
}
