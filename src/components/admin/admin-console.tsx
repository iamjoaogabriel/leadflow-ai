// src/components/admin/admin-console.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ══════════════════════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════════════════════

type PlatformRole = "USER" | "SUPER_ADMIN" | "HIPER_ADMIN";

interface CurrentUser {
  id: string;
  email: string;
  platformRole: PlatformRole;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  maxUsers: number;
  memberCount: number;
  onboardingCompleted: boolean;
  createdAt: string;
  createdById: string | null;
  creator: { name: string | null; email: string } | null;
}

interface SuperAdmin {
  id: string;
  name: string | null;
  email: string;
  platformRole: PlatformRole;
  createdAt: string;
  tenantCount: number;
}

interface CreatedTenantPayload {
  ok: true;
  tenant: { id: string; name: string; slug: string; plan: string; maxUsers: number };
  owner: { id: string; email: string; name: string };
  credentials: { email: string; password: string; loginUrl: string };
  message: string;
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════

export function AdminConsole({ currentUser }: { currentUser: CurrentUser }) {
  const t = useTranslations("admin");
  const isHiper = currentUser.platformRole === "HIPER_ADMIN";

  const [section, setSection] = useState<"tenants" | "super_admins">("tenants");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [admins, setAdmins] = useState<SuperAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const tenantsRes = await fetch("/api/admin/tenants", { cache: "no-store" });
      if (tenantsRes.ok) {
        const data = await tenantsRes.json();
        setTenants(Array.isArray(data.tenants) ? data.tenants : []);
      }
      if (isHiper) {
        const aRes = await fetch("/api/admin/super-admins", { cache: "no-store" });
        if (aRes.ok) {
          const data = await aRes.json();
          setAdmins(Array.isArray(data.users) ? data.users : []);
        }
      }
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [isHiper]);

  useEffect(() => {
    reload();
  }, [reload]);

  const stats = useMemo(() => {
    const totalTenants = tenants.length;
    const onboardedTenants = tenants.filter((t) => t.onboardingCompleted).length;
    const totalSuperAdmins = admins.filter((a) => a.platformRole === "SUPER_ADMIN").length;
    const totalUsers = tenants.reduce((sum, t) => sum + t.memberCount, 0);
    return { totalTenants, onboardedTenants, totalSuperAdmins, totalUsers };
  }, [tenants, admins]);

  const filteredTenants = useMemo(() => {
    if (!search.trim()) return tenants;
    const q = search.toLowerCase();
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.creator?.email?.toLowerCase().includes(q)
    );
  }, [search, tenants]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ─── HEADER ─── */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary/10 grid place-items-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-primary">
                {t("eyebrow")}
              </span>
              <RoleBadge role={currentUser.platformRole} />
            </div>
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground leading-tight">
              {isHiper ? t("titleHiper") : t("titleSuper")}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1 max-w-xl">
              {isHiper ? t("subtitleHiper") : t("subtitleSuper")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={reload}
            disabled={refreshing}
            className="h-9"
            title={t("refresh")}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
          </Button>
          {isHiper && section === "super_admins" && (
            <Button onClick={() => setAdminModalOpen(true)} className="h-9 gap-1.5">
              <Plus className="w-4 h-4" />
              {t("newSuperAdmin")}
            </Button>
          )}
          {section === "tenants" && (
            <Button onClick={() => setTenantModalOpen(true)} className="h-9 gap-1.5">
              <Plus className="w-4 h-4" />
              {t("newTenant")}
            </Button>
          )}
        </div>
      </header>

      {/* ─── STATS ─── */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
        <StatCard
          icon={Building2}
          label={t("stats.totalTenants")}
          value={stats.totalTenants}
          accent="primary"
        />
        <StatCard
          icon={CheckCircle2}
          label={t("stats.onboarded")}
          value={stats.onboardedTenants}
          accent="emerald"
        />
        <StatCard
          icon={Users}
          label={t("stats.totalUsers")}
          value={stats.totalUsers}
          accent="blue"
        />
        {isHiper ? (
          <StatCard
            icon={UserCog}
            label={t("stats.superAdmins")}
            value={stats.totalSuperAdmins}
            accent="amber"
          />
        ) : (
          <StatCard
            icon={Sparkles}
            label={t("stats.youCreated")}
            value={stats.totalTenants}
            accent="amber"
          />
        )}
      </section>

      {/* ─── TABS ─── */}
      <nav className="flex flex-wrap gap-1 border-b border-border">
        <TabButton
          active={section === "tenants"}
          onClick={() => setSection("tenants")}
          label={t("tabs.tenants")}
          count={tenants.length}
        />
        {isHiper && (
          <TabButton
            active={section === "super_admins"}
            onClick={() => setSection("super_admins")}
            label={t("tabs.superAdmins")}
            count={admins.length}
          />
        )}
      </nav>

      {/* ─── BODY ─── */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : section === "tenants" ? (
        <TenantsList
          tenants={filteredTenants}
          search={search}
          setSearch={setSearch}
          isHiper={isHiper}
          onRefresh={reload}
        />
      ) : (
        <SuperAdminsList
          admins={admins}
          currentUserId={currentUser.id}
          onRefresh={reload}
        />
      )}

      {/* ─── MODAIS ─── */}
      {tenantModalOpen && (
        <CreateTenantModal
          onClose={() => setTenantModalOpen(false)}
          onCreated={() => {
            setTenantModalOpen(false);
            reload();
          }}
        />
      )}
      {adminModalOpen && isHiper && (
        <CreateSuperAdminModal
          onClose={() => setAdminModalOpen(false)}
          onCreated={() => {
            setAdminModalOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TENANTS LIST
// ══════════════════════════════════════════════════════════════

function TenantsList({
  tenants,
  search,
  setSearch,
  isHiper,
  onRefresh,
}: {
  tenants: Tenant[];
  search: string;
  setSearch: (v: string) => void;
  isHiper: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("admin");

  if (tenants.length === 0 && !search) {
    return (
      <EmptyState
        icon={Building2}
        title={t("empty.tenantsTitle")}
        hint={t("empty.tenantsHint")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("searchTenants")}
          className="h-10 pl-9"
        />
      </div>

      {tenants.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("empty.noResults")}
          compact
        />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {tenants.map((tenant) => (
              <TenantRow
                key={tenant.id}
                tenant={tenant}
                isHiper={isHiper}
                onRefresh={onRefresh}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TenantRow({
  tenant,
  isHiper,
  onRefresh,
}: {
  tenant: Tenant;
  isHiper: boolean;
  onRefresh: () => void;
}) {
  const t = useTranslations("admin");
  return (
    <li className="px-5 py-4 flex items-center gap-4 hover:bg-muted/30 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
        <Building2 className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-display text-[14px] font-semibold text-foreground truncate">
            {tenant.name}
          </p>
          <PlanBadge plan={tenant.plan} />
          {tenant.onboardingCompleted ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 px-1.5 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" />
              {t("statusOnboarded")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-500 px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20">
              <Sparkles className="w-3 h-3" />
              {t("statusPending")}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            {tenant.memberCount}/{tenant.maxUsers} {t("usersLabel")}
          </span>
          <span>{t("createdOn", { date: formatDate(tenant.createdAt) })}</span>
          {isHiper && tenant.creator && (
            <span className="inline-flex items-center gap-1">
              <UserCog className="w-3 h-3" />
              {tenant.creator.name || tenant.creator.email}
            </span>
          )}
        </div>
      </div>
      {isHiper && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={async () => {
            if (!confirm(t("confirmDeleteTenant", { name: tenant.name }))) return;
            await fetch(`/api/admin/accounts?id=${tenant.id}`, { method: "DELETE" });
            onRefresh();
          }}
          title={t("deleteTenant")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </li>
  );
}

// ══════════════════════════════════════════════════════════════
// SUPER ADMINS LIST
// ══════════════════════════════════════════════════════════════

function SuperAdminsList({
  admins,
  currentUserId,
  onRefresh,
}: {
  admins: SuperAdmin[];
  currentUserId: string;
  onRefresh: () => void;
}) {
  const t = useTranslations("admin");

  if (admins.length === 0) {
    return (
      <EmptyState
        icon={UserCog}
        title={t("empty.adminsTitle")}
        hint={t("empty.adminsHint")}
      />
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <ul className="divide-y divide-border">
        {admins.map((a) => (
          <li
            key={a.id}
            className="px-5 py-4 flex items-center gap-4 hover:bg-muted/30 transition-colors"
          >
            <Avatar name={a.name || a.email} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-display text-[14px] font-semibold text-foreground truncate">
                  {a.name || a.email.split("@")[0]}
                </p>
                <RoleBadge role={a.platformRole} />
                {a.id === currentUserId && (
                  <span className="text-[10px] text-muted-foreground italic">
                    ({t("you")})
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-muted-foreground mt-0.5">
                {a.email} · {a.tenantCount} {t("tenantsCreated")} ·{" "}
                {t("createdOn", { date: formatDate(a.createdAt) })}
              </p>
            </div>
            {a.platformRole === "SUPER_ADMIN" && a.id !== currentUserId && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive shrink-0"
                onClick={async () => {
                  if (!confirm(t("confirmDemote", { email: a.email }))) return;
                  await fetch(`/api/admin/super-admins?id=${a.id}`, {
                    method: "DELETE",
                  });
                  onRefresh();
                }}
                title={t("demote")}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// CREATE TENANT MODAL
// ══════════════════════════════════════════════════════════════

function CreateTenantModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("admin");
  const [step, setStep] = useState<"form" | "success">("form");
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [maxUsers, setMaxUsers] = useState(5);
  const [plan, setPlan] = useState<"FREE" | "STARTER" | "PRO" | "ENTERPRISE">("STARTER");
  const [locale, setLocale] = useState<"pt" | "en" | "es">("pt");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreatedTenantPayload | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          ownerName: ownerName.trim(),
          ownerEmail: ownerEmail.trim().toLowerCase(),
          maxUsers,
          plan,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t(`errors.${data.error || "generic"}` as never) || data.error);
        return;
      }
      setResult(data);
      setStep("success");
    } catch {
      setError(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={step === "form" ? t("modal.createTenantTitle") : t("modal.tenantReadyTitle")}>
      {step === "form" ? (
        <div className="space-y-4">
          <p className="text-[12.5px] text-muted-foreground">
            {t("modal.createTenantSubtitle")}
          </p>

          <Field label={t("modal.companyName")}>
            <Input
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t("modal.companyPlaceholder")}
              className="h-11"
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={t("modal.ownerName")}>
              <Input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder={t("modal.ownerNamePlaceholder")}
                className="h-11"
              />
            </Field>
            <Field label={t("modal.ownerEmail")}>
              <Input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="cliente@empresa.com"
                className="h-11"
              />
            </Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label={t("modal.maxUsers")}>
              <Input
                type="number"
                min={1}
                max={200}
                value={maxUsers}
                onChange={(e) => setMaxUsers(parseInt(e.target.value) || 1)}
                className="h-11"
              />
            </Field>
            <Field label={t("modal.plan")}>
              <Select value={plan} onValueChange={(v) => setPlan(v as typeof plan)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FREE">Free</SelectItem>
                  <SelectItem value="STARTER">Starter</SelectItem>
                  <SelectItem value="PRO">Pro</SelectItem>
                  <SelectItem value="ENTERPRISE">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("modal.messageLocale")}>
              <Select value={locale} onValueChange={(v) => setLocale(v as typeof locale)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt">🇧🇷 Português</SelectItem>
                  <SelectItem value="en">🇺🇸 English</SelectItem>
                  <SelectItem value="es">🇪🇸 Español</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[12.5px] text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t("modal.cancel")}
            </Button>
            <Button
              onClick={submit}
              disabled={
                submitting ||
                !companyName.trim() ||
                !ownerName.trim() ||
                !ownerEmail.trim()
              }
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="w-4 h-4 mr-1.5" />
              )}
              {t("modal.createTenantSubmit")}
            </Button>
          </div>
        </div>
      ) : result ? (
        <CreatedTenantSuccess result={result} onClose={() => onCreated()} />
      ) : null}
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// CREATE SUPER ADMIN MODAL
// ══════════════════════════════════════════════════════════════

function CreateSuperAdminModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations("admin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    promoted?: boolean;
    created?: boolean;
    email?: string;
    password?: string;
    message?: string;
    loginUrl?: string;
  } | null>(null);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/super-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t(`errors.${data.error || "generic"}` as never) || data.error);
        return;
      }
      setResult(data);
    } catch {
      setError(t("errors.network"));
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <ModalShell onClose={onClose} title={t("modal.adminReadyTitle")}>
        {result.promoted ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-[13px]">
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-foreground">
                  {t("modal.userPromoted")}
                </p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {result.email}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={onCreated}>{t("modal.done")}</Button>
            </div>
          </div>
        ) : (
          <CredentialsBlock
            title={t("modal.adminCreatedTitle")}
            email={result.email!}
            password={result.password!}
            loginUrl={result.loginUrl!}
            message={result.message}
            onDone={onCreated}
          />
        )}
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} title={t("modal.createAdminTitle")}>
      <div className="space-y-4">
        <p className="text-[12.5px] text-muted-foreground">
          {t("modal.createAdminSubtitle")}
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t("modal.adminName")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("modal.adminNamePlaceholder")}
              className="h-11"
            />
          </Field>
          <Field label={t("modal.adminEmail")}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@empresa.com"
              className="h-11"
            />
          </Field>
        </div>
        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[12.5px] text-destructive">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("modal.cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting || !email.trim() || !name.trim()}>
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
            ) : (
              <UserCog className="w-4 h-4 mr-1.5" />
            )}
            {t("modal.createAdminSubmit")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ══════════════════════════════════════════════════════════════
// CREDENTIALS BLOCK + COPY
// ══════════════════════════════════════════════════════════════

function CreatedTenantSuccess({
  result,
  onClose,
}: {
  result: CreatedTenantPayload;
  onClose: () => void;
}) {
  const t = useTranslations("admin");
  return (
    <CredentialsBlock
      title={t("modal.tenantReadyDesc", { company: result.tenant.name })}
      email={result.credentials.email}
      password={result.credentials.password}
      loginUrl={result.credentials.loginUrl}
      message={result.message}
      onDone={onClose}
    />
  );
}

function CredentialsBlock({
  title,
  email,
  password,
  loginUrl,
  message,
  onDone,
}: {
  title: string;
  email: string;
  password: string;
  loginUrl: string;
  message?: string;
  onDone: () => void;
}) {
  const t = useTranslations("admin");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20 text-[12.5px]">
        <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-muted-foreground text-[11.5px] mt-0.5">
            {t("modal.credsHint")}
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <CopyRow label={t("modal.loginUrl")} value={loginUrl} onCopy={() => copy(loginUrl, "url")} copied={copied === "url"} />
        <CopyRow label={t("modal.email")} value={email} onCopy={() => copy(email, "email")} copied={copied === "email"} />
        <div className="space-y-1.5">
          <Label className="text-[11.5px] font-medium text-muted-foreground">
            {t("modal.password")}
          </Label>
          <div className="flex gap-2">
            <Input
              value={password}
              type={showPassword ? "text" : "password"}
              readOnly
              className="h-11 font-mono text-[13px]"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => copy(password, "pwd")}
            >
              {copied === "pwd" ? (
                <Check className="w-4 h-4 text-primary" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {message && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-[11.5px] font-medium text-muted-foreground">
              {t("modal.messageToSend")}
            </Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] gap-1.5"
              onClick={() => copy(message, "msg")}
            >
              {copied === "msg" ? (
                <>
                  <Check className="w-3.5 h-3.5 text-primary" />
                  {t("modal.copied")}
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  {t("modal.copyAll")}
                </>
              )}
            </Button>
          </div>
          <textarea
            readOnly
            value={message}
            rows={9}
            className="w-full rounded-lg border border-border bg-muted/40 p-3 text-[12.5px] font-mono whitespace-pre-wrap resize-none focus:outline-none focus:border-ring"
          />
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button onClick={onDone}>{t("modal.done")}</Button>
      </div>
    </div>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11.5px] font-medium text-muted-foreground">
        {label}
      </Label>
      <div className="flex gap-2">
        <Input value={value} readOnly className="h-11 font-mono text-[13px]" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={onCopy}
        >
          {copied ? (
            <Check className="w-4 h-4 text-primary" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PIECES
// ══════════════════════════════════════════════════════════════

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in">
      <div
        ref={ref}
        className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl animate-fade-in-up"
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-[15px] font-semibold text-foreground">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  accent: "primary" | "emerald" | "blue" | "amber";
}) {
  const accentMap: Record<typeof accent, { bg: string; fg: string }> = {
    primary: { bg: "bg-primary/10", fg: "text-primary" },
    emerald: { bg: "bg-emerald-500/10", fg: "text-emerald-500" },
    blue: { bg: "bg-blue-500/10", fg: "text-blue-500" },
    amber: { bg: "bg-amber-500/10", fg: "text-amber-500" },
  };
  const a = accentMap[accent];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div
        className={cn(
          "w-9 h-9 rounded-xl grid place-items-center mb-3",
          a.bg
        )}
      >
        <Icon className={cn("w-4 h-4", a.fg)} />
      </div>
      <p className="font-display text-[26px] font-semibold tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[11.5px] text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3.5 py-2.5 -mb-px border-b-2 text-[13px] font-medium transition-colors flex items-center gap-2",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
      <span
        className={cn(
          "text-[10.5px] px-1.5 py-0.5 rounded-md",
          active
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function RoleBadge({ role }: { role: PlatformRole }) {
  if (role === "HIPER_ADMIN") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/30">
        <Crown className="w-3 h-3" />
        HIPER ADMIN
      </span>
    );
  }
  if (role === "SUPER_ADMIN") {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30">
        <Shield className="w-3 h-3" />
        SUPER ADMIN
      </span>
    );
  }
  return null;
}

function PlanBadge({ plan }: { plan: string }) {
  const styles: Record<string, string> = {
    FREE: "bg-muted text-muted-foreground border-border",
    STARTER: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    PRO: "bg-primary/10 text-primary border-primary/20",
    ENTERPRISE: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  };
  return (
    <span
      className={cn(
        "text-[10px] font-semibold px-1.5 py-0.5 rounded-md border uppercase tracking-wide",
        styles[plan] || styles.FREE
      )}
    >
      {plan}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="w-10 h-10 rounded-full bg-muted grid place-items-center text-[12px] font-semibold text-foreground shrink-0">
      {initials}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11.5px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function EmptyState({
  icon: Icon,
  title,
  hint,
  compact,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("text-center", compact ? "py-10" : "py-16")}>
      <div className="w-12 h-12 rounded-xl bg-muted grid place-items-center mx-auto mb-4">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <p className="text-[14px] font-medium text-foreground mb-1">{title}</p>
      {hint && (
        <p className="text-[12px] text-muted-foreground max-w-sm mx-auto">
          {hint}
        </p>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
