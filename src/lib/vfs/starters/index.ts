import type { StackKind } from '../db';
import { nextjsStarter } from './nextjs';
import { reactStarter } from './react';
import { htmlStarter } from './html';
import { pythonStarter } from './python';
import { blankStarter } from './blank';

export interface StarterOption {
  id: StackKind;
  label: string;
  shortLabel: string;
  description: string;
  defaultFile: string;
}

export const STARTER_OPTIONS: StarterOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    shortLabel: 'Auto',
    description: 'Kalpa Agent picks the lightest stack for your idea',
    defaultFile: 'README.md',
  },
  {
    id: 'next',
    label: 'Next.js landing page',
    shortLabel: 'Next.js',
    description: 'App Router pages, layouts, and Tailwind via Next-Lite',
    defaultFile: 'app/page.tsx',
  },
  {
    id: 'react',
    label: 'React app',
    shortLabel: 'React',
    description: 'React 18 + TypeScript + Tailwind in Sandpack',
    defaultFile: 'src/App.tsx',
  },
  {
    id: 'html',
    label: 'HTML/CSS/JS site',
    shortLabel: 'HTML',
    description: 'Zero-bundler static site with instant reload',
    defaultFile: 'index.html',
  },
  {
    id: 'python',
    label: 'Python script',
    shortLabel: 'Python',
    description: 'Runs in browser WebAssembly via Pyodide',
    defaultFile: 'main.py',
  },
  {
    id: 'blank',
    label: 'Blank',
    shortLabel: 'Blank',
    description: 'Clean empty project with README.md',
    defaultFile: 'README.md',
  },
];

export function getStarterFiles(stack: StackKind): Record<string, string> {
  switch (stack) {
    case 'next':
      return { ...nextjsStarter };
    case 'react':
      return { ...reactStarter };
    case 'html':
      return { ...htmlStarter };
    case 'python':
      return { ...pythonStarter };
    case 'auto':
    case 'blank':
    default:
      return { ...blankStarter };
  }
}

export function getDefaultOpenFile(stack: StackKind, paths: string[]): string | null {
  const opt = STARTER_OPTIONS.find((s) => s.id === stack);
  if (opt && paths.includes(opt.defaultFile)) return opt.defaultFile;
  const preferred = [
    'app/page.tsx',
    'src/App.tsx',
    'index.html',
    'main.py',
    'README.md',
  ];
  for (const p of preferred) {
    if (paths.includes(p)) return p;
  }
  return paths[0] ?? null;
}
