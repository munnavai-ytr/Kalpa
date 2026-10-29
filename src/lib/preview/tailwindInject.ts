export type TailwindRuntimeVersion = 'v3' | 'v4';

export interface TailwindProcessResult {
  runtime: TailwindRuntimeVersion;
  configScript: string;
  inlineTailwindCss: string[];
  cleanedFiles: Record<string, string>;
  hasTailwindV4Warning: boolean;
}

function parseTailwindConfigObject(rawCode: string): string | null {
  try {
    let code = rawCode
      .replace(/^\s*import\s+.*?;?\s*$/gm, '')
      .replace(/satisfies\s+[A-Za-z0-9_.<>]+/g, '')
      .replace(/:\s*Config\b/g, '')
      .replace(/plugins\s*:\s*\[[\s\S]*?\]/g, 'plugins: []');

    if (/export\s+default/.test(code)) {
      code = code.replace(/export\s+default/, 'return');
    } else if (/module\.exports\s*=/.test(code)) {
      code = code.replace(/module\.exports\s*=/, 'return');
    } else {
      return null;
    }

    const evaluator = new Function(code);
    const obj = evaluator();
    if (obj && typeof obj === 'object') {
      return JSON.stringify({ ...obj, plugins: [] });
    }
    return null;
  } catch {
    return null;
  }
}

function detectTailwindVersionFromPackageJson(pkgRaw?: string): TailwindRuntimeVersion | null {
  if (!pkgRaw) return null;
  try {
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const twSpec = deps.tailwindcss || '';
    if (/^[~^]?\s*4\b/.test(twSpec) || '@tailwindcss/postcss' in deps || '@tailwindcss/vite' in deps) {
      return 'v4';
    }
    if (/^[~^]?\s*3\b/.test(twSpec)) {
      return 'v3';
    }
    return null;
  } catch {
    return null;
  }
}

export function processTailwindForSandpack(
  files: Record<string, string>
): TailwindProcessResult {
  const cleanedFiles: Record<string, string> = {};
  const inlineTailwindCss: string[] = [];

  const configCandidates = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.mjs',
    'tailwind.config.cjs',
  ];

  let serializedConfig: string | null = null;
  for (const cfgPath of configCandidates) {
    if (files[cfgPath]) {
      serializedConfig = parseTailwindConfigObject(files[cfgPath]);
      break;
    }
  }

  const pkgDetected = detectTailwindVersionFromPackageJson(files['package.json']);
  let sawV4CssSyntax = false;

  for (const [path, content] of Object.entries(files)) {
    if (!/\.(css|scss)$/.test(path)) continue;
    if (/@import\s+["']tailwindcss["']|@theme\b/.test(content)) {
      sawV4CssSyntax = true;
      break;
    }
  }

  const runtime: TailwindRuntimeVersion = sawV4CssSyntax || pkgDetected === 'v4' ? 'v4' : 'v3';

  for (const [path, content] of Object.entries(files)) {
    if (!/\.(css|scss)$/.test(path)) {
      cleanedFiles[path] = content;
      continue;
    }

    if (runtime === 'v4') {
      // Strip @import "tailwindcss", keep @theme and custom CSS inside <style type="text/tailwindcss">
      const v4Body = content
        .replace(/^\s*@import\s+["']tailwindcss(?:\/[^"']*)?["']\s*;?\s*$/gm, '')
        .replace(/^\s*@tailwind\s+(base|components|utilities)\s*;?\s*$/gm, '')
        .trim();
      if (v4Body) {
        inlineTailwindCss.push(v4Body);
      }
      cleanedFiles[path] = '/* Tailwind v4 CSS injected via <style type="text/tailwindcss"> in index.html */\n';
      continue;
    }

    const strippedDirectives = content
      .replace(/^\s*@tailwind\s+(base|components|utilities)\s*;?\s*$/gm, '')
      .replace(/^\s*@import\s+["']tailwindcss["']\s*;?\s*$/gm, '');

    if (/@apply\b/.test(strippedDirectives)) {
      inlineTailwindCss.push(strippedDirectives);
      cleanedFiles[path] = '/* @apply rules moved to index.html for Tailwind Play runtime */\n';
    } else {
      cleanedFiles[path] = strippedDirectives;
    }
  }

  const configScript =
    runtime === 'v3' && serializedConfig
      ? `<script>try { window.tailwind = window.tailwind || {}; window.tailwind.config = ${serializedConfig}; } catch (e) {}</script>`
      : '';

  return {
    runtime,
    configScript,
    inlineTailwindCss,
    cleanedFiles,
    hasTailwindV4Warning: false,
  };
}

export function buildTailwindHeadTags(opts: {
  runtime: TailwindRuntimeVersion;
  configScript?: string;
  inlineTailwindCss?: string[];
  appOrigin?: string;
}): string {
  const origin = (
    opts.appOrigin ??
    (typeof window !== 'undefined' && /^https?:/.test(window.location.origin)
      ? window.location.origin
      : '')
  ).replace(/\/$/, '');

  const selfSrc =
    opts.runtime === 'v4'
      ? `${origin}/vendor/tailwind-browser-4.js`
      : `${origin}/vendor/tailwind-play-3.4.17.js`;
  const cdnSrc =
    opts.runtime === 'v4'
      ? 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4'
      : 'https://cdn.tailwindcss.com';

  const styleBlocks = (opts.inlineTailwindCss ?? [])
    .map((cssText) => `<style type="text/tailwindcss">\n${cssText}\n</style>`)
    .join('\n');

  const loaderAndProbe = `<script>
(function(){
  var rt = ${JSON.stringify(opts.runtime)};
  var selfUrl = ${JSON.stringify(selfSrc)};
  var cdnUrl = ${JSON.stringify(cdnSrc)};
  window.__kalpaTwSource = 'self';
  var reported = false;
  function checkProbe(finalAttempt) {
    if (reported) return;
    var el = document.getElementById('__tw_probe');
    var ok = !!(el && window.getComputedStyle && window.getComputedStyle(el).display === 'none');
    if (ok || finalAttempt) {
      reported = true;
      var src = ok ? (window.__kalpaTwSource === 'cdn' ? 'cdn' : 'self') : 'failed';
      try { parent.postMessage({ kalpa: 'tw-probe', ok: ok, runtime: rt, source: src }, '*'); } catch (_) {}
    }
  }
  function loadCdn() {
    window.__kalpaTwSource = 'cdn';
    var fb = document.createElement('script');
    fb.src = cdnUrl;
    fb.onload = function() { setTimeout(function(){ checkProbe(true); }, 500); };
    fb.onerror = function() { window.__kalpaTwSource = 'failed'; checkProbe(true); };
    (document.head || document.documentElement).appendChild(fb);
  }
  if (selfUrl && /^https?:/.test(selfUrl)) {
    var s = document.createElement('script');
    s.src = selfUrl;
    s.onload = function() { setTimeout(function(){ checkProbe(false); }, 650); };
    s.onerror = loadCdn;
    (document.head || document.documentElement).appendChild(s);
  } else {
    loadCdn();
  }
  window.addEventListener('load', function() {
    setTimeout(function() {
      if (window.__kalpaTwSource === 'self') checkProbe(false);
    }, 800);
    setTimeout(function() { checkProbe(true); }, 2800);
  });
})();
</script>`;

  return [opts.configScript || '', styleBlocks, loaderAndProbe].filter(Boolean).join('\n  ');
}
