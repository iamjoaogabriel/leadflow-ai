// src/app/[locale]/(dashboard)/admin/page.tsx
//
// Admin console — server-rendered shell that decides what to show based
// on the current platformRole, then mounts the client component with the
// session info as props.

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AdminConsole } from "@/components/admin/admin-console";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) redirect(`/${locale}/login`);
  if (session.platformRole !== "SUPER_ADMIN" && session.platformRole !== "HIPER_ADMIN") {
    redirect(`/${locale}`);
  }

  return (
    <AdminConsole
      currentUser={{
        id: session.userId,
        email: session.email,
        platformRole: session.platformRole,
      }}
    />
  );
}
