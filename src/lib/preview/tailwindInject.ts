export interface TailwindProcessResult {
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

export function processTailwindForSandpack(
  files: Record<string, string>
): TailwindProcessResult {
  const cleanedFiles: Record<string, string> = {};
  const inlineTailwindCss: string[] = [];
  let hasTailwindV4Warning = false;

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

  for (const [path, content] of Object.entries(files)) {
    if (!/\.(css|scss)$/.test(path)) {
      cleanedFiles[path] = content;
      continue;
    }

    if (/@import\s+["']tailwindcss["']|@theme\b/.test(content)) {
      hasTailwindV4Warning = true;
    }

    const strippedDirectives = content
      .replace(/^\s*@tailwind\s+(base|components|utilities)\s*;?\s*$/gm, '')
      .replace(/^\s*@import\s+["']tailwindcss["']\s*;?\s*$/gm, '');

    if (/@apply\b/.test(strippedDirectives)) {
      inlineTailwindCss.push(strippedDirectives);
      cleanedFiles[path] = '/* @apply rules moved to index.html for Tailwind Play CDN */\n';
    } else {
      cleanedFiles[path] = strippedDirectives;
    }
  }

  const configScript = serializedConfig
    ? `<script>try { window.tailwind = window.tailwind || {}; window.tailwind.config = ${serializedConfig}; } catch (e) { console.warn('Tailwind config note:', e); }</script>`
    : '';

  return {
    configScript,
    inlineTailwindCss,
    cleanedFiles,
    hasTailwindV4Warning,
  };
}
