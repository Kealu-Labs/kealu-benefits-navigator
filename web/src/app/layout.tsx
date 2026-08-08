//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Root layout — server component shared by every page in the app.
 *
 * Sets the document language, applies the Inter font globally, and configures
 * Next.js metadata (title/description). Security headers (X-Frame-Options, CSP)
 * are set in next.config.ts via the `headers()` function rather than here, so
 * they apply to all responses including API routes.
 *
 * suppressHydrationWarning on <html> silences the expected React hydration
 * mismatch: the server always renders lang="en" but the client updates it to
 * the detected locale (via LanguageProvider → useEffect) after hydration.
 */

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { LanguageProvider } from '@/contexts/language-context';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Benefits Navigator',
  description:
    'Find health coverage and benefit programs for your household —-no account required.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.className}>
      <body className="bg-slate-950 min-h-screen antialiased">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
