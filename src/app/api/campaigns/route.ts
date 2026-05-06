// src/app/api/campaigns/route.ts
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db/prisma";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const campaigns = await prisma.campaign.findMany({
      where: { accountId: session.accountId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { leads: true } } },
    });

    return NextResponse.json(
      campaigns.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        type: c.type,
        status: c.status,
        platform: c.platform,
        mediaUrl: c.mediaUrl,
        mediaFormat: c.mediaFormat,
        hasTranscription: !!c.transcription,
        totalLeads: c.totalLeads,
        convertedLeads: c.convertedLeads,
        createdAt: c.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("Get campaigns error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const formData = await req.formData();
    const name = formData.get("name") as string;
    const description = (formData.get("description") as string) || null;
    const type = (formData.get("type") as string) || "DIGITAL";
    const caption = (formData.get("caption") as string) || null;
    const transcription = (formData.get("transcription") as string) || null;
    const file = formData.get("file") as File | null;
    const countriesRaw = (formData.get("countries") as string) || "[]";
    const aiLanguage = (formData.get("aiLanguage") as string) || "";

    let countries: string[] = [];
    try {
      const parsed = JSON.parse(countriesRaw);
      if (Array.isArray(parsed)) countries = parsed.filter((c) => typeof c === "string");
    } catch {
      countries = [];
    }

    if (!name?.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    let mediaUrl: string | null = null;
    let mediaFormat: string | null = null;
    let finalTranscription = transcription;

    // Handle file upload
    if (file && file.size > 0) {
      // For now, store info about the file
      // In production, upload to Supabase Storage or S3
      mediaFormat = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : null;

      // TODO: Upload file to storage and get URL
      // mediaUrl = await uploadToStorage(file);

      // If caption provided, use it as initial transcription
      if (caption) {
        finalTranscription = caption;
      }

      // TODO: Queue transcription job for image/video
      // if (mediaFormat === "video") {
      //   await queues.transcription.add("transcribe-campaign", {
      //     campaignId: campaign.id,
      //     mediaUrl,
      //     type: "video",
      //   });
      // } else if (mediaFormat === "image") {
      //   await queues.transcription.add("analyze-campaign-image", {
      //     campaignId: campaign.id,
      //     mediaUrl,
      //     type: "image",
      //   });
      // }
    }

    const campaign = await prisma.campaign.create({
      data: {
        accountId: session.accountId,
        name: name.trim(),
        description,
        type: type as any,
        status: "ACTIVE",
        mediaUrl,
        mediaFormat,
        transcription: finalTranscription,
        metadata: {
          countries,
          aiLanguage: aiLanguage.trim() || "auto",
        },
      },
    });

    return NextResponse.json(campaign, { status: 201 });
  } catch (error) {
    console.error("Create campaign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}