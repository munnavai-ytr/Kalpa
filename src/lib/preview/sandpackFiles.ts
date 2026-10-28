import type { SandpackPredefinedTemplate } from '@codesandbox/sandpack-react';
import { filterOutBrainFiles } from '@/lib/brain/caps';
import type { DetectedProjectType } from './detect';
import { processTailwindForSandpack } from './tailwindInject';
import { analyzeNextLiteProject, type UnsupportedNextFeature } from './nextLite/routes';
import { buildNextLiteShimFiles } from './nextLite/shims';
import { buildNextLiteEntryCode } from './nextLite/entry';

export interface SandpackBundleSpec {
  template: SandpackPredefinedTemplate;
  files: Record<string, string>;
  hasTailwindV4Warning: boolean;
  unsupportedNextFeatures: UnsupportedNextFeature[];
}

function rewriteSourceForSandpack(
  code: string,
  filePath: string,
  hasSrcDir: boolean,
  isNextLite: boolean
): string {
  let out = code
    .replace(/^\s*['"]use (client|server)['"]\s*;?\s*$/gm, '');

  // Rewrite @/* path alias to absolute Sandpack root path
  out = out.replace(
    /((?:from|import)\s*\(?\s*['"])@\/([^'"]+)(['"])/g,
    (_m, pre: string, rel: string, post: string) => {
      const targetRoot = hasSrcDir ? `/src/${rel}` : `/${rel}`;
      return `${pre}${targetRoot}${post}`;
    }
  );

  if (isNextLite) {
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
      out = out.replace(
        new RegExp(`(['"])${escaped}(['"])`, 'g'),
        `$1${shim}$2`
      );
    }

    // Unwrap <html> and <body> in layout files so React createRoot inside #root renders cleanly
    if (/layout\.(tsx|ts|jsx|js)$/.test(filePath)) {
      out = out
        .replace(/<html\b([^>]*)>/gi, '<div data-kalpa-html$1>')
        .replace(/<\/html>/gi, '</div>')
        .replace(/<body\b([^>]*)>/gi, '<div data-kalpa-body$1>')
        .replace(/<\/body>/gi, '</div>');
    }
  }

  return out;
}

function detectReactEntry(paths: string[]): string {
  const candidates = [
    'src/main.tsx',
    'src/index.tsx',
    'src/main.jsx',
    'src/index.jsx',
    'src/main.ts',
    'src/index.js',
    'index.tsx',
    'index.jsx',
    'index.js',
  ];
  for (const c of candidates) {
    if (paths.includes(c)) return `/${c}`;
  }
  return '/src/index.tsx';
}

export function buildSandpackBundle(
  projectType: DetectedProjectType,
  rawSnapshotWithBrain: Record<string, string>
): SandpackBundleSpec {
  const rawSnapshot = filterOutBrainFiles(rawSnapshotWithBrain);
  const tw = processTailwindForSandpack(rawSnapshot);
  const cleaned = tw.cleanedFiles;
  const allPaths = Object.keys(cleaned).filter((p) => !p.endsWith('/.gitkeep'));
  const hasTs = allPaths.some((p) => /\.(ts|tsx)$/.test(p));
  const hasSrcDir = allPaths.some((p) => p.startsWith('src/'));

  const isNextLite = projectType === 'next';
  const nextAnalysis = isNextLite ? analyzeNextLiteProject(cleaned) : null;

  // Strictly use ONLY free-for-commercial STATIC Sandpack templates
  let template: SandpackPredefinedTemplate = 'react-ts';
  if (projectType === 'next') template = 'react-ts';
  else if (projectType === 'react') template = hasTs ? 'react-ts' : 'react';
  else if (projectType === 'vue') template = hasTs ? 'vue-ts' : 'vue';
  else if (projectType === 'svelte') template = 'svelte';
  else if (projectType === 'solid') template = 'solid';
  else if (projectType === 'angular') template = 'angular';
  else template = hasTs ? 'vanilla-ts' : 'vanilla';

  const spFiles: Record<string, string> = {};

  for (const [path, content] of Object.entries(cleaned)) {
    if (path.endsWith('/.gitkeep') || path === 'package.json') continue;
    if (isNextLite && /^(src\/)?app\/api\//.test(path)) continue;
    const transformed = /\.(tsx?|jsx?)$/.test(path)
      ? rewriteSourceForSandpack(content, path, hasSrcDir, isNextLite)
      : content;
    spFiles[`/${path}`] = transformed;
  }

  let userDeps: Record<string, string> = {};
  if (rawSnapshot['package.json']) {
    try {
      const parsed = JSON.parse(rawSnapshot['package.json']);
      userDeps = { ...(parsed.dependencies || {}) };
    } catch {
      // ignore malformed JSON
    }
  }

  if (isNextLite && nextAnalysis) {
    delete userDeps.next;
    userDeps.react = userDeps.react || '^18.3.1';
    userDeps['react-dom'] = userDeps['react-dom'] || '^18.3.1';
    Object.assign(spFiles, buildNextLiteShimFiles());
    spFiles['/__kalpa/entry.tsx'] = buildNextLiteEntryCode(nextAnalysis);
  } else if (projectType === 'react') {
    userDeps.react = userDeps.react || '^18.3.1';
    userDeps['react-dom'] = userDeps['react-dom'] || '^18.3.1';
  }

  const entryFile = isNextLite
    ? '/__kalpa/entry.tsx'
    : projectType === 'react'
      ? detectReactEntry(allPaths)
      : undefined;

  spFiles['/package.json'] = JSON.stringify(
    {
      name: 'kalpa-preview',
      version: '0.1.0',
      private: true,
      ...(entryFile ? { main: entryFile } : {}),
      dependencies: userDeps,
    },
    null,
    2
  );

  const inlineTwBlocks = tw.inlineTailwindCss
    .map((cssText) => `<style type="text/tailwindcss">\n${cssText}\n</style>`)
    .join('\n');

  const rootDivId = template.startsWith('vue') ? 'app' : 'root';
  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <script src="https://cdn.tailwindcss.com"></script>
  ${tw.configScript}
  ${inlineTwBlocks}
</head>
<body>
  <div id="${rootDivId}"></div>
</body>
</html>`;

  if (template === 'react' || template === 'react-ts') {
    spFiles['/public/index.html'] = htmlDoc;
  } else if (!spFiles['/index.html']) {
    spFiles['/index.html'] = htmlDoc;
  }

  return {
    template,
    files: spFiles,
    hasTailwindV4Warning: tw.hasTailwindV4Warning,
    unsupportedNextFeatures: nextAnalysis?.unsupported ?? [],
  };
}
