// src/app/api/auth/callback/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import prisma from "@/lib/db/prisma";
import { cookies } from "next/headers";
import { getStripe } from "@/lib/billing/stripe";

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
    // Exchange code for session — use the cookie-aware client so the
    // session cookies are written in the same format getSession() reads.
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          },
        },
      }
    );

    const { data: authData, error: authError } =
      await supabase.auth.exchangeCodeForSession(code);

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

      // Cookies were already set by exchangeCodeForSession via the cookie helper
      const accountLocale = existingUser.memberships[0].account.locale;
      const onboardingDone = !!existingUser.memberships[0].account.onboardingCompletedAt;
      const target = onboardingDone
        ? `/${accountLocale}`
        : `/${accountLocale}/onboarding`;
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_APP_URL}${target}`
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

    // Cookies were already set by exchangeCodeForSession.
    // Send brand-new OAuth users straight to onboarding.
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/onboarding?account=${result.account.id}`
    );
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/login?error=server_error`
    );
  }
}

