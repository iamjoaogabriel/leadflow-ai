// src/components/layout/notifications-popover.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bell,
  Target,
  Flame,
  CalendarClock,
  Inbox,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Notification {
  id: string;
  event: string;
  title: string;
  message: string;
  createdAt: string;
  read: boolean;
}

const EVENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  "lead.first_contact": MessageSquare,
  "lead.converted": Target,
  "lead.escalated": Flame,
  "lead.meeting_scheduled": CalendarClock,
  "lead.meta_leadgen_received": Inbox,
};

const POLL_MS = 60_000;

export function NotificationsPopover() {
  const t = useTranslations("notifications");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications: Notification[];
        unreadCount: number;
      };
      if (!mountedRef.current) return;
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      // silent — next poll will retry
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, [load]);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", { method: "POST" });
    } catch {
      // best-effort
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  };

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) load();
        }}
        className="relative h-9 w-9 rounded-lg flex items-center justify-center hover:bg-muted/60 transition-colors cursor-pointer"
        aria-label={t("title")}
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 border border-background text-[9px] font-bold text-white flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-[340px] rounded-xl border border-border/60 shadow-xl bg-card z-50 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
              <h4 className="text-sm font-semibold">{t("title")}</h4>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-[10.5px] text-primary hover:underline cursor-pointer"
                >
                  {t("markAllRead")}
                </button>
              )}
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : notifications.length === 0 ? (
                <div className="py-10 text-center text-muted-foreground text-xs">
                  {t("empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border/30">
                  {notifications.map((n) => {
                    const Icon = EVENT_ICON[n.event] || Bell;
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "px-4 py-3 hover:bg-muted/30 transition-colors flex items-start gap-3",
                          !n.read && "bg-primary/5"
                        )}
                      >
                        <div
                          className={cn(
                            "w-7 h-7 rounded-full grid place-items-center shrink-0 mt-0.5",
                            !n.read
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p
                              className={cn(
                                "text-[12.5px] font-medium",
                                !n.read ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {n.title}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums mt-0.5">
                              {relativeTime(n.createdAt)}
                            </span>
                          </div>
                          {n.message && (
                            <p className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                              {n.message}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60_000));
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}
