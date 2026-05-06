// src/lib/auth/session.ts
import { createServerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import prisma from "@/lib/db/prisma";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "auth/session" });

export interface Session {
  userId: string;
  accountId: string;
  email: string;
  role: string;
}

export async function getSession(): Promise<Session | null> {
  try {
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
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Expected in Server Components (read-only)
            }
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    // Try to find existing user
    let dbUser = await prisma.user.findUnique({
      where: { supabaseId: user.id },
      include: {
        memberships: {
          include: {
            account: { select: { id: true, plan: true, slug: true } },
          },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    // Auto-provision or link existing user
    if (!dbUser) {
      const email = user.email || "";
      const includePayload = {
        memberships: {
          include: {
            account: { select: { id: true, plan: true, slug: true } },
          },
          take: 1,
          orderBy: { createdAt: "asc" as const },
        },
      };

      // Check if a user with this email already exists (different supabaseId)
      const existingByEmail = await prisma.user.findUnique({
        where: { email },
        include: includePayload,
      });

      if (existingByEmail) {
        // Link existing user to this Supabase account
        dbUser = await prisma.user.update({
          where: { id: existingByEmail.id },
          data: { supabaseId: user.id },
          include: includePayload,
        });

        // If user exists but has no memberships, create one
        if (dbUser.memberships.length === 0) {
          const slug =
            email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30) +
            "-" + Date.now().toString(36);

          await prisma.accountMember.create({
            data: {
              role: "OWNER",
              user: { connect: { id: dbUser.id } },
              account: {
                create: {
                  name: `${existingByEmail.name || "User"}'s Workspace`,
                  slug,
                  plan: "FREE",
                  aiConfig: {
                    create: {
                      provider: "openai",
                      model: "gpt-4o",
                      systemPrompt:
                        "You are a professional sales assistant. Be natural, helpful, and guide leads toward conversion.",
                      temperature: 0.7,
                      maxTokens: 1000,
                    },
                  },
                },
              },
            },
          });

          // Reload with memberships
          dbUser = await prisma.user.findUnique({
            where: { id: dbUser.id },
            include: includePayload,
          });
        }
      } else {
        // Truly new user — create everything
        const name =
          user.user_metadata?.full_name ||
          user.user_metadata?.name ||
          email.split("@")[0] ||
          "User";
        const slug =
          email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 30) +
          "-" + Date.now().toString(36);

        dbUser = await prisma.user.create({
          data: {
            supabaseId: user.id,
            email,
            name,
            memberships: {
              create: {
                role: "OWNER",
                account: {
                  create: {
                    name: `${name}'s Workspace`,
                    slug,
                    plan: "FREE",
                    aiConfig: {
                      create: {
                        provider: "openai",
                        model: "gpt-4o",
                        systemPrompt:
                          "You are a professional sales assistant. Be natural, helpful, and guide leads toward conversion.",
                        temperature: 0.7,
                        maxTokens: 1000,
                      },
                    },
                  },
                },
              },
            },
          },
          include: includePayload,
        });
      }
    }

    if (!dbUser || dbUser.memberships.length === 0) return null;

    const membership = dbUser.memberships[0];

    return {
      userId: dbUser.id,
      accountId: membership.accountId,
      email: dbUser.email,
      role: membership.role,
    };
  } catch (error) {
    // We log with full context so the digest in the user's browser maps to a
    // searchable record in the container logs. Common causes:
    //   - Postgres column missing (Prisma schema drift; run `prisma db push`)
    //   - DATABASE_URL pointing to a stale/unavailable Supabase instance
    //   - Supabase project paused / unreachable
    //   - Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env
    log.error("getSession failed", {
      err: error,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseAnonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      hasDatabaseUrl: !!process.env.DATABASE_URL,
    });
    return null;
  }
}

/**
 * Destroy the current session by clearing Supabase auth cookies.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const all = cookieStore.getAll();
  for (const { name } of all) {
    if (name.startsWith("sb-") || name === "sb-access-token" || name === "sb-refresh-token") {
      cookieStore.delete(name);
    }
  }
}