import type { Metadata, Viewport } from 'next';
import './globals.css';
import { APP_NAME, TAGLINE } from '@/lib/brand';
import { BootLoader } from '@/components/brand/BootLoader';
import { ToastViewport } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: `${APP_NAME} — ${TAGLINE}`,
  description:
    'Imagine it. Kalpa builds it. A mobile-first, bring-your-own-key AI app builder and browser IDE.',
  openGraph: {
    title: `${APP_NAME} — ${TAGLINE}`,
    description:
      'Imagine it. Kalpa builds it. A mobile-first, bring-your-own-key AI app builder and browser IDE.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} — ${TAGLINE}`,
    description:
      'Imagine it. Kalpa builds it. A mobile-first, bring-your-own-key AI app builder and browser IDE.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08080F' },
    { media: '(prefers-color-scheme: light)', color: '#F7F7FB' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-kalpa-bg text-kalpa-text antialiased" suppressHydrationWarning>
        <BootLoader>{children}</BootLoader>
        <ToastViewport />
      </body>
    </html>
  );
}
