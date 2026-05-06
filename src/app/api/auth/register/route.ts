// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import prisma from "@/lib/db/prisma";
import { z } from "zod";
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

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  companyName: z.string().min(2).max(100),
  plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]).default("STARTER"),
  locale: z.enum(["pt", "en", "es"]).default("pt"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, email, password, companyName, plan, locale } = parsed.data;

    // 1. Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "email_already_registered" },
        { status: 409 }
      );
    }

    // 2. Create Supabase auth user
    const { data: authData, error: authError } =
      await supabaseAdmin().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, company: companyName },
      });

    if (authError || !authData.user) {
      console.error("Supabase auth error:", authError);
      return NextResponse.json(
        { error: "auth_creation_failed" },
        { status: 500 }
      );
    }

    // 3. Create Stripe customer (lazy)
    const stripeCustomer = await getStripe().customers.create({
      email,
      name,
      metadata: { company: companyName },
    });

    // 4. Generate unique slug
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

    // 5. Create account + user + membership in transaction
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: companyName,
          slug,
          plan: "FREE",
          locale,
          stripeCustomerId: stripeCustomer.id,
        },
      });

      const user = await tx.user.create({
        data: {
          email,
          name,
          supabaseId: authData.user!.id,
        },
      });

      await tx.accountMember.create({
        data: {
          accountId: account.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      await tx.aIConfig.create({
        data: {
          accountId: account.id,
          provider: "openai",
          model: "gpt-4o",
          systemPrompt: getDefaultPrompt(locale),
        },
      });

      return { account, user };
    });

    // 6. Create Stripe Checkout session
    const priceId = getPriceId(plan);

    const checkoutSession = await getStripe().checkout.sessions.create({
      customer: stripeCustomer.id,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}?setup=complete&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/${locale}/register?canceled=true`,
      metadata: {
        accountId: result.account.id,
        userId: result.user.id,
        plan,
      },
      subscription_data: {
        trial_period_days: 7,
        metadata: { accountId: result.account.id },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json(
      { checkoutUrl: checkoutSession.url, accountId: result.account.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

function getPriceId(plan: string): string {
  const prices: Record<string, string> = {
    STARTER: process.env.STRIPE_PRICE_STARTER!,
    PRO: process.env.STRIPE_PRICE_PRO!,
    ENTERPRISE: process.env.STRIPE_PRICE_ENTERPRISE!,
  };
  return prices[plan] || prices.STARTER;
}

function getDefaultPrompt(locale: string): string {
  const prompts: Record<string, string> = {
    pt: "Você é um assistente de vendas inteligente. Engaje leads de forma natural e profissional, entenda suas necessidades e guie-os para a conversão. Nunca invente informações.",
    en: "You are an intelligent sales assistant. Engage leads naturally and professionally, understand their needs, and guide them toward conversion. Never make up information.",
    es: "Eres un asistente de ventas inteligente. Interactúa con leads de forma natural y profesional, entiende sus necesidades y guíalos hacia la conversión. Nunca inventes información.",
  };
  return prompts[locale] || prompts.en;
}