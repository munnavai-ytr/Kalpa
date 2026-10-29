import { detectProjectType, type Detection, type ProjectType } from '@/lib/agent/reliability';

export type ExtendedStackType =
  | ProjectType
  | 'vue'
  | 'svelte'
  | 'solid'
  | 'angular';

export interface ExtendedDetection extends Omit<Detection, 'type'> {
  type: ExtendedStackType;
}

export type ChosenPreviewEngine =
  | 'instant'
  | 'next-lite'
  | 'python'
  | 'node-script'
  | 'cloud'
  | 'needs-cloud'
  | 'empty';

function parsePkg(pkgRaw?: string): {
  deps: Record<string, string>;
  scripts: Record<string, string>;
} {
  if (!pkgRaw) return { deps: {}, scripts: {} };
  try {
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      deps: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
      scripts: { ...(pkg.scripts ?? {}) },
    };
  } catch {
    return { deps: {}, scripts: {} };
  }
}

export function detectExtendedStack(files: Record<string, string>): ExtendedDetection {
  const base = detectProjectType(files);
  if (base.type !== 'cloud-only') {
    return base;
  }

  // Upgrade client-only Vue / Svelte / Solid / Angular SPAs from cloud-only to Instant Sandpack templates (B4)
  const { deps } = parsePkg(files['package.json']);
  const serverFramework = ['nuxt', '@sveltejs/kit', 'astro', '@remix-run/node'].some(
    (d) => d in deps
  );
  const serverDb = [
    'prisma',
    '@prisma/client',
    'better-sqlite3',
    'sqlite3',
    'pg',
    'mysql2',
    'mongoose',
    'express',
    'fastify',
  ].some((d) => d in deps);

  if (!serverFramework && !serverDb) {
    if ('vue' in deps) {
      return { type: 'vue', reason: 'Vue client SPA (runs in Instant Sandpack)', entry: 'src/App.vue' };
    }
    if ('svelte' in deps) {
      return { type: 'svelte', reason: 'Svelte client SPA (runs in Instant Sandpack)', entry: 'src/App.svelte' };
    }
    if ('solid-js' in deps) {
      return { type: 'solid', reason: 'SolidJS client SPA (runs in Instant Sandpack)', entry: 'src/App.tsx' };
    }
    if ('@angular/core' in deps) {
      return { type: 'angular', reason: 'Angular client SPA (runs in Instant Sandpack)', entry: 'src/main.ts' };
    }
  }

  return base;
}

export function chooseEngine(opts: {
  detection: ExtendedDetection;
  files: Record<string, string>;
  cloudConnected: boolean;
  userSwitchedToCloud: boolean;
}): ChosenPreviewEngine {
  const { detection, files, cloudConnected, userSwitchedToCloud } = opts;
  const { scripts } = parsePkg(files['package.json']);
  const hasDevScript = Boolean(scripts.dev);

  switch (detection.type) {
    case 'react':
    case 'vue':
    case 'svelte':
    case 'solid':
    case 'angular':
    case 'static':
      if (cloudConnected && hasDevScript && userSwitchedToCloud) {
        return 'cloud';
      }
      return 'instant';

    case 'next-lite':
      return cloudConnected ? 'cloud' : 'next-lite';

    case 'python':
      if (cloudConnected && userSwitchedToCloud && hasDevScript) {
        return 'cloud';
      }
      return 'python';

    case 'node-script':
      return cloudConnected && userSwitchedToCloud ? 'cloud' : 'node-script';

    case 'cloud-only':
      return cloudConnected ? 'cloud' : 'needs-cloud';

    case 'empty':
      return cloudConnected && userSwitchedToCloud ? 'cloud' : 'empty';
  }
}
