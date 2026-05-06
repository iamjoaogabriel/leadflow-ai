// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import prisma from "@/lib/db/prisma";
import { cookies } from "next/headers";
import { getStripe } from "@/lib/billing/stripe";

let _supabase: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  _supabase = createClient(url, key);
  return _supabase;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const locale = searchParams.get("locale") || "pt";

  if (!code) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/login?error=no_code`
    );
  }

  try {
    // Exchange code for session
    const { data: authData, error: authError } =
      await supabaseAdmin().auth.exchangeCodeForSession(code);

    if (authError || !authData.session || !authData.user) {
      console.error("OAuth exchange error:", authError);
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/login?error=auth_failed`
      );
    }

    const supabaseUser = authData.user;
    const email = supabaseUser.email!;
    const name =
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.user_metadata?.name ||
      email.split("@")[0];
    const avatarUrl = supabaseUser.user_metadata?.avatar_url || null;
    const provider = supabaseUser.app_metadata?.provider || "google";

    // Check if user already exists (by email)
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { account: true },
          take: 1,
        },
      },
    });

    if (existingUser && existingUser.memberships.length > 0) {
      // Update supabaseId if not set
      if (!existingUser.supabaseId) {
        await prisma.user.update({
          where: { email },
          data: { supabaseId: supabaseUser.id },
        });
      }

      // Set cookies and redirect to dashboard
      const cookieStore = await cookies();
      setAuthCookies(cookieStore, authData.session);

      const accountLocale = existingUser.memberships[0].account.locale;
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}/${accountLocale}`
      );
    }

    // New user via OAuth — create user, account, redirect to pricing
    const companyName = `${name}'s Company`;
    const baseSlug = companyName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    let slug = baseSlug;
    let counter = 0;
    while (await prisma.account.findUnique({ where: { slug } })) {
      counter++;
      slug = `${baseSlug}-${counter}`;
    }

    // Create Stripe customer (lazy — if not configured we skip billing record for OAuth signup)
    let stripeCustomerId: string | null = null;
    try {
      const stripeCustomer = await getStripe().customers.create({
        email,
        name,
        metadata: { source: "oauth", provider },
      });
      stripeCustomerId = stripeCustomer.id;
    } catch (err) {
      console.warn("[auth/callback] Stripe not configured, skipping customer creation", err);
    }

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: companyName,
          slug,
          plan: "FREE",
          locale,
          stripeCustomerId,
        },
      });

      const newUser = await tx.user.create({
        data: {
          email,
          name,
          avatarUrl,
          supabaseId: supabaseUser.id,
        },
      });

      await tx.accountMember.create({
        data: {
          accountId: account.id,
          userId: newUser.id,
          role: "OWNER",
        },
      });

      await tx.aIConfig.create({
        data: {
          accountId: account.id,
          provider: "openai",
          model: "gpt-4o",
          systemPrompt:
            "You are an intelligent sales assistant. Engage leads naturally and professionally.",
        },
      });

      return { account, user: newUser };
    });

    // Set cookies
    const cookieStore = await cookies();
    setAuthCookies(cookieStore, authData.session);

    // Redirect to pricing page for new OAuth users
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/pricing?account=${result.account.id}`
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/login?error=server_error`
    );
  }
}

function setAuthCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  session: { access_token: string; refresh_token: string }
) {
  const secure = process.env.NODE_ENV === "production";
  cookieStore.set("sb-access-token", session.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60,
    path: "/",
  });
  cookieStore.set("sb-refresh-token", session.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}