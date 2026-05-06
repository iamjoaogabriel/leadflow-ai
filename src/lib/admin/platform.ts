// src/lib/admin/platform.ts
//
// Platform-role guards and helpers used by the /admin tenants flow.
//
// Roles:
//   USER         — default, no admin powers.
//   SUPER_ADMIN  — can create tenants for clients. Sees ONLY tenants they
//                  themselves created.
//   HIPER_ADMIN  — system creator. Sees everything, can promote/demote
//                  super admins, can see all tenants from all super admins.

import { getSession, type Session, type PlatformRole } from "@/lib/auth/session";

export const ADMIN_ROLES: PlatformRole[] = ["SUPER_ADMIN", "HIPER_ADMIN"];

export function isHiperAdmin(s: Session | null): boolean {
  return !!s && s.platformRole === "HIPER_ADMIN";
}

export function isSuperAdminOrHigher(s: Session | null): boolean {
  return !!s && (s.platformRole === "SUPER_ADMIN" || s.platformRole === "HIPER_ADMIN");
}

export class AdminAuthError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "AdminAuthError";
  }
}

export async function requireSuperAdminOrHigher(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AdminAuthError(401, "unauthorized");
  if (!isSuperAdminOrHigher(s)) throw new AdminAuthError(403, "forbidden");
  return s;
}

export async function requireHiperAdmin(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AdminAuthError(401, "unauthorized");
  if (!isHiperAdmin(s)) throw new AdminAuthError(403, "forbidden");
  return s;
}

// ─────────────────────────────────────────────────────────────
// Password generator + invite message template
// ─────────────────────────────────────────────────────────────

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Generates a 14-char password using safe characters (no symbols, no
 * 0/O/I/l/1 — to avoid confusion when the client types it).
 */
export function generatePassword(length = 14): string {
  const buf = new Uint32Array(length);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < length; i++) buf[i] = Math.floor(Math.random() * 1e9);
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += PASSWORD_ALPHABET[buf[i] % PASSWORD_ALPHABET.length];
  }
  return out;
}

export interface InviteMessageInput {
  appUrl: string;
  companyName: string;
  ownerName: string;
  email: string;
  password: string;
  locale?: "pt" | "en" | "es";
}

const TEMPLATES: Record<"pt" | "en" | "es", (i: InviteMessageInput) => string> = {
  pt: (i) => `Olá ${i.ownerName}! 👋

Sua conta no Marketing Digital AI foi criada para a ${i.companyName}.

Acesse: ${i.appUrl}/login
E-mail: ${i.email}
Senha temporária: ${i.password}

Recomendamos que você troque a senha logo no primeiro acesso. Qualquer dúvida, é só responder esta mensagem.`,
  en: (i) => `Hi ${i.ownerName}! 👋

Your Marketing Digital AI account for ${i.companyName} is ready.

Sign in: ${i.appUrl}/login
Email: ${i.email}
Temporary password: ${i.password}

We recommend changing your password on first login. Reply to this message if anything is off.`,
  es: (i) => `¡Hola ${i.ownerName}! 👋

Tu cuenta de Marketing Digital AI para ${i.companyName} está lista.

Acceso: ${i.appUrl}/login
Correo: ${i.email}
Contraseña temporal: ${i.password}

Te recomendamos cambiar la contraseña en el primer acceso. Si algo no está bien, responde este mensaje.`,
};

export function buildInviteMessage(input: InviteMessageInput): string {
  const locale = input.locale || "pt";
  return TEMPLATES[locale](input);
}
