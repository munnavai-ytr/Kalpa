import { isBrainPath } from '@/lib/brain/caps';

export type DetectedProjectType =
  | 'next'
  | 'react'
  | 'vue'
  | 'svelte'
  | 'solid'
  | 'angular'
  | 'static'
  | 'python'
  | 'js'
  | 'unknown';

export function detectProjectType(files: Record<string, string>): DetectedProjectType {
  const paths = Object.keys(files).filter((p) => !p.endsWith('/.gitkeep') && !isBrainPath(p));
  if (paths.length === 0) return 'unknown';

  let deps: Record<string, string> = {};
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']);
      deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    } catch {
      // ignore invalid package.json while user is typing
    }
  }

  const hasAppRouterPage = paths.some((p) =>
    /^(src\/)?app\/(.*\/)?page\.(tsx|ts|jsx|js)$/.test(p)
  );
  const hasPagesRouter = paths.some((p) =>
    /^(src\/)?pages\/.*\.(tsx|ts|jsx|js)$/.test(p)
  );
  if (deps.next || hasAppRouterPage || hasPagesRouter) {
    return 'next';
  }

  if (deps['@angular/core']) return 'angular';
  if (deps['solid-js']) return 'solid';
  if (deps.svelte || paths.some((p) => p.endsWith('.svelte'))) return 'svelte';
  if (deps.vue || paths.some((p) => p.endsWith('.vue'))) return 'vue';

  if (
    deps.react ||
    paths.some((p) => /\.(tsx|jsx)$/.test(p))
  ) {
    return 'react';
  }

  if (paths.includes('index.html') || paths.includes('public/index.html')) {
    return 'static';
  }

  if (paths.some((p) => p.endsWith('.py'))) {
    return 'python';
  }

  if (paths.some((p) => /\.(js|mjs|cjs)$/.test(p))) {
    return 'js';
  }

  return 'unknown';
}
