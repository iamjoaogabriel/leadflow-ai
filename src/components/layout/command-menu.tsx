// src/components/layout/command-menu.tsx
"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Search, Settings, LayoutDashboard, MessageSquare, Users,
  Plug, Loader2, ArrowRight, Mail, Smartphone, BarChart3,
  Brain, Plus, Megaphone, Phone, Filter, FileText,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ServerHit {
  type: "lead" | "campaign" | "conversation";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

interface Item {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  href: string;
  kind: "page" | ServerHit["type"];
}

const KIND_ICON: Record<ServerHit["type"], React.ComponentType<{ className?: string }>> = {
  lead: Users,
  campaign: Megaphone,
  conversation: MessageSquare,
};

export function CommandMenu() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("search");
  const base = `/${locale}`;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [serverHits, setServerHits] = React.useState<ServerHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<number | null>(null);

  const pages: Item[] = React.useMemo(
    () => [
      { key: "dashboard", icon: LayoutDashboard, title: t("pages.dashboard"), href: base, kind: "page" },
      { key: "conversations", icon: MessageSquare, title: t("pages.conversations"), href: `${base}/conversations`, kind: "page" },
      { key: "leads", icon: Users, title: t("pages.leads"), href: `${base}/leads`, kind: "page" },
      { key: "campaigns", icon: Megaphone, title: t("pages.campaigns"), href: `${base}/campaigns`, kind: "page" },
      { key: "new-campaign", icon: Plus, title: t("pages.newCampaign"), href: `${base}/campaigns/new`, kind: "page" },
      { key: "pipeline", icon: Filter, title: t("pages.pipeline"), href: `${base}/pipeline`, kind: "page" },
      { key: "analytics", icon: BarChart3, title: t("pages.analytics"), href: `${base}/analytics`, kind: "page" },
      { key: "whatsapp", icon: Phone, title: t("pages.whatsapp"), href: `${base}/channels/whatsapp`, kind: "page" },
      { key: "email", icon: Mail, title: t("pages.email"), href: `${base}/channels/email`, kind: "page" },
      { key: "sms", icon: Smartphone, title: t("pages.sms"), href: `${base}/channels/sms`, kind: "page" },
      { key: "ai-config", icon: Brain, title: t("pages.aiConfig"), href: `${base}/ai-config`, kind: "page" },
      { key: "integrations", icon: Plug, title: t("pages.integrations"), href: `${base}/settings/integrations`, kind: "page" },
      { key: "settings", icon: Settings, title: t("pages.settings"), href: `${base}/settings`, kind: "page" },
    ],
    [base, t]
  );

  // Close on outside click
  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        !inputRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Ctrl+K / Esc
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced server search
  React.useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setServerHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = (await res.json()) as { hits: ServerHit[] };
          setServerHits(Array.isArray(data.hits) ? data.hits : []);
        } else {
          setServerHits([]);
        }
      } catch {
        setServerHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  const filteredPages: Item[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return pages
      .filter((p) => p.title.toLowerCase().includes(q) || p.key.includes(q))
      .slice(0, 4);
  }, [query, pages]);

  const serverItems: Item[] = React.useMemo(() => {
    const localeBase = `/${locale}`;
    return serverHits.map((h) => ({
      key: `${h.type}-${h.id}`,
      icon: KIND_ICON[h.type],
      title: h.title,
      subtitle: h.subtitle,
      href: `${localeBase}${h.href}`,
      kind: h.type,
    }));
  }, [serverHits, locale]);

  const allItems: Item[] = React.useMemo(
    () => [...serverItems, ...filteredPages],
    [serverItems, filteredPages]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || allItems.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((p) => (p + 1) % allItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((p) => (p - 1 + allItems.length) % allItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(selectedIndex);
    }
  };

  const handleSelect = (idx: number) => {
    const item = allItems[idx];
    if (!item) return;
    router.push(item.href);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const showResults = open && query.length > 0;

  const kindLabel: Record<Item["kind"], string> = {
    page: t("kind.page"),
    lead: t("kind.lead"),
    campaign: t("kind.campaign"),
    conversation: t("kind.conversation"),
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative group">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setSelectedIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={t("placeholder")}
          className={cn(
            "h-10 w-full rounded-xl border bg-background/50 pl-10 pr-12 text-sm text-foreground placeholder:text-muted-foreground transition-all",
            "border-border/60 group-hover:border-border group-hover:bg-muted/30",
            "focus:border-primary/30 focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/10"
          )}
        />
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none group-hover:text-foreground transition-colors" />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none hidden h-5 select-none items-center gap-1 rounded border border-border bg-muted/20 px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:flex">
            <span className="text-xs">⌘</span>K
          </kbd>
        )}
      </div>

      {showResults && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-2 max-h-[450px] overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200"
        >
          {allItems.length === 0 && !loading ? (
            <div className="py-10 text-center">
              <Search className="mx-auto h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t("noResults")}</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {allItems.map((item, idx) => {
                const Icon = item.icon;
                const selected = selectedIndex === idx;
                return (
                  <button
                    key={item.key}
                    onClick={() => handleSelect(idx)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-200 group/item cursor-pointer",
                      selected
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                        selected
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground group-hover/item:border-primary/20 group-hover/item:text-primary"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {kindLabel[item.kind]}
                        {item.subtitle ? ` · ${item.subtitle}` : ""}
                      </div>
                    </div>
                    <ArrowRight
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 transition-all duration-200",
                        selected
                          ? "opacity-100 translate-x-0 text-primary"
                          : "opacity-0 -translate-x-2"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          )}
          <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex gap-3">
              <span>
                {t("hint.navigate")}{" "}
                <kbd className="font-mono bg-background border px-1 rounded mx-0.5">↓</kbd>{" "}
                <kbd className="font-mono bg-background border px-1 rounded mx-0.5">↑</kbd>
              </span>
              <span>
                {t("hint.select")}{" "}
                <kbd className="font-mono bg-background border px-1 rounded mx-0.5">↵</kbd>
              </span>
            </div>
            <span>{t("hint.close")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// Unused icons kept to avoid re-imports if pages change:
void FileText;
void Calendar;
