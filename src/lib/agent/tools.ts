import { MAX_PATH_LENGTH } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import { buildGraph, extractImports, impactOf } from './actions';
import {
  formatImpactResult,
  formatListResult,
  formatReadResult,
  formatSearchResult,
} from './results';

export type PathCheckResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Validates paths targeted by agent file/edit/delete/move actions.
 * Rejects .kalpa/, absolute paths, .., node_modules/, .git/, empty or overlong paths.
 */
export function validateAgentPath(raw: string): PathCheckResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: 'Path cannot be empty.' };
  }
  if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    return { ok: false, reason: `Absolute path "${raw}" is forbidden; use workspace-relative paths.` };
  }
  const slashNorm = trimmed.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '');
  const parts = slashNorm.split('/');
  if (parts.some((p) => p === '..' || p === '.')) {
    return { ok: false, reason: `Invalid relative segment in "${raw}".` };
  }
  if (slashNorm.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: `Path exceeds ${MAX_PATH_LENGTH} characters.` };
  }
  if (slashNorm === '.kalpa' || slashNorm.startsWith('.kalpa/')) {
    return { ok: false, reason: 'Reserved path ".kalpa/": use <memory> actions to update project memory.' };
  }
  if (slashNorm === 'node_modules' || slashNorm.startsWith('node_modules/')) {
    return { ok: false, reason: 'Writing inside "node_modules/" is forbidden.' };
  }
  if (slashNorm === '.git' || slashNorm.startsWith('.git/')) {
    return { ok: false, reason: 'Writing inside ".git/" is forbidden.' };
  }
  return { ok: true, path: slashNorm };
}

export function extractJsExports(src: string): string[] {
  const out = new Set<string>();
  const declRe =
    /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(src))) out.add(m[1]);

  if (/\bexport\s+default\b/.test(src) && out.size === 0) {
    out.add('default');
  }
  const namedRe = /\bexport\s*\{([^}]+)\}/g;
  while ((m = namedRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const clean = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (clean && /^[A-Za-z_$][\w$]*$/.test(clean)) out.add(clean);
    }
  }
  return [...out];
}

export async function runReadTool(
  projectId: string,
  rawPath: string,
  linesSpec?: string
): Promise<string> {
  const cleaned = rawPath.trim().replace(/^\/+/, '').replace(/^\.\//, '');
  if (!cleaned || cleaned.includes('..')) {
    return formatReadResult(rawPath, '0-0', 0, `Error: invalid path "${rawPath}"`);
  }
  const rec = await vfs.read(projectId, cleaned);
  if (!rec) {
    return formatReadResult(cleaned, '0-0', 0, `Error: file "${cleaned}" does not exist.`);
  }
  if (rec.encoding === 'base64') {
    return formatReadResult(cleaned, '0-0', 0, `[Binary file: ${cleaned}]`);
  }
  const allLines = rec.content.split('\n');
  const total = allLines.length;
  let start = 1;
  let end = total;
  if (linesSpec) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(linesSpec.trim());
    if (m) {
      start = Math.max(1, Math.min(total, Number(m[1])));
      end = Math.max(start, Math.min(total, Number(m[2])));
    }
  }
  const slice = allLines.slice(start - 1, end).join('\n');
  return formatReadResult(cleaned, `${start}-${end}`, total, slice);
}

export async function runSearchTool(projectId: string, query: string): Promise<string> {
  const snap = await vfs.snapshot(projectId);
  let regex: RegExp;
  const slashMatch = /^\/(.+)\/([gimsuy]*)$/.exec(query.trim());
  try {
    if (slashMatch) {
      const flags = slashMatch[2].includes('i') ? slashMatch[2] : `${slashMatch[2]}i`;
      regex = new RegExp(slashMatch[1], flags.replace(/g/g, ''));
    } else {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(escaped, 'i');
    }
  } catch {
    return formatSearchResult(query, 0, `Invalid search pattern: ${query}`);
  }

  const hits: string[] = [];
  let totalMatches = 0;
  const sortedPaths = Object.keys(snap)
    .filter((p) => !p.startsWith('.kalpa/') && !p.endsWith('/.gitkeep'))
    .sort();

  for (const path of sortedPaths) {
    const lines = snap[path].split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        totalMatches++;
        if (hits.length < 30) {
          hits.push(`${path}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
        }
      }
    }
  }

  return formatSearchResult(
    query,
    totalMatches,
    hits.length ? hits.join('\n') : '(no matches found)'
  );
}

export async function runListTool(
  projectId: string,
  rawDir: string,
  depth: number
): Promise<string> {
  const metas = await vfs.list(projectId);
  const normDir = rawDir === '.' || rawDir === '/' ? '' : rawDir.replace(/^\/+|\/+$/g, '').replace(/^\.\//, '');
  const prefix = normDir ? `${normDir}/` : '';

  const dirs = new Set<string>();
  const files: string[] = [];

  for (const m of metas) {
    if (m.path.startsWith('.kalpa/') || m.path.endsWith('/.gitkeep')) continue;
    if (normDir && !m.path.startsWith(prefix) && m.path !== normDir) continue;
    const rel = normDir ? m.path.slice(prefix.length) : m.path;
    if (!rel) continue;
    const parts = rel.split('/');
    for (let d = 1; d < Math.min(parts.length, depth + 1); d++) {
      dirs.add(parts.slice(0, d).join('/') + '/');
    }
    if (parts.length <= depth) {
      files.push(rel);
    }
  }

  const combined = [...Array.from(dirs).sort(), ...files.sort()].slice(0, 300);
  const body = combined.length ? combined.join('\n') : '(empty directory)';
  return formatListResult(rawDir || '.', depth, body);
}

export async function runImpactTool(
  projectId: string,
  opts: { target?: string; symbol?: string }
): Promise<string> {
  const rawSnap = await vfs.snapshot(projectId);
  const snap: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSnap)) {
    if (!k.startsWith('.kalpa/') && !k.endsWith('/.gitkeep')) snap[k] = v;
  }

  // Alias support for both src/ and root projects
  const hasSrc = Object.keys(snap).some((p) => p.startsWith('src/'));
  const aliases = hasSrc ? { '@/': 'src/' } : { '@/': '' };
  const fileSet = new Set(Object.keys(snap));
  const rdeps: Record<string, string[]> = {};

  for (const [p, src] of Object.entries(snap)) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(p)) continue;
    for (const spec of extractImports(src)) {
      let base: string | null = null;
      if (spec.startsWith('.')) {
        const segs = p.split('/');
        segs.pop();
        for (const s of spec.split('/')) {
          if (s === '.') continue;
          if (s === '..') segs.pop();
          else segs.push(s);
        }
        base = segs.join('/');
      } else {
        for (const [a, t] of Object.entries(aliases)) {
          if (spec.startsWith(a)) {
            base = t + spec.slice(a.length);
            break;
          }
        }
      }
      if (base !== null) {
        const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
        for (const e of exts) {
          if (fileSet.has(base + e)) {
            (rdeps[base + e] ||= []).push(p);
            break;
          }
        }
      }
    }
  }
  // Ensure buildGraph is referenced and usable for standard src/ graphs as well
  void buildGraph;

  if (opts.target) {
    const cleanTarget = opts.target.replace(/^\/+/, '').replace(/^\.\//, '');
    const { direct, indirect } = impactOf(cleanTarget, rdeps, 5);
    const exportsList = snap[cleanTarget] ? extractJsExports(snap[cleanTarget]) : [];
    const lines = [
      `direct importers (${direct.length}): ${direct.length ? direct.join(', ') : 'none'}`,
      `indirect (${indirect.length}): ${indirect.length ? indirect.join(', ') : 'none'}`,
      `exports of ${cleanTarget}: ${exportsList.length ? exportsList.join(', ') : 'none'}`,
    ];
    return formatImpactResult({ target: cleanTarget }, lines.join('\n'));
  }

  const sym = (opts.symbol || '').trim();
  const definers: string[] = [];
  const references: string[] = [];
  const symRe = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

  for (const [path, src] of Object.entries(snap)) {
    const exps = extractJsExports(src);
    if (exps.includes(sym)) definers.push(path);
    else if (symRe.test(src)) references.push(path);
  }
  const indirectSet = new Set<string>();
  for (const def of definers) {
    const imp = impactOf(def, rdeps, 4);
    imp.indirect.forEach((x) => indirectSet.add(x));
  }
  const lines = [
    `exported by (${definers.length}): ${definers.length ? definers.join(', ') : 'none'}`,
    `direct references (${references.length}): ${references.length ? references.join(', ') : 'none'}`,
    `indirect (${indirectSet.size}): ${indirectSet.size ? [...indirectSet].join(', ') : 'none'}`,
  ];
  return formatImpactResult({ symbol: sym }, lines.join('\n'));
}
