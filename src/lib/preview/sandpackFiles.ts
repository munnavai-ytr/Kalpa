import type { SandpackPredefinedTemplate } from '@codesandbox/sandpack-react';
import { filesHash, fnv1a, rewriteForSandpack } from '@/lib/agent/reliability';
import { filterOutBrainFiles } from '@/lib/brain/caps';
import {
  buildTailwindHeadTags,
  processTailwindForSandpack,
  type TailwindRuntimeVersion,
} from './tailwindInject';
import { analyzeNextLiteProject, type UnsupportedNextFeature } from './nextLite/routes';
import { buildNextLiteShimFiles } from './nextLite/shims';
import { buildNextLiteEntryCode } from './nextLite/entry';

export type SandpackStackKind = 'react' | 'next-lite' | 'vue' | 'svelte' | 'solid' | 'angular';

export interface SandpackBundleSpec {
  template: SandpackPredefinedTemplate;
  files: Record<string, string>;
  entryFile: string;
  structuralHash: string;
  expectedFilesHash: string;
  tailwindRuntime: TailwindRuntimeVersion;
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
  projectType: SandpackStackKind,
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

  const template: SandpackPredefinedTemplate =
    projectType === 'vue'
      ? hasTs
        ? 'vue-ts'
        : 'vue'
      : projectType === 'svelte'
        ? 'svelte'
        : projectType === 'solid'
          ? 'solid'
          : projectType === 'angular'
            ? 'angular'
            : isNextLite || hasTs
              ? 'react-ts'
              : 'react';

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

  let entryFile = '/index.tsx';

  if (projectType === 'react' || isNextLite) {
    userDeps.react = userDeps.react || '^18.3.1';
    userDeps['react-dom'] = userDeps['react-dom'] || '^18.3.1';

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

    const defaultTemplateEntry = template === 'react-ts' ? '/index.tsx' : '/index.js';
    if (entryFile !== defaultTemplateEntry && !spFiles[defaultTemplateEntry]) {
      spFiles[defaultTemplateEntry] = `import '${entryFile.replace(/\.(tsx?|jsx?)$/, '')}';\n`;
    }
  } else if (projectType === 'vue') {
    userDeps.vue = userDeps.vue || '^3.4.0';
    entryFile =
      findExistingReactMount(allPaths) || (template === 'vue-ts' ? '/src/main.ts' : '/src/main.js');
  } else if (projectType === 'svelte') {
    userDeps.svelte = userDeps.svelte || '^4.2.0';
    entryFile = findExistingReactMount(allPaths) || '/index.js';
  } else if (projectType === 'solid') {
    userDeps['solid-js'] = userDeps['solid-js'] || '^1.8.0';
    entryFile = findExistingReactMount(allPaths) || '/index.tsx';
  } else if (projectType === 'angular') {
    entryFile = '/src/main.ts';
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

  const rawHtml = rawSnapshot['index.html'] || rawSnapshot['public/index.html'] || '';
  const titleMatch = /<title>([^<]{1,80})<\/title>/i.exec(rawHtml);
  const rootIdMatch = /<div\b[^>]*\bid=["'](root|app)["'][^>]*>/i.exec(rawHtml);
  const rootDivId = rootIdMatch?.[1] || (projectType === 'vue' ? 'app' : 'root');
  const pageTitle = titleMatch?.[1]?.trim() || 'Preview';

  const twHeadTags = buildTailwindHeadTags({
    runtime: tw.runtime,
    configScript: tw.configScript,
    inlineTailwindCss: tw.inlineTailwindCss,
  });

  // B2 + B3: Freshness ready signal (60ms) + Blank-screen DOM probe (1500ms)
  const readyAndProbeScript = `<script>
(function(){
  var fh = ${JSON.stringify(expectedFilesHash)};
  function pingReady(){
    try { parent.postMessage({ kalpa: 'preview-ready', filesHash: fh }, '*'); } catch (_) {}
  }
  function pingProbe(){
    try {
      var r = document.getElementById('root') || document.getElementById('app') || document.getElementById('__next');
      var rootChildren = r ? r.children.length : -1;
      var textLen = ((document.body && document.body.innerText) || '').trim().length;
      var hasVisualMedia = !!document.querySelector('canvas, svg, img, video');
      parent.postMessage({ kalpa: 'preview-probe', filesHash: fh, rootChildren: rootChildren, textLen: textLen, hasVisualMedia: hasVisualMedia }, '*');
    } catch (_) {}
  }
  window.addEventListener('load', function(){
    setTimeout(pingReady, 60);
    setTimeout(pingProbe, 1500);
  });
})();
</script>`;

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle}</title>
  ${twHeadTags}
  ${readyAndProbeScript}
</head>
<body>
  <div class="hidden" id="__tw_probe"></div>
  <div id="${rootDivId}"></div>
</body>
</html>`;

  const htmlTargetPath =
    template === 'solid'
      ? '/index.html'
      : template === 'angular'
        ? '/src/index.html'
        : '/public/index.html';
  spFiles[htmlTargetPath] = htmlDoc;

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
    tailwindRuntime: tw.runtime,
    hasTailwindV4Warning: false,
    unsupportedNextFeatures: nextAnalysis?.unsupported ?? [],
  };
}
