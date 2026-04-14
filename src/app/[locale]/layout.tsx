// src/app/[locale]/layout.tsx
import React from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { routing } from '@/i18n/routing'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!routing.locales.includes(locale as any)) notFound()
  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        themes={['light', 'dark', 'purple']}
        enableSystem
        disableTransitionOnChange
      >
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          toastOptions={{
            style: {
              background: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--foreground))',
              fontSize: '13px',
            },
          }}
        />
      </ThemeProvider>
    </NextIntlClientProvider>
  )
}