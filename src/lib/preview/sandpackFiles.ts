import type { SandpackPredefinedTemplate } from '@codesandbox/sandpack-react';
import { filesHash, fnv1a, rewriteForSandpack } from '@/lib/agent/reliability';
import { filterOutBrainFiles } from '@/lib/brain/caps';
import { processTailwindForSandpack } from './tailwindInject';
import { analyzeNextLiteProject, type UnsupportedNextFeature } from './nextLite/routes';
import { buildNextLiteShimFiles } from './nextLite/shims';
import { buildNextLiteEntryCode } from './nextLite/entry';

export interface SandpackBundleSpec {
  template: SandpackPredefinedTemplate;
  files: Record<string, string>;
  entryFile: string;
  structuralHash: string;
  expectedFilesHash: string;
  hasTailwindV4Warning: boolean;
  unsupportedNextFeatures: UnsupportedNextFeature[];
}

function rewriteNextLiteDirectives(code: string, filePath: string, isNextLite: boolean): string {
  let out = code.replace(/^\s*['"]use (client|server)['"]\s*;?\s*$/gm, '');
  if (!isNextLite) return out;

  const shimMap: Record<string, string> = {
    'next/link': '/__kalpa/shims/link',
    'next/navigation': '/__kalpa/shims/navigation',
    'next/router': '/__kalpa/shims/navigation',
    'next/image': '/__kalpa/shims/image',
    'next/head': '/__kalpa/shims/head',
    'next/script': '/__kalpa/shims/script',
    'next/font/google': '/__kalpa/shims/font-google',
    'next/font/local': '/__kalpa/shims/font-local',
    'next/dynamic': '/__kalpa/shims/dynamic',
  };
  for (const [pkg, shim] of Object.entries(shimMap)) {
    const escaped = pkg.replace(/\//g, '\\/');
    out = out.replace(new RegExp(`(['"])${escaped}(['"])`, 'g'), `$1${shim}$2`);
  }

  if (/layout\.(tsx|ts|jsx|js)$/.test(filePath)) {
    out = out
      .replace(/<html\b([^>]*)>/gi, '<div data-kalpa-html$1>')
      .replace(/<\/html>/gi, '</div>')
      .replace(/<body\b([^>]*)>/gi, '<div data-kalpa-body$1>')
      .replace(/<\/body>/gi, '</div>');
  }
  return out;
}

function findExistingReactMount(paths: string[]): string | null {
  const candidates = [
    'src/main.tsx',
    'src/index.tsx',
    'src/main.jsx',
    'src/index.jsx',
    'src/main.ts',
    'src/index.js',
    'index.tsx',
    'index.jsx',
    'main.tsx',
    'main.jsx',
    'index.js',
  ];
  for (const c of candidates) {
    if (paths.includes(c)) return `/${c}`;
  }
  return null;
}

function findReactAppComponent(paths: string[]): string | null {
  const preferred = ['src/App.tsx', 'src/App.jsx', 'App.tsx', 'App.jsx'];
  for (const p of preferred) {
    if (paths.includes(p)) return p;
  }
  return paths.find((p) => /\.(tsx|jsx)$/.test(p)) ?? null;
}

function synthesizeReactEntry(appPath: string, cssPaths: string[]): string {
  const cleanApp = appPath.replace(/\.(tsx?|jsx?)$/, '');
  const cssImports = cssPaths.map((c) => `import '/${c}';`).join('\n');
  return `import React from 'react';
import { createRoot } from 'react-dom/client';
${cssImports}
import * as AppModule from '/${cleanApp}';

const ResolvedApp =
  (AppModule as { default?: React.ComponentType; App?: React.ComponentType }).default ||
  (AppModule as { App?: React.ComponentType }).App ||
  (Object.values(AppModule).find((v) => typeof v === 'function') as React.ComponentType | undefined);

const container = document.getElementById('root') || document.body.appendChild(document.createElement('div'));
if (!container.id) container.id = 'root';

if (ResolvedApp) {
  createRoot(container).render(React.createElement(ResolvedApp));
}
`;
}

export function buildSandpackBundle(
  projectType: 'react' | 'next-lite',
  rawSnapshotWithBrain: Record<string, string>
): SandpackBundleSpec {
  const rawSnapshot = filterOutBrainFiles(rawSnapshotWithBrain);
  const expectedFilesHash = filesHash(rawSnapshot);
  const tw = processTailwindForSandpack(rawSnapshot);
  const aliasRewritten = rewriteForSandpack(tw.cleanedFiles);

  const allPaths = Object.keys(aliasRewritten).filter((p) => !p.endsWith('/.gitkeep'));
  const hasTs = allPaths.some((p) => /\.(ts|tsx)$/.test(p));
  const isNextLite = projectType === 'next-lite';
  const nextAnalysis = isNextLite ? analyzeNextLiteProject(aliasRewritten) : null;

  const template: SandpackPredefinedTemplate = isNextLite || hasTs ? 'react-ts' : 'react';
  const spFiles: Record<string, string> = {};

  for (const [path, content] of Object.entries(aliasRewritten)) {
    if (
      path.endsWith('/.gitkeep') ||
      path === 'package.json' ||
      path === 'index.html' ||
      path === 'public/index.html' ||
      /^vite\.config\./.test(path)
    ) {
      continue;
    }
    if (isNextLite && /^(src\/)?app\/api\//.test(path)) continue;
    const transformed = /\.(tsx?|jsx?)$/.test(path)
      ? rewriteNextLiteDirectives(content, path, isNextLite)
      : content;
    spFiles[`/${path}`] = transformed;
  }

  let userDeps: Record<string, string> = {};
  if (rawSnapshot['package.json']) {
    try {
      const parsed = JSON.parse(rawSnapshot['package.json']) as {
        dependencies?: Record<string, string>;
      };
      userDeps = { ...(parsed.dependencies ?? {}) };
    } catch {
      // ignore malformed JSON while user or agent edits
    }
  }

  userDeps.react = userDeps.react || '^18.3.1';
  userDeps['react-dom'] = userDeps['react-dom'] || '^18.3.1';

  let entryFile = '/index.tsx';

  if (isNextLite && nextAnalysis) {
    delete userDeps.next;
    Object.assign(spFiles, buildNextLiteShimFiles());
    spFiles['/__kalpa/entry.tsx'] = buildNextLiteEntryCode(nextAnalysis);
    entryFile = '/__kalpa/entry.tsx';
  } else {
    const existingMount = findExistingReactMount(allPaths);
    if (existingMount) {
      entryFile = existingMount;
    } else {
      const appComp = findReactAppComponent(allPaths);
      const cssPaths = allPaths.filter((p) => p.endsWith('.css')).slice(0, 3);
      if (appComp) {
        spFiles['/__kalpa/react-entry.tsx'] = synthesizeReactEntry(appComp, cssPaths);
        entryFile = '/__kalpa/react-entry.tsx';
      }
    }
  }

  // Bridge Sandpack's default template entry (/index.tsx or /index.js) so Sandpack never renders a default placeholder
  const defaultTemplateEntry = template === 'react-ts' ? '/index.tsx' : '/index.js';
  if (entryFile !== defaultTemplateEntry && !spFiles[defaultTemplateEntry]) {
    spFiles[defaultTemplateEntry] = `import '${entryFile.replace(/\.(tsx?|jsx?)$/, '')}';\n`;
  }

  spFiles['/package.json'] = JSON.stringify(
    {
      name: 'kalpa-preview',
      version: '0.1.0',
      private: true,
      main: entryFile,
      dependencies: userDeps,
    },
    null,
    2
  );

  // Extract optional custom title or root id from Vite index.html if present
  const rawHtml = rawSnapshot['index.html'] || rawSnapshot['public/index.html'] || '';
  const titleMatch = /<title>([^<]{1,80})<\/title>/i.exec(rawHtml);
  const rootIdMatch = /<div\b[^>]*\bid=["'](root|app)["'][^>]*>/i.exec(rawHtml);
  const rootDivId = rootIdMatch?.[1] || 'root';
  const pageTitle = titleMatch?.[1]?.trim() || 'Preview';

  const inlineTwBlocks = tw.inlineTailwindCss
    .map((cssText) => `<style type="text/tailwindcss">\n${cssText}\n</style>`)
    .join('\n');

  const readyScript = `<script>
(function(){
  function ping(){
    try { parent.postMessage({ kalpa: 'preview-ready', filesHash: ${JSON.stringify(expectedFilesHash)} }, '*'); } catch (_) {}
  }
  window.addEventListener('load', function(){ setTimeout(ping, 60); });
})();
</script>`;

  spFiles['/public/index.html'] = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tw.configScript}
  ${inlineTwBlocks}
  ${readyScript}
</head>
<body>
  <div id="${rootDivId}"></div>
</body>
</html>`;

  const structuralHash = fnv1a(
    JSON.stringify({
      template,
      entryFile,
      pkg: spFiles['/package.json'],
      keys: Object.keys(spFiles).sort(),
    })
  );

  return {
    template,
    files: spFiles,
    entryFile,
    structuralHash,
    expectedFilesHash,
    hasTailwindV4Warning: tw.hasTailwindV4Warning,
    unsupportedNextFeatures: nextAnalysis?.unsupported ?? [],
  };
}
