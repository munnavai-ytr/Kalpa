export const nextjsStarter: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'kalpa-nextjs-starter',
      version: '0.1.0',
      private: true,
      dependencies: {
        next: '15.0.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.460.0',
      },
    },
    null,
    2
  ),
  'tailwind.config.js': `module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#7C5CFF',
      },
    },
  },
  plugins: [],
};
`,
  'app/globals.css': `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  background-color: #0b0b14;
  color: #f4f4fa;
  font-family: system-ui, -apple-system, sans-serif;
}
`,
  'app/layout.tsx': `import React from 'react';
import Link from 'next/link';
import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0b0b14] text-slate-100 antialiased">
        <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
          <Link href="/" className="font-semibold text-lg tracking-tight text-white">
            PulseNote
          </Link>
          <nav className="flex items-center gap-6 text-sm text-slate-300">
            <Link href="/" className="hover:text-white transition-colors">
              Product
            </Link>
            <Link href="/pricing" className="hover:text-white transition-colors">
              Pricing
            </Link>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-12">{children}</main>
      </body>
    </html>
  );
}
`,
  'app/page.tsx': `'use client';

import React, { useState } from 'react';
import Link from 'next/link';

const FEATURES = [
  { id: 'capture', title: 'Instant Capture', detail: 'Write structured meeting notes with keyboard-first shortcuts and instant search.' },
  { id: 'sync', title: 'Offline First', detail: 'Every document stays available locally and syncs automatically when reconnected.' },
  { id: 'share', title: 'Clean Publishing', detail: 'Turn any note into a fast, readable web page with one click.' },
];

export default function HomePage() {
  const [active, setActive] = useState('capture');
  const current = FEATURES.find((f) => f.id === active) ?? FEATURES[0];

  return (
    <div className="space-y-12">
      <section className="space-y-5 max-w-2xl">
        <p className="text-xs font-medium text-indigo-400">Next.js App Router Starter</p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white leading-tight">
          Calm, structured notes for fast-moving engineering teams.
        </h1>
        <p className="text-base text-slate-400 leading-relaxed">
          Edit files in Kalpa to customize routes, layouts, and Tailwind styles with live Instant preview.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/pricing"
            className="px-5 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium transition-colors"
          >
            View Plans
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={\`px-3.5 py-2 rounded-lg text-xs font-medium transition-colors \${
                active === f.id ? 'bg-indigo-500 text-white' : 'bg-white/5 text-slate-300 hover:text-white'
              }\`}
            >
              {f.title}
            </button>
          ))}
        </div>
        <p className="text-sm text-slate-300 leading-relaxed">{current.detail}</p>
      </section>
    </div>
  );
}
`,
  'app/pricing/page.tsx': `import React from 'react';
import Link from 'next/link';

export default function PricingPage() {
  const plans = [
    { name: 'Starter', price: '$0', desc: 'For solo makers and personal notes.' },
    { name: 'Team', price: '$12', desc: 'Shared workspaces and unlimited history.' },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-white">Simple pricing</h1>
        <p className="text-sm text-slate-400">Transparent plans with no hidden seats.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {plans.map((p) => (
          <div key={p.name} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-2">
            <h2 className="text-lg font-semibold text-white">{p.name}</h2>
            <p className="text-3xl font-bold text-indigo-400">{p.price}<span className="text-sm text-slate-400 font-normal">/mo</span></p>
            <p className="text-sm text-slate-400">{p.desc}</p>
          </div>
        ))}
      </div>
      <Link href="/" className="inline-block text-sm text-indigo-400 hover:underline">
        ← Back to overview
      </Link>
    </div>
  );
}
`,
};
