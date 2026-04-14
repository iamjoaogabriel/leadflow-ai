// src/app/[locale]/(dashboard)/pipeline/page.tsx
"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Filter, Loader2, Save, CheckCircle, ChevronDown,
  Phone, Mail, Smartphone, Copy, Check, ExternalLink,
  ArrowRight, Calendar, UserCheck, ShoppingCart, FileText,
  Clock, Zap, MessageSquare, Globe, Link2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ═══ TYPES ═══ */
interface PipelineConfig {
  template: string;
  goal: string;
  firstContact: string;
  primaryChannel: string;
  secondaryChannel: string;
  transferPhone: string;
  transferMessage: string;
  calendarEnabled: boolean;
  calendarEmail: string;
  followUpEnabled: boolean;
  followUpAttempts: number;
  followUpInterval: number;
  humanApproval: boolean;
  webhookId: string;
}

const DEFAULT_CONFIG: PipelineConfig = {
  template: "", goal: "", firstContact: "immediate",
  primaryChannel: "WHATSAPP", secondaryChannel: "",
  transferPhone: "", transferMessage: "",
  calendarEnabled: false, calendarEmail: "",
  followUpEnabled: true, followUpAttempts: 3, followUpInterval: 24,
  humanApproval: false, webhookId: "",
};

/* ═══ PAGE ═══ */
export default function PipelinePage() {
  const t = useTranslations("pipeline");
  const tc = useTranslations("common");

  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const showToast = (msg: string, ok: boolean) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 4000); };

  useEffect(() => {
    fetch("/api/pipeline").then(r => r.ok ? r.json() : null).then(d => {
      if (d) setConfig(prev => ({ ...prev, ...d }));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const isProactive = ["form_lp", "quiz_external", "lp_followup", "manual_outbound"].includes(config.template);
  const needsTransfer = config.goal === "qualify_transfer";
  const needsCalendar = config.goal === "schedule_meeting";
  const needsWebhook = ["form_lp", "quiz_external", "lp_followup"].includes(config.template);

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/webhooks/leads${config.webhookId ? `?key=${config.webhookId}` : ""}`
    : "";

  async function handleSave() {
    if (!config.template) { showToast(t("selectTemplateFirst"), false); return; }
    if (!config.goal) { showToast(t("selectGoalFirst"), false); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (r.ok) {
        const d = await r.json();
        if (d.webhookId) setConfig(p => ({ ...p, webhookId: d.webhookId }));
        setSaved(true); showToast(t("savedSuccess"), true); setTimeout(() => setSaved(false), 3000);
      } else showToast(t("saveError"), false);
    } catch { showToast(t("connectionError"), false); }
    setSaving(false);
  }

  function copyWebhook() { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  if (loading) return <div className="flex items-center justify-center py-32"><Loader2 className="w-5 h-5 text-muted-foreground animate-spin" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {toast && (
        <div className={cn("fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-[12px] font-medium shadow-lg border animate-in slide-in-from-top-2",
          toast.ok ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
        )}>{toast.msg}</div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-space-grotesk text-2xl font-bold text-foreground tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-dm-sans">{t("subtitle")}</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl btn-brand text-[13px] font-semibold disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><CheckCircle className="w-4 h-4" />{t("saved")}</> : <><Save className="w-4 h-4" />{t("saveConfig")}</>}
        </button>
      </div>

      {/* ═══ STEP 1: Lead Origin ═══ */}
      <StepCard step={1} title={t("step1.title")} desc={t("step1.desc")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { id: "form_lp", icon: FileText, badge: t("tpl.proactive") },
            { id: "whatsapp_direct", icon: Phone, badge: t("tpl.reactive") },
            { id: "quiz_external", icon: Globe, badge: t("tpl.proactive") },
            { id: "social_dm", icon: MessageSquare, badge: t("tpl.reactive") },
            { id: "lp_followup", icon: Mail, badge: t("tpl.proactive") },
            { id: "manual_outbound", icon: Link2, badge: t("tpl.proactive") },
          ].map(tpl => {
            const sel = config.template === tpl.id;
            const tplKey = tpl.id === "form_lp" ? "formProactive" : tpl.id === "whatsapp_direct" ? "whatsappReactive"
              : tpl.id === "quiz_external" ? "quizProactive" : tpl.id === "social_dm" ? "socialReactive"
              : tpl.id === "lp_followup" ? "emailNurture" : "manualOutbound";
            return (
              <button key={tpl.id} onClick={() => setConfig({ ...config, template: tpl.id })}
                className={cn("p-3 rounded-xl border-2 text-left cursor-pointer transition-all",
                  sel ? "border-primary bg-primary/[0.04]" : "border-border hover:border-primary/20")}>
                <div className="flex items-center gap-2 mb-1">
                  <tpl.icon className={cn("w-4 h-4", sel ? "text-primary" : "text-muted-foreground")} />
                  <span className="text-[12px] font-semibold text-foreground">{t(`tpl.${tplKey}.title` as any)}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium ml-auto">{tpl.badge}</span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{t(`tpl.${tplKey}.desc` as any)}</p>
              </button>
            );
          })}
        </div>
      </StepCard>

      {/* ═══ STEP 2: AI Goal ═══ */}
      {config.template && (
        <StepCard step={2} title={t("step2.title")} desc={t("step2.desc")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { id: "close_sale", icon: ShoppingCart, key: "closeSale" },
              { id: "schedule_meeting", icon: Calendar, key: "scheduleMeeting" },
              { id: "qualify_transfer", icon: UserCheck, key: "qualifyTransfer" },
              { id: "collect_send", icon: FileText, key: "collectSend" },
            ].map(g => {
              const sel = config.goal === g.id;
              return (
                <button key={g.id} onClick={() => setConfig({ ...config, goal: g.id })}
                  className={cn("p-3 rounded-xl border-2 text-left cursor-pointer transition-all",
                    sel ? "border-primary bg-primary/[0.04]" : "border-border hover:border-primary/20")}>
                  <div className="flex items-center gap-2 mb-1">
                    <g.icon className={cn("w-4 h-4", sel ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-[12px] font-semibold text-foreground">{t(`goal.${g.key}.title` as any)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-relaxed">{t(`goal.${g.key}.desc` as any)}</p>
                </button>
              );
            })}
          </div>
        </StepCard>
      )}

      {/* ═══ STEP 3: First Contact Timing (proactive only) ═══ */}
      {config.template && config.goal && isProactive && (
        <StepCard step={3} title={t("step3.title")} desc={t("step3.desc")}>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: "immediate", sub: "immediateSub" },
              { id: "5min", sub: "delay5Sub" },
              { id: "15min", sub: "delay15Sub" },
              { id: "30min", sub: "delay30Sub" },
            ].map(tm => {
              const sel = config.firstContact === tm.id;
              const label = tm.id === "immediate" ? t("timing.immediate") : tm.id === "5min" ? t("timing.delay5") : tm.id === "15min" ? t("timing.delay15") : t("timing.delay30");
              return (
                <button key={tm.id} onClick={() => setConfig({ ...config, firstContact: tm.id })}
                  className={cn("p-3 rounded-xl border-2 text-center cursor-pointer transition-all",
                    sel ? "border-primary bg-primary/[0.04]" : "border-border hover:border-primary/20")}>
                  <Clock className={cn("w-4 h-4 mx-auto mb-1", sel ? "text-primary" : "text-muted-foreground")} />
                  <p className="text-[12px] font-semibold text-foreground">{label}</p>
                  <p className="text-[9px] text-muted-foreground">{t(`timing.${tm.sub}` as any)}</p>
                </button>
              );
            })}
          </div>
        </StepCard>
      )}

      {/* ═══ STEP 4: Channel Selection ═══ */}
      {config.template && config.goal && (
        <StepCard step={isProactive ? 4 : 3} title={t("step4.title")} desc={t("step4.desc")}>
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">{t("step4.primary")}</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "WHATSAPP", icon: Phone, color: "bg-[#25D366]", label: "WhatsApp" },
                  { id: "EMAIL", icon: Mail, color: "bg-blue-500", label: "Email" },
                  { id: "SMS", icon: Smartphone, color: "bg-violet-500", label: "SMS" },
                ].map(ch => {
                  const sel = config.primaryChannel === ch.id;
                  return (
                    <button key={ch.id} onClick={() => setConfig({ ...config, primaryChannel: ch.id })}
                      className={cn("flex items-center gap-2 p-3 rounded-xl border-2 cursor-pointer transition-all",
                        sel ? "border-primary bg-primary/[0.04]" : "border-border hover:border-primary/20")}>
                      <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", ch.color)}><ch.icon className="w-3.5 h-3.5 text-white" /></div>
                      <span className="text-[12px] font-semibold text-foreground">{ch.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">{t("step4.secondary")} <span className="normal-case tracking-normal text-muted-foreground/40">— {tc("optional")}</span></label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "", label: t("step4.none") },
                  { id: "EMAIL", icon: Mail, label: "Email" },
                  { id: "SMS", icon: Smartphone, label: "SMS" },
                ].filter(ch => ch.id !== config.primaryChannel).map(ch => {
                  const sel = config.secondaryChannel === ch.id;
                  return (
                    <button key={ch.id || "none"} onClick={() => setConfig({ ...config, secondaryChannel: ch.id })}
                      className={cn("flex items-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all text-[11px] font-medium",
                        sel ? "border-primary bg-primary/[0.04] text-foreground" : "border-border hover:border-primary/20 text-muted-foreground")}>
                      {ch.icon && <ch.icon className="w-3.5 h-3.5" />}{ch.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </StepCard>
      )}

      {/* ═══ STEP 5: Transfer Config ═══ */}
      {needsTransfer && (
        <StepCard step={isProactive ? 5 : 4} title={t("step5transfer.title")} desc={t("step5transfer.desc")}>
          <div className="space-y-3 max-w-md">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("step5transfer.phone")} *</label>
              <input value={config.transferPhone} onChange={e => setConfig({ ...config, transferPhone: e.target.value })}
                placeholder="+5511999999999" className="w-full h-10 px-4 rounded-xl bg-muted border border-transparent text-[13px] text-foreground font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-ring/30" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("step5transfer.message")}</label>
              <textarea value={config.transferMessage} onChange={e => setConfig({ ...config, transferMessage: e.target.value })}
                rows={2} placeholder={t("step5transfer.messagePlaceholder")}
                className="w-full px-4 py-3 rounded-xl bg-muted border border-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:border-ring/30 font-dm-sans leading-relaxed" />
            </div>
          </div>
        </StepCard>
      )}

      {/* ═══ STEP 5: Calendar Config ═══ */}
      {needsCalendar && (
        <StepCard step={isProactive ? 5 : 4} title={t("step5calendar.title")} desc={t("step5calendar.desc")}>
          <div className="space-y-3 max-w-md">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-[12px] font-medium text-foreground">Google Calendar</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={config.calendarEnabled} onChange={e => setConfig({ ...config, calendarEnabled: e.target.checked })} className="sr-only peer" />
                <div className="w-9 h-5 bg-muted rounded-full peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
              </label>
            </div>
            {config.calendarEnabled && (
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("step5calendar.email")}</label>
                <input value={config.calendarEmail} onChange={e => setConfig({ ...config, calendarEmail: e.target.value })}
                  placeholder="seucalendario@gmail.com" className="w-full h-10 px-4 rounded-xl bg-muted border border-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-ring/30 font-dm-sans" />
                <p className="text-[10px] text-muted-foreground mt-1.5 font-dm-sans">{t("step5calendar.hint")}</p>
              </div>
            )}
          </div>
        </StepCard>
      )}

      {/* ═══ WEBHOOK INSTRUCTIONS ═══ */}
      {needsWebhook && config.goal && (
        <StepCard step={isProactive ? (needsTransfer || needsCalendar ? 6 : 5) : (needsTransfer || needsCalendar ? 5 : 4)} title={t("webhook.title")} desc={t("webhook.desc")}>
          <div className="space-y-3">
            {/* Webhook URL */}
            <div>
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("webhook.url")}</label>
              <div className="flex gap-2">
                <div className="flex-1 h-10 px-4 rounded-xl bg-muted flex items-center text-[12px] font-mono text-foreground truncate select-all">
                  {webhookUrl || t("webhook.saveFirst")}
                </div>
                <button onClick={copyWebhook} disabled={!config.webhookId}
                  className="h-10 px-3 rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30">
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              {!config.webhookId && <p className="text-[10px] text-amber-400 mt-1">{t("webhook.saveFirst")}</p>}
            </div>

            {/* Instructions */}
            <div className="rounded-xl bg-muted/30 border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider">{t("webhook.howTo")}</p>

              {config.template === "quiz_external" && (
                <div className="space-y-2 text-[11px] text-muted-foreground font-dm-sans">
                  <p className="font-semibold text-foreground">Typeform:</p>
                  <p>{t("webhook.typeform")}</p>
                  <p className="font-semibold text-foreground mt-2">Google Forms:</p>
                  <p>{t("webhook.googleForms")}</p>
                </div>
              )}

              {config.template === "form_lp" && (
                <div className="text-[11px] text-muted-foreground font-dm-sans space-y-1">
                  <p>{t("webhook.formLP")}</p>
                </div>
              )}

              {config.template === "lp_followup" && (
                <div className="text-[11px] text-muted-foreground font-dm-sans space-y-1">
                  <p>{t("webhook.lpFollowup")}</p>
                </div>
              )}

              <div className="rounded-lg bg-card border border-border p-3">
                <p className="text-[10px] font-semibold text-foreground mb-1.5">JSON {t("webhook.format")}:</p>
                <pre className="text-[10px] text-muted-foreground font-mono leading-relaxed">{`{
  "name": "João Silva",
  "email": "joao@email.com",
  "phone": "+5511999999999",
  "source": "typeform",
  "campaign": "Black Friday",
  "metadata": { ... }
}`}</pre>
              </div>

              <a href="https://docs.google.com/document/d/typeform-webhooks" target="_blank" rel="noopener"
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                {t("webhook.docs")} <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Meta Lead Ads */}
            {config.template === "form_lp" && (
              <div className="rounded-xl bg-amber-500/5 border border-amber-500/20 p-4 space-y-1">
                <p className="text-[11px] font-semibold text-amber-400">{t("webhook.metaTitle")}</p>
                <p className="text-[10px] text-muted-foreground font-dm-sans">{t("webhook.metaDesc")}</p>
              </div>
            )}
          </div>
        </StepCard>
      )}

      {/* ═══ FUNNEL PREVIEW ═══ */}
      {config.template && config.goal && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-space-grotesk text-[13px] font-semibold text-foreground mb-4">{t("preview.title")}</h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {(() => {
              const steps: { label: string; color: string }[] = [];
              steps.push({ label: t("funnel.leadArrives"), color: "bg-muted text-muted-foreground" });
              if (isProactive) steps.push({ label: t("funnel.aiContacts"), color: "bg-primary/10 text-primary" });
              steps.push({ label: t("funnel.conversation"), color: "bg-blue-500/10 text-blue-400" });
              steps.push({ label: t("funnel.qualified"), color: "bg-amber-500/10 text-amber-400" });
              const g = config.goal;
              if (g === "close_sale") steps.push({ label: t("funnel.saleClosed"), color: "bg-emerald-500/10 text-emerald-500" });
              else if (g === "schedule_meeting") steps.push({ label: t("funnel.meetingScheduled"), color: "bg-emerald-500/10 text-emerald-500" });
              else if (g === "qualify_transfer") steps.push({ label: t("funnel.transferred"), color: "bg-emerald-500/10 text-emerald-500" });
              else steps.push({ label: t("funnel.proposalSent"), color: "bg-emerald-500/10 text-emerald-500" });
              return steps.map((s, i) => (
                <React.Fragment key={i}>
                  <span className={cn("px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0", s.color)}>{s.label}</span>
                  {i < steps.length - 1 && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />}
                </React.Fragment>
              ));
            })()}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground font-dm-sans">
            <span>{t("step4.primary")}: <strong className="text-foreground">{config.primaryChannel}</strong></span>
            {config.secondaryChannel && <span>{t("step4.secondary")}: <strong className="text-foreground">{config.secondaryChannel}</strong></span>}
            {isProactive && <span>{t("step3.title").split("?")[0]}: <strong className="text-foreground">{config.firstContact}</strong></span>}
          </div>
        </div>
      )}

      {/* ═══ ADVANCED ═══ */}
      <button onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between px-5 py-3 rounded-2xl border border-border bg-card cursor-pointer hover:bg-muted/20 transition-colors">
        <span className="text-[13px] font-medium text-foreground">{t("advanced.title")}</span>
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", showAdvanced && "rotate-180")} />
      </button>

      {showAdvanced && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          {/* Follow-up */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
            <div>
              <p className="text-[12px] font-medium text-foreground">{t("advanced.followUp")}</p>
              <p className="text-[10px] text-muted-foreground">{t("advanced.followUpDesc")}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={config.followUpEnabled} onChange={e => setConfig({ ...config, followUpEnabled: e.target.checked })} className="sr-only peer" />
              <div className="w-9 h-5 bg-muted rounded-full peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>
          {config.followUpEnabled && (
            <div className="grid grid-cols-2 gap-3 ml-3 pl-3 border-l-2 border-border/30">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("advanced.attempts")}</label>
                <input type="number" min="1" max="10" value={config.followUpAttempts} onChange={e => setConfig({ ...config, followUpAttempts: parseInt(e.target.value) || 3 })}
                  className="w-full h-10 px-4 rounded-xl bg-muted border border-transparent text-[13px] text-foreground focus:outline-none focus:border-ring/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 block">{t("advanced.interval")} (h)</label>
                <input type="number" min="1" max="168" value={config.followUpInterval} onChange={e => setConfig({ ...config, followUpInterval: parseInt(e.target.value) || 24 })}
                  className="w-full h-10 px-4 rounded-xl bg-muted border border-transparent text-[13px] text-foreground focus:outline-none focus:border-ring/30" />
              </div>
            </div>
          )}
          {/* Human approval */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border">
            <div>
              <p className="text-[12px] font-medium text-foreground">{t("advanced.humanApproval")}</p>
              <p className="text-[10px] text-muted-foreground">{t("advanced.humanApprovalDesc")}</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={config.humanApproval} onChange={e => setConfig({ ...config, humanApproval: e.target.checked })} className="sr-only peer" />
              <div className="w-9 h-5 bg-muted rounded-full peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>
      )}

      {/* Bottom save */}
      <button onClick={handleSave} disabled={saving}
        className="w-full h-12 rounded-xl btn-brand text-[14px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><CheckCircle className="w-4 h-4" />{t("saved")}</> : <><Save className="w-4 h-4" />{t("saveConfig")}</>}
      </button>
    </div>
  );
}

function StepCard({ step, title, desc, children }: { step: number; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-[12px] font-bold text-primary">{step}</div>
        <div>
          <h2 className="font-space-grotesk text-[14px] font-semibold text-foreground">{title}</h2>
          <p className="text-[10px] text-muted-foreground font-dm-sans">{desc}</p>
        </div>
      </div>
      {children}
    </div>
  );
}