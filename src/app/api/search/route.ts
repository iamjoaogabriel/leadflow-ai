// src/app/api/search/route.ts
//
// Global search across the tenant — powers the header command-menu.
//
// Looks in 4 buckets (all scoped by accountId):
//   - leads       (name, phone, email)
//   - campaigns   (name, description)
//   - conversations (lead name/phone linked; last message preview)
//   - static pages (client-side fallback in command-menu)
//
// Returns up to 5 hits per bucket, ranked by simple substring scoring.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export interface SearchHit {
  type: "lead" | "campaign" | "conversation";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ hits: [] });
  }

  const accountId = session.accountId;
  const insensitive = { mode: "insensitive" as const };

  const [leads, campaigns, conversations] = await Promise.all([
    prisma.lead.findMany({
      where: {
        accountId,
        OR: [
          { name: { contains: q, ...insensitive } },
          { phone: { contains: q, ...insensitive } },
          { email: { contains: q, ...insensitive } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, phone: true, email: true, status: true },
    }),
    prisma.campaign.findMany({
      where: {
        accountId,
        OR: [
          { name: { contains: q, ...insensitive } },
          { description: { contains: q, ...insensitive } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, totalLeads: true },
    }),
    prisma.conversation.findMany({
      where: {
        accountId,
        OR: [
          { lead: { name: { contains: q, ...insensitive } } },
          { lead: { phone: { contains: q, ...insensitive } } },
        ],
      },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: {
        id: true,
        channel: true,
        lead: { select: { name: true, phone: true, email: true } },
      },
    }),
  ]);

  const hits: SearchHit[] = [
    ...leads.map((l) => ({
      type: "lead" as const,
      id: l.id,
      title: l.name || l.phone || l.email || "Lead",
      subtitle: [l.phone, l.email, l.status].filter(Boolean).join(" · "),
      href: `/leads`,
    })),
    ...campaigns.map((c) => ({
      type: "campaign" as const,
      id: c.id,
      title: c.name,
      subtitle: `${c.totalLeads} leads`,
      href: `/campaigns`,
    })),
    ...conversations.map((c) => ({
      type: "conversation" as const,
      id: c.id,
      title: c.lead?.name || c.lead?.phone || "Conversa",
      subtitle: c.channel,
      href: `/conversations`,
    })),
  ];

  return NextResponse.json({ hits });
}
