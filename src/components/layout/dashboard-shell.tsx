// src/components/layout/dashboard-shell.tsx
'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import Image from 'next/image'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { cn } from '@/lib/utils'

const FULL_BLEED_ROUTES = ['/conversations', '/campaigns/new']

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const isFullBleed = FULL_BLEED_ROUTES.some(r => pathname?.includes(r))

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={cn(
        "fixed lg:static inset-y-0 left-0 z-50 bg-card border-r border-border transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-[260px]",
        mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <Sidebar isCollapsed={collapsed} onToggle={() => { setCollapsed(!collapsed); setMobileOpen(false) }} />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop header */}
        <div className="hidden lg:block shrink-0">
          <Header />
        </div>
        {/* Mobile header */}
        <div className="lg:hidden shrink-0 flex items-center justify-between gap-3 px-4 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg cursor-pointer">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg overflow-hidden">
                <Image src="/logo.png" alt="MDAI" width={28} height={28} className="rounded-lg object-contain" />
              </div>
              <span className="text-sm font-bold text-foreground tracking-tight">Marketing Digital AI</span>
            </div>
          </div>
          <Header />
        </div>

        {/* Content: full-bleed = children direto, normal = com padding e scroll */}
        {isFullBleed ? children : (
          <main className="flex-1 overflow-y-auto">
            <div className="p-4 md:p-6 lg:p-8 max-w-[1920px] mx-auto w-full">{children}</div>
          </main>
        )}
      </div>
    </div>
  )
}