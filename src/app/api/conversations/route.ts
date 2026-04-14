// src/app/api/conversations/route.ts
import { NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { accountId: session.accountId },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: 100,
      include: {
        lead: { select: { name: true, phone: true, email: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true },
        },
        _count: { select: { messages: true } },
      },
    });

    const items = conversations.map((conv) => ({
      id: conv.id,
      leadName: conv.lead.name || conv.lead.phone || conv.lead.email || "Sem nome",
      leadPhone: conv.lead.phone,
      leadEmail: conv.lead.email,
      channel: conv.channel,
      isAIEnabled: conv.isAIEnabled,
      isActive: conv.isActive,
      lastMessage: conv.messages[0]?.content || null,
      lastMessageAt:
        conv.messages[0]?.createdAt?.toISOString() ||
        conv.lastMessageAt?.toISOString() ||
        null,
      unreadCount: 0,
      sentiment: conv.sentiment,
      messageCount: conv._count.messages,
    }));

    return NextResponse.json(items);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("GET /api/conversations error:", msg);
    return NextResponse.json(
      { error: "Internal error", message: msg },
      { status: 500 }
    );
  }
}