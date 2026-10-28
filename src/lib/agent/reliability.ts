import { ActionStream, resolveImport, type Action, type PartialBlock } from './actions';

export function deepMerge(
  target: Record<string, unknown>,
  source?: Record<string, unknown>
): Record<string, unknown> {
  if (!source) return target;
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    const cur = out[k];
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      cur &&
      typeof cur === 'object' &&
      !Array.isArray(cur)
    ) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export type ErrorKind =
  | 'auth'
  | 'no_free_quota'
  | 'daily_quota'
  | 'rate_limit'
  | 'insufficient_credit'
  | 'max_tokens_affordable'
  | 'context_too_long'
  | 'model_not_found'
  | 'bad_param'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'cors_or_blocked'
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  status?: number;
  retryable: boolean;
  switchModel: boolean;
  retryAfterMs?: number;
  affordableTokens?: number;
  message: string;
  hint: string;
}

export function parseRetryDelayMs(raw: string, retryAfterHeader?: string | null): number | undefined {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return Math.max(500, Math.round(Number(trimmed) * 1000));
    }
    const parsedDate = Date.parse(trimmed);
    if (!Number.isNaN(parsedDate)) {
      const diff = parsedDate - Date.now();
      if (diff > 0) return diff;
    }
  }
  const msMatch = /(?:retry|try again|reset)[^\d]{0,20}(\d+(?:\.\d+)?)\s*ms\b/i.exec(raw);
  if (msMatch) return Math.max(500, Math.round(Number(msMatch[1])));
  const secMatch =
    /(?:retry in|try again in|"retryDelay"\s*:\s*")(\d+(?:\.\d+)?)\s*s\b/i.exec(raw) ||
    /retry_after["\s:]+(\d+(?:\.\d+)?)/i.exec(raw);
  if (secMatch) return Math.max(500, Math.round(Number(secMatch[1]) * 1000));
  return undefined;
}

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(90_000, Math.max(1000, Math.round(retryAfterMs + 500)));
  }
  const base = 1500 * Math.pow(2, Math.max(0, attempt - 1));
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.min(60_000, Math.round(base * jitter));
}

export function reducedMaxTokens(requested: number, affordable: number): number {
  const safeCap = Math.min(affordable - 32, Math.floor(affordable * 0.9) - 128);
  return Math.max(512, Math.min(requested, safeCap));
}

export function classifyProviderError(
  err: unknown,
  opts?: { isLocalHost?: boolean }
): ClassifiedError {
  const anyErr = err as { status?: number; body?: string; retryAfter?: string | null; message?: string };
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const statusMatch = /^(\d{3})\b/.exec(rawMsg);
  const status = typeof anyErr?.status === 'number' ? anyErr.status : statusMatch ? Number(statusMatch[1]) : undefined;
  const full = `${rawMsg}\n${anyErr?.body ?? ''}`;
  const retryAfterMs = parseRetryDelayMs(full, anyErr?.retryAfter);

  const affordMatch =
    /can only afford\s+(\d+)/i.exec(full) ||
    /afford up to\s+(\d+)\s*tokens/i.exec(full);
  if (affordMatch) {
    const affordable = Number(affordMatch[1]);
    if (Number.isFinite(affordable) && affordable >= 544) {
      return {
        kind: 'max_tokens_affordable',
        status: status ?? 402,
        retryable: true,
        switchModel: false,
        affordableTokens: affordable,
        message: `Key credit only covers ${affordable} output tokens — reducing max_tokens automatically.`,
        hint: 'Add credits or enable Economy mode in Settings to stretch remaining balance.',
      };
    }
    return {
      kind: 'insufficient_credit',
      status: status ?? 402,
      retryable: false,
      switchModel: true,
      affordableTokens: affordable,
      message: `Insufficient API credit remaining (${affordable} tokens left).`,
      hint: 'Top up your provider key or switch to another saved profile.',
    };
  }

  if (
    status === 402 ||
    /insufficient[_\s-]?(?:credit|quota|balance|funds)|billing hard limit|exceeded your current quota|out of credits|payment required/i.test(full)
  ) {
    return {
      kind: 'insufficient_credit',
      status,
      retryable: false,
      switchModel: true,
      message: 'This API key has no remaining credit or billing quota.',
      hint: 'Add credit on your provider dashboard or switch to a fallback profile.',
    };
  }

  if (
    status === 401 ||
    (status === 403 && !/quota|rate|overload/i.test(full)) ||
    /invalid[_\s-]?api[_\s-]?key|api_key_invalid|authentication_error|unauthorized/i.test(full)
  ) {
    return {
      kind: 'auth',
      status,
      retryable: false,
      switchModel: false,
      message: 'API key was rejected by the provider (401/403).',
      hint: 'Check that your API key is valid, active, and matches the selected provider.',
    };
  }

  if (/limit:\s*0\b/i.test(full) || /free_tier[^\n]{0,60}\b0\b/i.test(full)) {
    return {
      kind: 'no_free_quota',
      status: status ?? 429,
      retryable: false,
      switchModel: true,
      message: 'This model has 0 free-tier quota on your key or region.',
      hint: 'Switch to another model (for example gemini-2.5-flash) or add a fallback key.',
    };
  }

  if (/per[_\s-]?day|\bRPD\b|\bTPD\b|daily\s+(?:limit|quota)|requests\s+per\s+day|GenerateRequestsPerDay/i.test(full)) {
    return {
      kind: 'daily_quota',
      status: status ?? 429,
      retryable: false,
      switchModel: true,
      message: 'Daily request/token quota reached for this key and model.',
      hint: 'Switch to another model or configure an automatic fallback profile in Settings.',
    };
  }

  if (status === 429 || /rate[_\s-]?limit|too many requests|resource_exhausted|\bRPM\b|\bTPM\b/i.test(full)) {
    return {
      kind: 'rate_limit',
      status: status ?? 429,
      retryable: true,
      switchModel: false,
      retryAfterMs,
      message: 'Provider per-minute rate limit hit.',
      hint: 'Kalpa automatically waits and retries when rate-limited.',
    };
  }

  if (
    /context_length_exceeded|maximum context length|prompt is too long|input.*too long|token count.*exceeds|exceeds the maximum number of tokens/i.test(
      full
    )
  ) {
    return {
      kind: 'context_too_long',
      status: status ?? 400,
      retryable: true,
      switchModel: false,
      message: 'Prompt exceeded this model’s context window.',
      hint: 'Compacting conversation history and selected files, or choose a larger-context model.',
    };
  }

  if (
    status === 404 ||
    /model[_\s-]?not[_\s-]?found|does not exist|not found for api version|not supported for generateContent/i.test(full)
  ) {
    return {
      kind: 'model_not_found',
      status: status ?? 404,
      retryable: false,
      switchModel: true,
      message: 'Selected model ID was not found on this provider.',
      hint: 'Open Settings -> Providers and click Fetch models to pick an available model ID.',
    };
  }

  if (status === 400 || status === 422 || /unsupported parameter|invalid_request_error|invalid argument/i.test(full)) {
    return {
      kind: 'bad_param',
      status: status ?? 400,
      retryable: false,
      switchModel: false,
      message: `Provider rejected a request parameter: ${rawMsg.slice(0, 180)}`,
      hint: 'Clear Temperature (set Auto) or adjust Extra JSON body in Settings -> Providers.',
    };
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 529 ||
    /overloaded|service unavailable|bad gateway|upstream.*failed|server_error/i.test(full)
  ) {
    return {
      kind: 'overloaded',
      status,
      retryable: true,
      switchModel: false,
      retryAfterMs,
      message: 'Provider servers are temporarily overloaded.',
      hint: 'Retrying automatically with backoff, or switch to another model.',
    };
  }

  if (/idle byte timeout|idle timeout|timed out|etimedout/i.test(full)) {
    return {
      kind: 'timeout',
      status,
      retryable: true,
      switchModel: false,
      message: 'Stream stalled (no bytes received within the idle watchdog window).',
      hint: 'Retry to resume, or increase the idle byte watchdog in Settings -> Agent.',
    };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      kind: 'network',
      retryable: true,
      switchModel: false,
      message: 'Your device is offline.',
      hint: 'Reconnect to Wi-Fi or mobile data — Kalpa will resume automatically.',
    };
  }

  if (/failed to fetch|load failed|networkerror|cors/i.test(full)) {
    if (!opts?.isLocalHost) {
      return {
        kind: 'cors_or_blocked',
        retryable: true,
        switchModel: false,
        message: 'Direct browser connection failed (network drop or CORS block).',
        hint: 'If your network is online, try enabling the stateless CORS proxy for this provider.',
      };
    }
    return {
      kind: 'network',
      retryable: true,
      switchModel: false,
      message: 'Could not reach local model server.',
      hint: 'Verify Ollama / LM Studio is running and has CORS enabled.',
    };
  }

  return {
    kind: 'unknown',
    status,
    retryable: false,
    switchModel: false,
    message: rawMsg.slice(0, 260) || 'Unexpected provider error.',
    hint: 'Retry the turn or check provider settings.',
  };
}

export function cleanFileAction(a: Action): Action {
  if (a.type !== 'file') return a;
  const cleanPath = a.path.trim().replace(/^(\.\/|\/)+/, '');
  let body = a.content;
  if (!/\.(md|mdx|markdown)$/i.test(cleanPath)) {
    const trimmed = body.trim();
    const fenceMatch = /^```[\w.-]*[ \t]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
    if (fenceMatch) {
      body = fenceMatch[1].endsWith('\n') ? fenceMatch[1] : `${fenceMatch[1]}\n`;
    }
  }
  return { ...a, path: cleanPath, content: body };
}

export function normalizeModelOutput(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n');
  // Unwrap markdown fences that wrap XML action tags
  s = s.replace(/```(?:xml|html|kalpa)?\s*\n(\s*<(?:file|edit|shell|memory|question|read|search|list|impact|delete|move|status|complete|finished)\b[\s\S]*?)\n```/g, '$1');
  // Normalize single quotes & file/name attrs on known action tags
  s = s.replace(
    /<(file|edit|shell|memory|question|read|search|list|impact|delete|move|status|complete|finished)\b([^>]*?)(\/?)>/g,
    (_m, tag: string, attrs: string, selfSlash: string) => {
      let fixed = attrs.replace(/([\w-]+)\s*=\s*'([^']*)'/g, '$1="$2"');
      if (tag === 'file' || tag === 'edit') {
        fixed = fixed.replace(/\b(?:filename|filepath|name)\s*=\s*"/g, 'path="');
      }
      return `<${tag}${fixed}${selfSlash ? ' /' : ''}>`;
    }
  );
  // Ensure block opening & closing tags stand on their own lines
  s = s.replace(/([^\n])(\s*<(?:file|edit|shell|memory|question)\b[^>]*>)/g, '$1\n$2');
  s = s.replace(/(<(?:file|edit|shell|memory|question)\b[^/>]*>)([^\n])/g, '$1\n$2');
  s = s.replace(/([^\n])(<\/(?:file|edit|shell|memory|question)>)/g, '$1\n$2');
  s = s.replace(/(<\/(?:file|edit|shell|memory|question)>)([^\n])/g, '$1\n$2');
  return s;
}

function isLikelyProjectPath(candidate: string): boolean {
  const p = candidate.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/^(\.\/|\/)+/, '');
  if (!p || p.length > 140 || p.includes('..') || /\s/.test(p) || p.startsWith('.kalpa')) return false;
  if (/^(https?:|mailto:)/i.test(p)) return false;
  return /\.[a-z0-9]{1,8}$/i.test(p) || /^(Dockerfile|Makefile)$/i.test(p);
}

export function markdownToFileActions(raw: string): Action[] {
  const out: Action[] = [];
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const fenceOpen = /^```([^\n]*)$/.exec(lines[i].trim());
    if (!fenceOpen) {
      i++;
      continue;
    }
    const info = fenceOpen[1].trim();
    let detectedPath: string | null = null;

    // 1. Check info string: ```tsx src/App.tsx or title="src/App.tsx"
    const titleAttr = /(?:title|file|path)=["']?([^\s"']+)["']?/i.exec(info);
    if (titleAttr && isLikelyProjectPath(titleAttr[1])) {
      detectedPath = titleAttr[1];
    } else {
      for (const tok of info.split(/\s+/).slice(1)) {
        if (isLikelyProjectPath(tok)) {
          detectedPath = tok;
          break;
        }
      }
    }
    if (!detectedPath && info.includes('/') && isLikelyProjectPath(info)) {
      detectedPath = info;
    }

    // 2. Check up to 2 preceding non-empty lines for heading / bold / `path`
    if (!detectedPath) {
      for (let back = i - 1; back >= Math.max(0, i - 3); back--) {
        const prev = lines[back].trim();
        if (!prev) continue;
        const m =
          /^(?:#{1,6}\s+|[-*]\s+)?(?:file\s*:\s*)?[*_`]*([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})[*_`]*\s*:?$/i.exec(prev) ||
          /`([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})`/.exec(prev);
        if (m && isLikelyProjectPath(m[1])) {
          detectedPath = m[1];
          break;
        }
        break;
      }
    }

    const bodyLines: string[] = [];
    i++;
    while (i < lines.length && lines[i].trim() !== '```') {
      bodyLines.push(lines[i]);
      i++;
    }
    if (i < lines.length && lines[i].trim() === '```') i++;

    // 3. Check first line comment inside code block
    if (!detectedPath && bodyLines.length > 0) {
      const firstLine = bodyLines[0].trim();
      const cm =
        /^(?:\/\/|#|<!--|\/\*+)\s*(?:filepath:|file:|path:)?\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})(?:\s*(?:-->|\*+\/))?$/i.exec(
          firstLine
        );
      if (cm && isLikelyProjectPath(cm[1])) {
        detectedPath = cm[1];
        bodyLines.shift();
      }
    }

    if (detectedPath) {
      const cleanPath = detectedPath.trim().replace(/^(\.\/|\/)+/, '');
      const content = bodyLines.join('\n');
      out.push(
        cleanFileAction({
          type: 'file',
          path: cleanPath,
          content: content.endsWith('\n') ? content : `${content}\n`,
        })
      );
    }
  }
  return out;
}

function runStreamOnce(input: string): { actions: Action[]; truncated: PartialBlock | null } {
  const s = new ActionStream();
  const pushed = s.push(input);
  const ended = s.end();
  return {
    actions: [...pushed, ...ended.actions].map(cleanFileAction),
    truncated: ended.truncated,
  };
}

export function parseWithFallback(raw: string): {
  actions: Action[];
  truncated: PartialBlock | null;
  usedFallback: 'none' | 'normalized' | 'markdown';
} {
  const strict = runStreamOnce(raw);
  if (strict.actions.some((a) => a.type !== 'text') || strict.truncated) {
    return { ...strict, usedFallback: 'none' };
  }
  const norm = runStreamOnce(normalizeModelOutput(raw));
  if (norm.actions.some((a) => a.type !== 'text') || norm.truncated) {
    return { ...norm, usedFallback: 'normalized' };
  }
  const mdFiles = markdownToFileActions(raw);
  if (mdFiles.length > 0) {
    return { actions: mdFiles, truncated: null, usedFallback: 'markdown' };
  }
  return { ...strict, usedFallback: 'none' };
}

export function stripCommonRoot<T = string>(rawFiles: Record<string, T>): Record<string, T> {
  const entries: [string, T][] = [];
  for (const [rawPath, val] of Object.entries(rawFiles)) {
    const p = rawPath.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '').replace(/\/+$/, '');
    if (!p) continue;
    const segs = p.split('/');
    if (
      segs.some(
        (s) =>
          s === '__MACOSX' ||
          s === '.DS_Store' ||
          s === 'Thumbs.db' ||
          s === '.git' ||
          s === 'node_modules' ||
          s === '.next'
      )
    ) {
      continue;
    }
    entries.push([p, val]);
  }
  if (entries.length === 0) return {};

  // Repeatedly peel wrapper folders if every file shares the exact same first segment
  for (let guard = 0; guard < 6; guard++) {
    const firstSegs = new Set<string>();
    let allNested = true;
    for (const [p] of entries) {
      const slash = p.indexOf('/');
      if (slash <= 0) {
        allNested = false;
        break;
      }
      firstSegs.add(p.slice(0, slash));
    }
    if (!allNested || firstSegs.size !== 1) break;
    const prefix = `${[...firstSegs][0]}/`;
    for (let i = 0; i < entries.length; i++) {
      entries[i] = [entries[i][0].slice(prefix.length), entries[i][1]];
    }
  }

  return Object.fromEntries(entries);
}

export type ProjectType =
  | 'empty'
  | 'static'
  | 'react'
  | 'next-lite'
  | 'python'
  | 'node-script'
  | 'cloud-only';

export interface Detection {
  type: ProjectType;
  reason: string;
  entry?: string;
}

export function detectProjectType(files: Record<string, string>): Detection {
  const paths = Object.keys(files).filter((p) => !p.startsWith('.kalpa/') && !p.endsWith('/.gitkeep'));
  if (paths.length === 0) {
    return { type: 'empty', reason: 'Workspace has no project files yet.' };
  }

  let deps: Record<string, string> = {};
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      // ignore invalid package.json
    }
  }

  const cloudUnsupportedFrameworks = [
    'vue',
    'nuxt',
    'svelte',
    '@sveltejs/kit',
    'astro',
    '@angular/core',
    '@remix-run/node',
  ].find((d) => d in deps);
  if (cloudUnsupportedFrameworks) {
    return {
      type: 'cloud-only',
      reason: `Uses ${cloudUnsupportedFrameworks}, which requires a full dev server in Cloud Sandbox.`,
      entry: 'package.json',
    };
  }

  const serverOnlyDeps = [
    'prisma',
    '@prisma/client',
    'better-sqlite3',
    'sqlite3',
    'pg',
    'mysql2',
    'mongoose',
    'puppeteer',
    'playwright',
  ].find((d) => d in deps);
  const backendFrameworks = ['express', 'fastify', '@nestjs/core', 'koa'].find((d) => d in deps);
  const hasFrontendUi =
    'react' in deps ||
    'next' in deps ||
    paths.some((p) => /\.(tsx|jsx|html)$/.test(p));

  if (serverOnlyDeps || (backendFrameworks && !hasFrontendUi)) {
    const pkgName = serverOnlyDeps || backendFrameworks;
    return {
      type: 'cloud-only',
      reason: `Depends on Node server/database package "${pkgName}", which requires Cloud Sandbox.`,
      entry: 'package.json',
    };
  }

  const reqTxt = `${files['requirements.txt'] ?? ''}\n${files['pyproject.toml'] ?? ''}`;
  if (/\b(fastapi|flask|django|uvicorn|streamlit|gradio)\b/i.test(reqTxt)) {
    return {
      type: 'cloud-only',
      reason: 'Python web server framework detected (FastAPI/Flask/Django/Streamlit); requires Cloud Sandbox.',
      entry: paths.find((p) => p.endsWith('.py')) || 'requirements.txt',
    };
  }

  const nextEntries = [
    'src/app/page.tsx',
    'src/app/page.jsx',
    'app/page.tsx',
    'app/page.jsx',
    'src/pages/index.tsx',
    'pages/index.tsx',
  ];
  const nextEntry = nextEntries.find((p) => p in files);
  if ('next' in deps || nextEntry || paths.some((p) => /^next\.config\./.test(p))) {
    return {
      type: 'next-lite',
      reason: nextEntry ? `Next.js app entry at ${nextEntry}` : 'Next.js dependency in package.json',
      entry: nextEntry || paths.find((p) => /\.(tsx|jsx)$/.test(p)),
    };
  }

  const reactEntries = [
    'src/main.tsx',
    'src/main.jsx',
    'src/index.tsx',
    'src/index.jsx',
    'index.tsx',
    'index.jsx',
    'src/App.tsx',
    'src/App.jsx',
    'App.tsx',
    'App.jsx',
  ];
  const reactEntry = reactEntries.find((p) => p in files);
  if ('react' in deps || reactEntry || paths.some((p) => /\.(tsx|jsx)$/.test(p))) {
    const fallbackTsx = paths.find((p) => /\.(tsx|jsx)$/.test(p));
    return {
      type: 'react',
      reason: reactEntry ? `React entry at ${reactEntry}` : 'React/JSX components detected',
      entry: reactEntry || fallbackTsx,
    };
  }

  const htmlEntry =
    ['index.html', 'public/index.html'].find((p) => p in files) ||
    paths.find((p) => p.endsWith('.html'));
  if (htmlEntry) {
    return {
      type: 'static',
      reason: `Static HTML entry at ${htmlEntry}`,
      entry: htmlEntry,
    };
  }

  const pyEntry =
    ['main.py', 'app.py', 'src/main.py'].find((p) => p in files) ||
    paths.find((p) => p.endsWith('.py'));
  if (pyEntry) {
    return {
      type: 'python',
      reason: `Python script at ${pyEntry}`,
      entry: pyEntry,
    };
  }

  const scriptEntry =
    ['index.ts', 'index.js', 'main.ts', 'main.js', 'src/index.ts', 'src/index.js'].find((p) => p in files) ||
    paths.find((p) => /\.(ts|js|mjs)$/.test(p) && !/config\./.test(p));
  if (scriptEntry) {
    return {
      type: 'node-script',
      reason: `JS/TS script at ${scriptEntry}`,
      entry: scriptEntry,
    };
  }

  return {
    type: 'static',
    reason: 'Static asset / configuration workspace',
    entry: paths[0],
  };
}

function relativeModuleSpec(fromFile: string, toFile: string): string {
  const fromParts = fromFile.split('/');
  fromParts.pop();
  const toParts = toFile.split('/');
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length - 1 &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const rel = [...Array(ups).fill('..'), ...toParts.slice(common)].join('/');
  const withDot = rel.startsWith('.') ? rel : `./${rel}`;
  return withDot.replace(/\.(tsx?|jsx?)$/, '');
}

export function extractTsconfigAliases(files: Record<string, string>): Record<string, string> {
  const hasSrc = Object.keys(files).some((p) => p.startsWith('src/'));
  const aliases: Record<string, string> = { '@/': hasSrc ? 'src/' : '' };
  for (const cfgName of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const raw = files[cfgName];
    if (!raw) continue;
    try {
      const stripped = raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      const parsed = JSON.parse(stripped) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const baseUrl = (parsed.compilerOptions?.baseUrl || '').replace(/^(\.\/|\/)+|\/+$/g, '');
      const paths = parsed.compilerOptions?.paths || {};
      for (const [pat, targets] of Object.entries(paths)) {
        if (!pat.endsWith('*') || !targets?.[0]?.endsWith('*')) continue;
        const key = pat.slice(0, -1);
        const rawTarget = targets[0].slice(0, -1).replace(/^(\.\/|\/)+/, '');
        aliases[key] = baseUrl ? `${baseUrl}/${rawTarget}`.replace(/\/+/g, '/') : rawTarget;
      }
    } catch {
      // ignore non-strict JSON comments/trailing commas
    }
  }
  return aliases;
}

export function rewriteForSandpack(
  files: Record<string, string>,
  opts?: { aliases?: Record<string, string>; env?: Record<string, string> }
): Record<string, string> {
  const aliases = opts?.aliases ?? extractTsconfigAliases(files);
  const fileSet = new Set(Object.keys(files));
  const envObj = JSON.stringify({
    MODE: 'development',
    DEV: true,
    PROD: false,
    BASE_URL: '/',
    ...(opts?.env ?? {}),
  });

  const out: Record<string, string> = {};
  for (const [path, src] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(path)) {
      out[path] = src;
      continue;
    }
    let rewritten = src.replace(
      /((?:import|export)\s+(?:type\s+)?(?:[\w*\s{},$]+\s+from\s+)?|import\s*\(\s*)(['"])([^'"]+)\2/g,
      (full, prefix: string, quote: string, spec: string) => {
        if (spec.startsWith('.')) return full;
        const target = resolveImport(path, spec, fileSet, aliases);
        if (!target) return full;
        return `${prefix}${quote}${relativeModuleSpec(path, target)}${quote}`;
      }
    );
    if (rewritten.includes('import.meta.env')) {
      rewritten = rewritten.replace(/\bimport\.meta\.env\b/g, `(${envObj})`);
    }
    out[path] = rewritten;
  }
  return out;
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function filesHash(files: Record<string, string>): string {
  const keys = Object.keys(files)
    .filter((k) => !k.startsWith('.kalpa/'))
    .sort();
  let acc = '';
  for (const k of keys) {
    acc += `${k}\0${files[k]}\0`;
  }
  return fnv1a(acc);
}
