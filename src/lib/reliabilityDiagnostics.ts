import JSZip from 'jszip';
import {
  classifyProviderError,
  cleanFileAction,
  detectProjectType,
  parseWithFallback,
  reducedMaxTokens,
  rewriteForSandpack,
} from '@/lib/agent/reliability';
import { ProviderHttpError } from '@/lib/providers/core';
import { extractZipEntries } from '@/lib/vfs/zip';
import type { DiagItem } from './diagnosticsRunner';

export const INITIAL_RELIABILITY_DIAGNOSTIC_CHECKS: DiagItem[] = [
  {
    id: 'reliability-errors',
    label: 'Provider Error Classifier & Credit Cap Math',
    state: 'RUNNING',
    detail: 'Testing 402/429/401/limit:0/context errors…',
  },
  {
    id: 'reliability-parser',
    label: 'Lenient XML & Markdown Action Fallback',
    state: 'RUNNING',
    detail: 'Testing strict, normalized & fenced-markdown recovery…',
  },
  {
    id: 'reliability-preview-zip',
    label: 'Nested ZIP Strip, Stack Detection & Alias Rewrite',
    state: 'RUNNING',
    detail: 'Building in-memory JSZip archive…',
  },
];

export async function executeReliabilityDiagnostics(
  upsertCheck: (item: DiagItem) => void
): Promise<void> {
  // 1. Error Classifier & Token Math
  const tErr = performance.now();
  try {
    const e402 = classifyProviderError(
      new ProviderHttpError(
        402,
        'Payment Required',
        'This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 6268.'
      )
    );
    const capped = reducedMaxTokens(16384, e402.affordableTokens ?? 0);
    if (e402.kind !== 'max_tokens_affordable' || e402.affordableTokens !== 6268 || capped !== 5513) {
      throw new Error(`402 afford math mismatch: kind=${e402.kind}, capped=${capped}`);
    }

    const eZero = classifyProviderError(
      new ProviderHttpError(
        429,
        'Too Many Requests',
        'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0'
      )
    );
    if (eZero.kind !== 'no_free_quota' || !eZero.switchModel) {
      throw new Error(`limit:0 classification mismatch (${eZero.kind})`);
    }

    const eRate = classifyProviderError(
      new ProviderHttpError(429, 'Too Many Requests', 'Rate limit reached for RPM', '12')
    );
    if (eRate.kind !== 'rate_limit' || !eRate.retryable || eRate.retryAfterMs !== 12_000) {
      throw new Error(`429 Retry-After classification mismatch (${eRate.kind}, ${eRate.retryAfterMs})`);
    }

    const eAuth = classifyProviderError(
      new ProviderHttpError(401, 'Unauthorized', 'Invalid API key provided')
    );
    const eCtx = classifyProviderError(
      new ProviderHttpError(400, 'Bad Request', 'context_length_exceeded: prompt is too long')
    );
    if (eAuth.kind !== 'auth' || eAuth.retryable || eCtx.kind !== 'context_too_long' || !eCtx.retryable) {
      throw new Error('401 or context_length_exceeded classification mismatch');
    }

    upsertCheck({
      id: 'reliability-errors',
      label: 'Provider Error Classifier & Credit Cap Math',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tErr),
      detail: `402 afford 6268 -> cap ${capped} · limit:0 -> no_free_quota · 429 Retry-After -> 12000ms · 401 & context_too_long verified`,
    });
  } catch (err) {
    upsertCheck({
      id: 'reliability-errors',
      label: 'Provider Error Classifier & Credit Cap Math',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tErr),
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Lenient XML & Markdown Fallback Parser
  const tParse = performance.now();
  try {
    const strictRes = parseWithFallback('<file path="src/ok.ts">\nexport const ok = true;\n</file>');
    if (strictRes.usedFallback !== 'none' || !strictRes.actions.some((a) => a.type === 'file' && a.path === 'src/ok.ts')) {
      throw new Error('Strict XML path failed');
    }

    const normRes = parseWithFallback(
      "Here is the code:\n```xml\n<file filename='./src/norm.ts'>export const n = 1;</file>\n```"
    );
    if (
      normRes.usedFallback !== 'normalized' ||
      !normRes.actions.some((a) => a.type === 'file' && a.path === 'src/norm.ts')
    ) {
      throw new Error(`Normalized XML fallback failed (${normRes.usedFallback})`);
    }

    const mdRes = parseWithFallback(
      '### src/Calculator.tsx\n```tsx\nexport function Calculator() { return <button>7</button>; }\n```\nDone!'
    );
    const calcFile = mdRes.actions.find((a) => a.type === 'file' && a.path === 'src/Calculator.tsx');
    if (mdRes.usedFallback !== 'markdown' || !calcFile || calcFile.type !== 'file') {
      throw new Error(`Markdown code-fence fallback failed (${mdRes.usedFallback})`);
    }

    const cleaned = cleanFileAction({
      type: 'file',
      path: '/src/fenced.ts',
      content: '```ts\nexport const x = 2;\n```',
    });
    if (cleaned.type !== 'file' || cleaned.path !== 'src/fenced.ts' || cleaned.content.includes('```')) {
      throw new Error('cleanFileAction inner fence strip failed');
    }

    upsertCheck({
      id: 'reliability-parser',
      label: 'Lenient XML & Markdown Action Fallback',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tParse),
      detail: 'Verified strict XML, single-quote/fenced XML normalization, markdown ### path fence extraction, and inner fence stripping',
    });
  } catch (err) {
    upsertCheck({
      id: 'reliability-parser',
      label: 'Lenient XML & Markdown Action Fallback',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tParse),
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Real JSZip Nested Root Stripping + Stack Detection + Sandpack Alias Rewriting
  const tZip = performance.now();
  try {
    const zip = new JSZip();
    zip.file('__MACOSX/._package.json', 'junk');
    zip.file('repo-main/nested-app/.DS_Store', 'junk');
    zip.file('repo-main/nested-app/node_modules/fake/index.js', 'module.exports = 1;');
    zip.file(
      'repo-main/nested-app/package.json',
      JSON.stringify({ name: 'calc-zip', dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' } })
    );
    zip.file(
      'repo-main/nested-app/tsconfig.json',
      '{\n  // comment in tsconfig\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] } }\n}'
    );
    zip.file('repo-main/nested-app/src/utils/calc.ts', 'export const add = (a: number, b: number) => a + b;\n');
    zip.file(
      'repo-main/nested-app/src/App.tsx',
      'import { add } from "@/utils/calc";\nconst mode = import.meta.env.MODE;\nexport default function App() { return <div>{add(2, 3)} {mode}</div>; }\n'
    );

    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'repo-main.zip', { type: 'application/zip' });
    const extracted = await extractZipEntries(file);
    const map: Record<string, string> = {};
    for (const item of extracted) {
      map[item.path] = item.content;
    }

    if (
      !('package.json' in map) ||
      !('src/App.tsx' in map) ||
      Object.keys(map).some((k) => k.includes('__MACOSX') || k.includes('node_modules'))
    ) {
      throw new Error(`Nested ZIP root strip failed: keys=${Object.keys(map).join(', ')}`);
    }

    const det = detectProjectType(map);
    if (det.type !== 'react' || det.entry !== 'src/App.tsx') {
      throw new Error(`detectProjectType mismatch: type=${det.type}, entry=${det.entry}`);
    }

    const rewritten = rewriteForSandpack(map);
    const appCode = rewritten['src/App.tsx'] || '';
    if (!appCode.includes('./utils/calc') || appCode.includes('import.meta.env')) {
      throw new Error(`rewriteForSandpack failed: ${appCode}`);
    }

    upsertCheck({
      id: 'reliability-preview-zip',
      label: 'Nested ZIP Strip, Stack Detection & Alias Rewrite',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tZip),
      detail: 'Peeled 2 nested ZIP folders, pruned __MACOSX/node_modules, detected React (src/App.tsx), rewrote @/utils/calc -> ./utils/calc & import.meta.env',
    });
  } catch (err) {
    upsertCheck({
      id: 'reliability-preview-zip',
      label: 'Nested ZIP Strip, Stack Detection & Alias Rewrite',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tZip),
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
