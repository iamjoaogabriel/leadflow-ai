// src/components/layout/sidebar.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Link, usePathname } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import {
  LayoutDashboard, Brain, Settings,
  ChevronLeft, ChevronRight, ChevronDown, LogOut,
  Sun, Moon, Laptop, Users, BarChart3,
  Target, Phone, Mail, Smartphone,
  Globe, Filter, Headphones, Webhook,
} from 'lucide-react'
import { useTheme } from 'next-themes'

interface SidebarProps { isCollapsed: boolean; onToggle: () => void }
interface NavItem { href: string; icon: any; label: string; id?: string; badge?: string }
interface NavGroup { label: string; icon: any; items: NavItem[]; defaultOpen?: boolean }

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => { setMounted(true) }, [])

  function cycleTheme() {
    if (theme === 'light') setTheme('purple')
    else if (theme === 'purple') setTheme('dark')
    else setTheme('light')
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  /* ═══════════════════════════════════════
     NAVEGAÇÃO PRINCIPAL
     Painel geral → Atendimentos da IA → Campanhas de tráfego
     ═══════════════════════════════════════ */
  const topNav: NavItem[] = [
    { href: '/', icon: LayoutDashboard, label: 'Painel', id: 'sidebar-painel' },
    { href: '/conversations', icon: Headphones, label: 'Atendimentos', id: 'sidebar-atendimentos' },
    { href: '/campaigns', icon: Target, label: 'Campanhas', id: 'sidebar-campanhas' },
  ]

  /* ═══════════════════════════════════════
     OPERAÇÃO
     CRM de leads, funil de vendas, métricas de desempenho
     ═══════════════════════════════════════ */
  const operationNav: NavItem[] = [
    { href: '/leads', icon: Users, label: 'Leads', id: 'sidebar-leads' },
    { href: '/pipeline', icon: Filter, label: 'Funil de Vendas', id: 'sidebar-funil' },
    { href: '/analytics', icon: BarChart3, label: 'Desempenho', id: 'sidebar-desempenho' },
  ]

  /* ═══════════════════════════════════════
     CONEXÕES (dropdown)
     Canais por onde a IA conversa com os leads
     ═══════════════════════════════════════ */
  const navGroups: NavGroup[] = [
    {
      label: 'Conexões', icon: Globe, defaultOpen: false,
      items: [
        { href: '/channels/whatsapp', icon: Phone, label: 'WhatsApp' },
        { href: '/channels/email', icon: Mail, label: 'E-mail' },
        { href: '/channels/sms', icon: Smartphone, label: 'SMS' },
      ]
    },
  ]

  /* ═══════════════════════════════════════
     CONFIGURAR
     Assistente IA, webhooks para capturar leads, conta
     ═══════════════════════════════════════ */
  const configNav: NavItem[] = [
    { href: '/ai-config', icon: Brain, label: 'Assistente IA', id: 'sidebar-assistente' },
    { href: '/webhooks', icon: Webhook, label: 'Webhooks & API', id: 'sidebar-webhooks' },
    { href: '/settings', icon: Settings, label: 'Conta', id: 'sidebar-conta' },
  ]

  function isItemActive(href: string) {
    if (href === '/') return pathname === '/' || pathname === ''
    return pathname === href || pathname?.startsWith(href + '/')
  }

  useEffect(() => {
    const newExp: Record<string, boolean> = {}
    navGroups.forEach(g => {
      if (g.items.some(i => isItemActive(i.href))) newExp[g.label] = true
    })
    setExpandedGroups(prev => ({ ...prev, ...newExp }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <div className="h-full flex flex-col bg-card transition-all duration-300 font-dm-sans">

      {/* ═══════════════════════════════════
          LOGO
          Coloque sua logo em /public/logo.png
          ═══════════════════════════════════ */}
      <div className={cn("h-14 flex items-center border-b border-border px-4 shrink-0", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed ? (
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 transition-transform group-hover:scale-105">
              <Image
                src="/logo.png"
                alt="Marketing Digital AI"
                width={28}
                height={28}
                className="rounded-lg object-contain"
              />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-bold text-foreground tracking-tight">Marketing Digital AI</span>
              <span className="text-[9px] font-medium text-[#909091]">Vendas por Inteligência Artificial</span>
            </div>
          </Link>
        ) : (
          <Link href="/">
            <div className="w-7 h-7 rounded-lg overflow-hidden hover:scale-105 transition-transform">
              <Image src="/logo.png" alt="MDAI" width={28} height={28} className="rounded-lg object-contain" />
            </div>
          </Link>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center text-[#909091] hover:text-foreground hover:bg-muted/60 transition-all cursor-pointer",
            isCollapsed && "absolute -right-3 top-5 bg-card border border-border shadow-sm z-50 rounded-full"
          )}
        >
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ═══ NAV ═══ */}
      <nav className="flex-1 py-3 px-2.5 overflow-y-auto scrollbar-hide">

        {/* Principal */}
        <div className="space-y-0.5">
          {topNav.map(item => (
            <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />
          ))}
        </div>

        {/* ── Operação ── */}
        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">Operação</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}

        <div className="space-y-0.5">
          {operationNav.map(item => (
            <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />
          ))}
        </div>

        {/* ── Canais (dropdown) ── */}
        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">Canais</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}

        {navGroups.map(group => {
          const isOpen = expandedGroups[group.label] ?? group.defaultOpen ?? false
          const hasActive = group.items.some(i => isItemActive(i.href))
          const GIcon = group.icon
          return (
            <div key={group.label} className="mb-0.5">
              {!isCollapsed ? (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all font-dm-sans cursor-pointer",
                    hasActive ? "text-foreground" : "text-[#909091] hover:text-foreground hover:bg-muted/20"
                  )}
                >
                  <GIcon className="w-4 h-4 shrink-0 opacity-70" />
                  <span className="flex-1 text-left truncate">{group.label}</span>
                  <ChevronDown className={cn("w-3 h-3 opacity-40 transition-transform duration-200", isOpen && "rotate-180")} />
                </button>
              ) : (
                <div className="my-2 mx-2 h-px bg-border/30" />
              )}
              <div className={cn("overflow-hidden transition-all duration-200", isOpen || isCollapsed ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0")}>
                <div className={cn("space-y-0.5", !isCollapsed && "ml-3 pl-3 border-l border-border/30 mt-0.5")}>
                  {group.items.map(item => (
                    <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} indent />
                  ))}
                </div>
              </div>
            </div>
          )
        })}

        {/* ── Configurar ── */}
        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">Configurar</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}

        <div className="space-y-0.5">
          {configNav.map(item => (
            <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />
          ))}
        </div>
      </nav>

      {/* ═══ FOOTER ═══ */}
      <div className="p-2 border-t border-border shrink-0">
        <div className={cn("flex items-center gap-1", isCollapsed ? "flex-col" : "justify-between px-1")}>
          {mounted && (
            <button onClick={cycleTheme} className="h-8 w-8 rounded-md flex items-center justify-center text-[#909091] hover:text-foreground hover:bg-muted/50 transition-all cursor-pointer">
              {theme === 'light' && <Sun className="w-3.5 h-3.5" />}
              {theme === 'purple' && <Laptop className="w-3.5 h-3.5" />}
              {theme === 'dark' && <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
          <div className={cn("h-3.5 w-px bg-border/30", isCollapsed && "w-3.5 h-px")} />
          <button className={cn("h-8 rounded-md flex items-center justify-center gap-1.5 hover:bg-muted/50 transition-all cursor-pointer", isCollapsed ? "w-8" : "px-2")}>
            <span className="text-sm leading-none">🇧🇷</span>
            {!isCollapsed && <span className="text-[10px] font-bold text-[#909091]">PT</span>}
          </button>
          <div className={cn("h-3.5 w-px bg-border/30", isCollapsed && "w-3.5 h-px")} />
          <button
            onClick={() => router.push('/login')}
            className="h-8 w-8 rounded-md flex items-center justify-center text-[#909091] hover:text-rose-500 hover:bg-rose-500/5 transition-all cursor-pointer"
            title="Sair"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function SidebarNavLink({ item, isCollapsed, isActive, indent }: { item: NavItem; isCollapsed: boolean; isActive: boolean; indent?: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      id={item.id}
      className={cn(
        "flex items-center gap-2.5 px-3 py-[7px] rounded-lg transition-all text-[13px] font-medium group relative font-dm-sans",
        isCollapsed && "justify-center px-2",
        indent && !isCollapsed && "py-[6px] text-[12px]",
        isActive
          ? "bg-white text-black font-semibold shadow-sm"
          : "text-[#909091] hover:text-foreground hover:bg-muted/30"
      )}
      title={isCollapsed ? item.label : undefined}
    >
      <Icon
        className={cn(
          "w-[18px] h-[18px] shrink-0 transition-colors",
          isActive ? "text-black" : "opacity-60 group-hover:opacity-100",
          indent && !isCollapsed && "w-[15px] h-[15px]"
        )}
      />
      {!isCollapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span className={cn(
              "text-[9px] font-semibold px-1.5 py-0.5 rounded",
              isActive ? "text-black/50 bg-black/5" : "text-[#909091]/60 bg-muted/40"
            )}>
              {item.badge}
            </span>
          )}
        </>
      )}
    </Link>
  )
}