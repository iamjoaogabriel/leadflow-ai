// src/components/layout/sidebar.tsx
'use client'

import { useState, useEffect } from 'react'
import { Link, usePathname, useRouter } from '@/i18n/routing'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import {
  LayoutDashboard, Brain, Settings,
  ChevronLeft, ChevronRight, ChevronDown, LogOut,
  Sun, Moon, Laptop, Users,
  Target, Phone, Mail, Smartphone,
  Globe, Filter, Headphones, Shield,
} from 'lucide-react'
import { useTheme } from 'next-themes'

interface SidebarProps { isCollapsed: boolean; onToggle: () => void }
interface NavItem { href: string; icon: any; label: string; id?: string }
interface NavGroup { label: string; icon: any; items: NavItem[]; defaultOpen?: boolean }

const LOCALES = [
  { code: 'pt' as const, flag: '🇧🇷', label: 'PT', name: 'Português' },
  { code: 'en' as const, flag: '🇺🇸', label: 'EN', name: 'English' },
  { code: 'es' as const, flag: '🇪🇸', label: 'ES', name: 'Español' },
]

export function Sidebar({ isCollapsed, onToggle }: SidebarProps) {
  const t = useTranslations('sidebar')
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [platformRole, setPlatformRole] = useState<'USER' | 'SUPER_ADMIN' | 'HIPER_ADMIN'>('USER')
  const isAdminish = platformRole === 'SUPER_ADMIN' || platformRole === 'HIPER_ADMIN'

  useEffect(() => { setMounted(true) }, [])

  // Read the current session once — it already includes platformRole.
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => (r.ok ? r.json() : null))
      .then((s: { platformRole?: 'USER' | 'SUPER_ADMIN' | 'HIPER_ADMIN' } | null) => {
        if (s?.platformRole) setPlatformRole(s.platformRole)
      })
      .catch(() => {})
  }, [])

  function cycleTheme() {
    const current = theme || 'dark'
    if (current === 'light') setTheme('purple')
    else if (current === 'purple') setTheme('dark')
    else setTheme('light')
  }

  function switchLocale(newLocale: 'pt' | 'en' | 'es') {
    router.replace(pathname, { locale: newLocale })
    setShowLangMenu(false)
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const currentLocale = LOCALES.find(l => l.code === locale) || LOCALES[0]

  const topNav: NavItem[] = [
    { href: '/', icon: LayoutDashboard, label: t('dashboard'), id: 'sidebar-painel' },
    { href: '/conversations', icon: Headphones, label: t('conversations'), id: 'sidebar-atendimentos' },
    { href: '/campaigns', icon: Target, label: t('campaigns'), id: 'sidebar-campanhas' },
  ]

  const operationNav: NavItem[] = [
    { href: '/leads', icon: Users, label: 'Leads', id: 'sidebar-leads' },
    { href: '/pipeline', icon: Filter, label: t('pipeline'), id: 'sidebar-funil' },
  ]

  const navGroups: NavGroup[] = [
    {
      label: t('connections'), icon: Globe, defaultOpen: false,
      items: [
        { href: '/channels/whatsapp', icon: Phone, label: 'WhatsApp' },
        { href: '/channels/email', icon: Mail, label: 'E-mail' },
        { href: '/channels/sms', icon: Smartphone, label: 'SMS' },
      ]
    },
  ]

  const configNav: NavItem[] = [
    { href: '/ai-config', icon: Brain, label: t('aiAssistant'), id: 'sidebar-assistente' },
    { href: '/settings', icon: Settings, label: t('account'), id: 'sidebar-conta' },
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
      {/* ═══ LOGO ═══ */}
      <div className={cn("h-14 flex items-center border-b border-border px-4 shrink-0", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed ? (
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 transition-transform group-hover:scale-105">
              <Image src="/logo.png" alt="Marketing Digital AI" width={28} height={28} className="rounded-lg object-contain" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[13px] font-bold text-foreground tracking-tight">Marketing Digital AI</span>
              <span className="text-[9px] font-medium text-[#909091]">{t('tagline')}</span>
            </div>
          </Link>
        ) : (
          <Link href="/">
            <div className="w-7 h-7 rounded-lg overflow-hidden hover:scale-105 transition-transform">
              <Image src="/logo.png" alt="MDAI" width={28} height={28} className="rounded-lg object-contain" />
            </div>
          </Link>
        )}
        <button onClick={onToggle}
          className={cn("w-6 h-6 rounded-md flex items-center justify-center text-[#909091] hover:text-foreground hover:bg-muted/60 transition-all cursor-pointer",
            isCollapsed && "absolute -right-3 top-5 bg-card border border-border shadow-sm z-50 rounded-full"
          )}>
          {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* ═══ NAV ═══ */}
      <nav className="flex-1 py-3 px-2.5 overflow-y-auto scrollbar-hide">
        <div className="space-y-0.5">
          {topNav.map(item => <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />)}
        </div>

        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">{t('sectionOperation')}</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}
        <div className="space-y-0.5">
          {operationNav.map(item => <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />)}
        </div>

        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">{t('sectionChannels')}</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}
        {navGroups.map(group => {
          const isOpen = expandedGroups[group.label] ?? group.defaultOpen ?? false
          const hasActive = group.items.some(i => isItemActive(i.href))
          const GIcon = group.icon
          return (
            <div key={group.label} className="mb-0.5">
              {!isCollapsed ? (
                <button onClick={() => toggleGroup(group.label)}
                  className={cn("w-full flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition-all font-dm-sans cursor-pointer",
                    hasActive ? "text-foreground" : "text-[#909091] hover:text-foreground hover:bg-muted/20"
                  )}>
                  <GIcon className="w-4 h-4 shrink-0 opacity-70" />
                  <span className="flex-1 text-left truncate">{group.label}</span>
                  <ChevronDown className={cn("w-3 h-3 opacity-40 transition-transform duration-200", isOpen && "rotate-180")} />
                </button>
              ) : <div className="my-2 mx-2 h-px bg-border/30" />}
              <div className={cn("overflow-hidden transition-all duration-200", isOpen || isCollapsed ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0")}>
                <div className={cn("space-y-0.5", !isCollapsed && "ml-3 pl-3 border-l border-border/30 mt-0.5")}>
                  {group.items.map(item => <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} indent />)}
                </div>
              </div>
            </div>
          )
        })}

        {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-[#909091]/50 uppercase tracking-[0.12em]">{t('sectionSettings')}</span></div>}
        {isCollapsed && <div className="my-3 mx-2 h-px bg-border/30" />}
        <div className="space-y-0.5">
          {configNav.map(item => <SidebarNavLink key={item.href} item={item} isCollapsed={isCollapsed} isActive={isItemActive(item.href)} />)}
        </div>

        {/* ═══ ADMIN (super admin / hiper admin) ═══ */}
        {isAdminish && (
          <>
            {!isCollapsed && <div className="mt-5 mb-1.5 px-3"><span className="text-[10px] font-bold text-red-400/60 uppercase tracking-[0.12em]">{t('sectionAdmin')}</span></div>}
            {isCollapsed && <div className="my-3 mx-2 h-px bg-red-500/20" />}
            <div className="space-y-0.5">
              <SidebarNavLink item={{ href: '/admin', icon: Shield, label: t('adminPanel'), id: 'sidebar-admin' }} isCollapsed={isCollapsed} isActive={isItemActive('/admin')} admin />
            </div>
          </>
        )}
      </nav>

      {/* ═══ FOOTER ═══ */}
      <div className="p-2 border-t border-border shrink-0">
        <div className={cn("flex items-center gap-1", isCollapsed ? "flex-col" : "justify-between px-1")}>
          {mounted && (
            <button onClick={cycleTheme} title={theme || 'dark'}
              className="h-8 w-8 rounded-md flex items-center justify-center text-[#909091] hover:text-foreground hover:bg-muted/50 transition-all cursor-pointer">
              {theme === 'light' && <Sun className="w-3.5 h-3.5" />}
              {theme === 'purple' && <Laptop className="w-3.5 h-3.5" />}
              {(theme === 'dark' || (!theme)) && <Moon className="w-3.5 h-3.5" />}
            </button>
          )}
          <div className={cn("h-3.5 w-px bg-border/30", isCollapsed && "w-3.5 h-px")} />
          <div className="relative">
            <button onClick={() => setShowLangMenu(!showLangMenu)}
              className={cn("h-8 rounded-md flex items-center justify-center gap-1.5 hover:bg-muted/50 transition-all cursor-pointer", isCollapsed ? "w-8" : "px-2")}>
              <span className="text-sm leading-none">{currentLocale.flag}</span>
              {!isCollapsed && <span className="text-[10px] font-bold text-[#909091]">{currentLocale.label}</span>}
            </button>
            {showLangMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                <div className={cn("absolute z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[120px]",
                  isCollapsed ? "left-full ml-2 bottom-0" : "bottom-full mb-2 left-0"
                )}>
                  {LOCALES.map(loc => (
                    <button key={loc.code} onClick={() => switchLocale(loc.code)}
                      className={cn("w-full flex items-center gap-2 px-3 py-2 text-[12px] font-medium transition-colors cursor-pointer",
                        locale === loc.code ? "text-foreground bg-muted" : "text-[#909091] hover:text-foreground hover:bg-muted/50"
                      )}>
                      <span className="text-sm">{loc.flag}</span><span>{loc.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className={cn("h-3.5 w-px bg-border/30", isCollapsed && "w-3.5 h-px")} />
          <button onClick={() => { window.location.href = '/login' }}
            className="h-8 w-8 rounded-md flex items-center justify-center text-[#909091] hover:text-rose-500 hover:bg-rose-500/5 transition-all cursor-pointer"
            title={t('signOut')}>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

function SidebarNavLink({ item, isCollapsed, isActive, indent, admin }: { item: NavItem; isCollapsed: boolean; isActive: boolean; indent?: boolean; admin?: boolean }) {
  const Icon = item.icon
  return (
    <Link href={item.href} id={item.id}
      className={cn(
        "flex items-center gap-2.5 px-3 py-[7px] rounded-lg transition-all text-[13px] font-medium group relative font-dm-sans",
        isCollapsed && "justify-center px-2",
        indent && !isCollapsed && "py-[6px] text-[12px]",
        isActive
          ? admin ? "bg-red-500/10 text-red-400 font-semibold border border-red-500/20" : "bg-white text-black font-semibold shadow-sm"
          : admin ? "text-red-400/60 hover:text-red-400 hover:bg-red-500/5" : "text-[#909091] hover:text-foreground hover:bg-muted/30"
      )}
      title={isCollapsed ? item.label : undefined}>
      <Icon className={cn("w-[18px] h-[18px] shrink-0 transition-colors",
        isActive ? admin ? "text-red-400" : "text-black" : "opacity-60 group-hover:opacity-100",
        indent && !isCollapsed && "w-[15px] h-[15px]"
      )} />
      {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
    </Link>
  )
}