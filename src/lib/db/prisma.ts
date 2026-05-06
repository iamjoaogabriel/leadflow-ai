// src/lib/db/prisma.ts
//
// Prisma client singleton — explicitly avoids creating new connections on
// every Next.js dev hot-reload, and adds `connection_limit` to the URL when
// missing so we never blow past Supabase's PgBouncer pool.
//
// Production (Coolify): set DATABASE_URL to the Supabase **pooled** URL
//   postgresql://...@<ref>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10
// Development: same shape works.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Make sure the URL has `pgbouncer=true` and a sane `connection_limit`.
 * If the operator forgot to set them, we patch at runtime — never silently
 * exhausting the pool.
 */
function withPoolHints(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    // Only patch when targeting a pooler host (port 6543 or `pooler.` host)
    const isPooled =
      u.port === "6543" || u.hostname.includes("pooler") || u.hostname.includes("pgbouncer");
    if (!isPooled) return url;
    if (!u.searchParams.has("pgbouncer")) u.searchParams.set("pgbouncer", "true");
    if (!u.searchParams.has("connection_limit"))
      u.searchParams.set("connection_limit", "10");
    return u.toString();
  } catch {
    return url;
  }
}

const databaseUrl = withPoolHints(process.env.DATABASE_URL);

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
