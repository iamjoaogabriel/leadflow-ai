// src/app/[locale]/(auth)/register/page.tsx
"use client";

import React, { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
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
import { LanguagePicker } from "@/components/shared/language-picker";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

const supabaseBrowser = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

type FormErrors = Record<string, string>;

type Plan = "STARTER" | "PRO" | "ENTERPRISE";

export default function RegisterPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const canceled = searchParams.get("canceled");

  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    companyName: "",
    plan: "STARTER" as Plan,
  });

  function update(field: keyof typeof form, value: string) {
    setForm((p) => ({ ...p, [field]: value }));
    if (errors[field]) {
      setErrors((p) => {
        const next = { ...p };
        delete next[field];
        return next;
      });
    }
  }

  function validate(): boolean {
    const errs: FormErrors = {};
    if (form.name.trim().length < 2) errs.name = t("nameRequired");
    if (form.companyName.trim().length < 2)
      errs.companyName = t("companyRequired");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = t("invalidEmail");
    if (form.password.length < 8) errs.password = t("passwordMinLength");
    if (form.password !== form.confirmPassword)
      errs.confirmPassword = t("passwordMismatch");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          companyName: form.companyName.trim(),
          plan: form.plan,
          locale,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
        accountId?: string;
      };
      if (!res.ok) {
        if (data.error === "email_already_registered")
          setServerError(t("emailAlreadyRegistered"));
        else if (data.error === "validation_failed")
          setServerError(t("validationFailed"));
        else setServerError(t("registrationFailed"));
        return;
      }
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        // No Stripe configured — go straight to onboarding
        window.location.href = `/${locale}/onboarding`;
      }
    } catch {
      setServerError(t("registrationFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleOAuth(provider: "google" | "apple") {
    setServerError(null);
    setOauthLoading(provider);
    try {
      const { error } = await supabaseBrowser.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?locale=${locale}`,
          queryParams:
            provider === "google"
              ? { access_type: "offline", prompt: "consent" }
              : {},
        },
      });
      if (error) {
        setServerError(error.message);
        setOauthLoading(null);
      }
    } catch {
      setServerError(t("oauthFailed"));
      setOauthLoading(null);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Marketing Digital AI"
            width={28}
            height={28}
            className="rounded-lg"
          />
          <span className="font-display text-[13px] font-semibold tracking-tight">
            Marketing Digital AI
          </span>
        </div>
        <LanguagePicker align="end" compact />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-[440px] animate-fade-in-up">
          <div className="text-center mb-7">
            <h1 className="font-display text-[26px] font-semibold tracking-tight text-foreground leading-tight">
              {t("registerTitle")}
            </h1>
            <p className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed">
              {t("registerSubtitle")}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-5">
            <div className="grid grid-cols-2 gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOAuth("google")}
                disabled={!!oauthLoading || loading}
                className="h-10"
              >
                {oauthLoading === "google" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <GoogleIcon />
                    Google
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOAuth("apple")}
                disabled={!!oauthLoading || loading}
                className="h-10"
              >
                {oauthLoading === "apple" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <AppleIcon />
                    Apple
                  </>
                )}
              </Button>
            </div>

            <div className="relative flex items-center">
              <span className="flex-1 h-px bg-border" />
              <span className="px-3 text-[10.5px] uppercase tracking-wider text-muted-foreground/80 font-medium">
                {t("orContinueWith")}
              </span>
              <span className="flex-1 h-px bg-border" />
            </div>

            {(serverError || canceled) && (
              <div
                role="alert"
                className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12.5px] text-destructive"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="flex-1">
                  {serverError || t("checkoutCanceled")}
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Field id="name" label={t("yourName")} icon={User} error={errors.name}>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  required
                  autoComplete="name"
                  placeholder={t("yourNamePlaceholder")}
                  className={cn("h-11 pl-9", errors.name && "border-destructive")}
                />
              </Field>

              <Field
                id="company"
                label={t("companyName")}
                icon={Building2}
                error={errors.companyName}
              >
                <Input
                  id="company"
                  value={form.companyName}
                  onChange={(e) => update("companyName", e.target.value)}
                  required
                  placeholder={t("companyNamePlaceholder")}
                  className={cn(
                    "h-11 pl-9",
                    errors.companyName && "border-destructive"
                  )}
                />
              </Field>

              <Field id="email" label={t("email")} icon={Mail} error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="voce@empresa.com"
                  className={cn("h-11 pl-9", errors.email && "border-destructive")}
                />
              </Field>

              <Field
                id="password"
                label={t("password")}
                icon={Lock}
                error={errors.password}
              >
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  required
                  autoComplete="new-password"
                  placeholder={t("passwordHint")}
                  className={cn(
                    "h-11 pl-9 pr-10",
                    errors.password && "border-destructive"
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </Field>

              <Field
                id="confirmPassword"
                label={t("confirmPassword")}
                icon={Lock}
                error={errors.confirmPassword}
              >
                <Input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(e) => update("confirmPassword", e.target.value)}
                  required
                  autoComplete="new-password"
                  className={cn(
                    "h-11 pl-9",
                    errors.confirmPassword && "border-destructive"
                  )}
                />
              </Field>

              <div className="space-y-1.5">
                <Label className="text-[11.5px] font-medium text-muted-foreground">
                  {t("selectPlan")}
                </Label>
                <Select
                  value={form.plan}
                  onValueChange={(v) =>
                    setForm((p) => ({ ...p, plan: v as Plan }))
                  }
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STARTER">
                      Starter — $29/{t("month")}
                    </SelectItem>
                    <SelectItem value="PRO">Pro — $79/{t("month")}</SelectItem>
                    <SelectItem value="ENTERPRISE">
                      Enterprise — $199/{t("month")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {t("trialInfo")}
                </p>
              </div>

              <Button
                type="submit"
                disabled={loading || !!oauthLoading}
                className="w-full h-11 text-[13.5px] font-semibold gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {t("continueToPayment")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <p className="text-center text-[12.5px] text-muted-foreground pt-1">
              {t("hasAccount")}{" "}
              <Link
                href={`/${locale}/login`}
                className="font-semibold text-primary hover:underline"
              >
                {t("login")}
              </Link>
            </p>
          </div>

          <p className="text-center text-[10.5px] text-muted-foreground/70 mt-6">
            {t("legalFooter")}
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  icon: Icon,
  error,
  children,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={id}
        className="text-[11.5px] font-medium text-muted-foreground"
      >
        {label}
      </Label>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        {children}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC04"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-4 w-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}
