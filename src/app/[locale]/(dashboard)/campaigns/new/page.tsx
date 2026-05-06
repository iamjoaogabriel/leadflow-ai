// src/app/[locale]/(dashboard)/campaigns/new/page.tsx
"use client";

import React, { useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Image, Video, Type, X,
  CheckCircle, Mic, Globe, Brain, FileAudio,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

type UploadType = "video" | "audio" | "image" | "text" | null;

const COUNTRIES = [
  { code: "BR", flag: "🇧🇷" }, { code: "US", flag: "🇺🇸" }, { code: "GB", flag: "🇬🇧" },
  { code: "DE", flag: "🇩🇪" }, { code: "FR", flag: "🇫🇷" }, { code: "ES", flag: "🇪🇸" },
  { code: "PT", flag: "🇵🇹" }, { code: "IT", flag: "🇮🇹" }, { code: "MX", flag: "🇲🇽" },
  { code: "AR", flag: "🇦🇷" }, { code: "CO", flag: "🇨🇴" }, { code: "CZ", flag: "🇨🇿" },
  { code: "AT", flag: "🇦🇹" }, { code: "CH", flag: "🇨🇭" }, { code: "NL", flag: "🇳🇱" },
  { code: "AU", flag: "🇦🇺" }, { code: "CA", flag: "🇨🇦" }, { code: "JP", flag: "🇯🇵" },
];

export default function NewCampaignPage() {
  const t = useTranslations("campaigns");
  const tc = useTranslations("common");
  const tco = useTranslations("countries");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [showCountries, setShowCountries] = useState(false);
  const [aiLanguage, setAiLanguage] = useState<string>("auto");
  const [uploadType, setUploadType] = useState<UploadType>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [caption, setCaption] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setFile(f); setAiAnalysis(null);
    if (f.type.startsWith("image/")) { setUploadType("image"); setPreview(URL.createObjectURL(f)); }
    else if (f.type.startsWith("video/")) { setUploadType("video"); setPreview(URL.createObjectURL(f)); }
    else if (f.type.startsWith("audio/")) { setUploadType("audio"); setPreview(null); }
  }

  function clearMedia() {
    setFile(null); setPreview(null); setUploadType(null); setTextContent(""); setCaption(""); setAiAnalysis(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); audioChunks.current = [];
      mr.ondataavailable = (e) => audioChunks.current.push(e.data);
      mr.onstop = () => { const blob = new Blob(audioChunks.current, { type: "audio/webm" }); setFile(new File([blob], "recording.webm", { type: "audio/webm" })); setUploadType("audio"); setAiAnalysis(null); stream.getTracks().forEach(t => t.stop()); };
      mr.start(); mediaRecorder.current = mr; setRecording(true);
    } catch { alert(t("micError")); }
  }

  function stopRecording() { mediaRecorder.current?.stop(); setRecording(false); }
  function toggleCountry(code: string) { setCountries(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]); }

  async function analyzeWithAI() {
    setAnalyzing(true); setAiAnalysis(null);
    try {
      const fd = new FormData();
      if (file) fd.append("file", file); if (textContent) fd.append("text", textContent);
      if (caption) fd.append("caption", caption); fd.append("type", uploadType || "text"); fd.append("campaignName", name);
      const res = await fetch("/api/campaigns/analyze", { method: "POST", body: fd });
      if (res.ok) { const data = await res.json(); setAiAnalysis(data.analysis); }
      else setAiAnalysis(t("analyzeError"));
    } catch { setAiAnalysis(t("connectionError")); }
    setAnalyzing(false);
  }

  async function saveCampaign() {
    if (!name.trim()) return; setSaving(true);
    try {
      const fd = new FormData(); fd.append("name", name.trim()); fd.append("description", description.trim());
      if (file) fd.append("file", file);
      if (uploadType === "text") fd.append("type", "TEXT"); else if (uploadType) fd.append("type", uploadType.toUpperCase()); else fd.append("type", "DIGITAL");
      if (textContent) fd.append("transcription", textContent); if (caption) fd.append("caption", caption);
      if (aiAnalysis) fd.append("transcription", aiAnalysis); if (countries.length > 0) fd.append("countries", JSON.stringify(countries));
      fd.append("aiLanguage", aiLanguage);
      const res = await fetch("/api/campaigns", { method: "POST", body: fd });
      if (res.ok) { router.push("/campaigns"); router.refresh(); }
    } catch {} setSaving(false);
  }

  const hasContent = file || textContent.trim();

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/campaigns" className="w-9 h-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors">
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </Link>
        <div>
          <h1 className="font-space-grotesk font-bold text-xl text-foreground tracking-tight">{t("newCampaign")}</h1>
          <p className="text-[12px] text-muted-foreground font-dm-sans mt-0.5">{t("newCampaignDesc")}</p>
        </div>
      </div>

      {/* Step 1 */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-space-grotesk text-[14px] font-semibold text-foreground">{t("campaignInfo")}</h2>
          <p className="text-[11px] text-muted-foreground font-dm-sans mt-0.5">{t("infoSubtitle")}</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("campaignName")} *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={t("campaignNamePlaceholder")} required
            className="w-full h-10 px-4 rounded-xl bg-muted border border-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-ring/30 transition-all font-dm-sans" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("descriptionOptional")}</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder={t("descriptionPlaceholder")}
            className="w-full px-4 py-3 rounded-xl bg-muted border border-transparent text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-ring/30 transition-all font-dm-sans" />
        </div>
      </div>

      {/* Step 2 */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-space-grotesk text-[14px] font-semibold text-foreground flex items-center gap-2">
            <Globe className="w-4 h-4 text-muted-foreground" />{t("targetCountries")}
          </h2>
          <p className="text-[11px] text-muted-foreground font-dm-sans mt-0.5">{t("targetCountriesDesc")}</p>
        </div>
        {countries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {countries.map(code => {
              const c = COUNTRIES.find(x => x.code === code);
              return (
                <button key={code} onClick={() => toggleCountry(code)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20 text-[11px] font-medium cursor-pointer hover:bg-primary/15 transition-colors">
                  {c?.flag} {tco(code)}<X className="w-3 h-3 ml-0.5 opacity-60" />
                </button>
              );
            })}
          </div>
        )}
        <button onClick={() => setShowCountries(!showCountries)} className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-muted text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors font-dm-sans">
          <span>{countries.length === 0 ? t("selectCountries") : t("addMoreCountries")}</span>
          <ChevronDown className={cn("w-4 h-4 transition-transform", showCountries && "rotate-180")} />
        </button>
        {showCountries && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-[200px] overflow-y-auto">
            {COUNTRIES.filter(c => !countries.includes(c.code)).map(c => (
              <button key={c.code} onClick={() => toggleCountry(c.code)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer transition-colors font-dm-sans">
                <span>{c.flag}</span><span>{tco(c.code)}</span>
              </button>
            ))}
          </div>
        )}

        {/* AI Language override */}
        <div className="pt-3 border-t border-border space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            {t("aiLanguageLabel")}
          </label>
          <p className="text-[11px] text-muted-foreground leading-relaxed font-dm-sans">
            {t("aiLanguageHint")}
          </p>
          <select
            value={aiLanguage}
            onChange={(e) => setAiLanguage(e.target.value)}
            className="w-full h-10 px-3 rounded-xl bg-muted border border-transparent text-[13px] text-foreground focus:outline-none focus:border-ring/30 cursor-pointer font-dm-sans"
          >
            <option value="auto">{t("aiLanguageAuto")}</option>
            <option value="pt-BR">🇧🇷 Português (Brasil)</option>
            <option value="pt">🇵🇹 Português (Portugal)</option>
            <option value="en">🇺🇸 English</option>
            <option value="es">🇪🇸 Español</option>
            <option value="de">🇩🇪 Deutsch</option>
            <option value="fr">🇫🇷 Français</option>
            <option value="it">🇮🇹 Italiano</option>
            <option value="nl">🇳🇱 Nederlands</option>
            <option value="ja">🇯🇵 日本語</option>
          </select>
        </div>
      </div>

      {/* Step 3 */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-space-grotesk text-[14px] font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-muted-foreground" />{t("campaignContent")}
          </h2>
          <p className="text-[11px] text-muted-foreground font-dm-sans mt-0.5">{t("campaignContentDesc")}</p>
        </div>

        {!uploadType && !file && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {([
                { type: "video" as UploadType, icon: Video, labelKey: "video", accept: "video/*" },
                { type: "audio" as UploadType, icon: FileAudio, labelKey: "audio", accept: "audio/*" },
                { type: "image" as UploadType, icon: Image, labelKey: "image", accept: "image/*" },
                { type: "text" as UploadType, icon: Type, labelKey: "text", accept: "" },
              ] as const).map(opt => (
                <button key={opt.type} type="button"
                  onClick={() => { if (opt.type === "text") setUploadType("text"); else { fileRef.current?.setAttribute("accept", opt.accept); fileRef.current?.click(); } }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] transition-all cursor-pointer group">
                  <opt.icon className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">{t(opt.labelKey)}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border" /><span className="text-[10px] text-muted-foreground uppercase tracking-wider">{t("or")}</span><div className="flex-1 h-px bg-border" />
            </div>
            <button onClick={recording ? stopRecording : startRecording}
              className={cn("w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed transition-all cursor-pointer font-dm-sans text-sm",
                recording ? "border-red-500/50 bg-red-500/[0.05] text-red-500" : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground")}>
              <Mic className={cn("w-4 h-4", recording && "animate-pulse")} />
              {recording ? t("recording") : t("recordAudio")}
            </button>
          </>
        )}

        <input ref={fileRef} type="file" onChange={handleFile} className="hidden" />

        {uploadType === "text" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-dm-sans"><Type className="w-3.5 h-3.5" />{t("textContent")}</span>
              <button onClick={clearMedia} className="text-[11px] text-destructive hover:underline cursor-pointer font-dm-sans">{t("remove")}</button>
            </div>
            <textarea value={textContent} onChange={e => setTextContent(e.target.value)} rows={6} placeholder={t("textPlaceholder")}
              className="w-full px-4 py-3 rounded-xl bg-muted border border-transparent text-sm text-foreground placeholder:text-muted-foreground/40 resize-y focus:outline-none focus:border-ring/30 transition-all font-dm-sans leading-relaxed" />
          </div>
        )}

        {uploadType === "image" && file && preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-dm-sans"><Image className="w-3.5 h-3.5" />{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
              <button onClick={clearMedia} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-destructive cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl overflow-hidden border border-border"><img src={preview} alt="" className="w-full max-h-[300px] object-cover" /></div>
          </div>
        )}

        {uploadType === "video" && file && preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-dm-sans"><Video className="w-3.5 h-3.5" />{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
              <button onClick={clearMedia} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-destructive cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="rounded-xl overflow-hidden border border-border"><video src={preview} controls className="w-full max-h-[300px]" /></div>
          </div>
        )}

        {uploadType === "audio" && file && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-dm-sans"><FileAudio className="w-3.5 h-3.5" />{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
              <button onClick={clearMedia} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-destructive cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <audio controls className="w-full"><source src={URL.createObjectURL(file)} /></audio>
          </div>
        )}

        {(uploadType === "image" || uploadType === "video") && file && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{t("adCaption")}</label>
            <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={3} placeholder={t("captionPlaceholder")}
              className="w-full px-4 py-3 rounded-xl bg-muted border border-transparent text-sm text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-ring/30 transition-all font-dm-sans" />
          </div>
        )}

        {hasContent && !aiAnalysis && (
          <button onClick={analyzeWithAI} disabled={analyzing}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl btn-brand text-sm font-semibold disabled:opacity-50">
            {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" />{t("analyzingAI")}</> : <><Brain className="w-4 h-4" />{t("analyzeWithAI")}</>}
          </button>
        )}

        {aiAnalysis && (
          <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-primary" />
              <span className="text-[12px] font-bold text-primary uppercase tracking-wider">{t("aiUnderstood")}</span>
            </div>
            <p className="text-[13px] text-foreground leading-relaxed font-dm-sans whitespace-pre-wrap">{aiAnalysis}</p>
            <button onClick={analyzeWithAI} disabled={analyzing} className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 cursor-pointer font-dm-sans pt-2">
              {analyzing ? t("analyzingAI") : t("reanalyze")}
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3">
        <Link href="/campaigns" className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-dm-sans">
          {tc("cancel")}
        </Link>
        <button onClick={saveCampaign} disabled={saving || !name.trim()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl btn-brand text-sm font-semibold disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          {saving ? t("saving") : t("createCampaign")}
        </button>
      </div>
    </div>
  );
}