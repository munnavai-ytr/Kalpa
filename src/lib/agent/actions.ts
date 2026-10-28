// ===== Kalpa action protocol: streaming parser =====
export type Action =
  | { type: 'text'; text: string }
  | { type: 'read'; path: string; lines?: string }
  | { type: 'search'; query: string }
  | { type: 'list'; path: string; depth: number }
  | { type: 'impact'; target?: string; symbol?: string }
  | { type: 'file'; path: string; content: string }
  | { type: 'edit'; path: string; edits: { find: string; replace: string }[] }
  | { type: 'delete'; path: string }
  | { type: 'move'; from: string; to: string }
  | { type: 'shell'; cmd: string; cwd?: string; timeout?: number; background?: boolean; port?: number }
  | { type: 'memory'; file: string; op: 'append' | 'replace' | 'patch'; content: string }
  | { type: 'question'; text: string; options: string[] }
  | { type: 'status'; text: string; step?: string }
  | { type: 'complete'; milestone?: string; next?: string }
  | { type: 'finished' };

export interface PartialBlock { name: string; attrs: Record<string, string>; body: string }

const BLOCKS = new Set(['file', 'edit', 'shell', 'memory', 'question']);
const SELF = new Set(['read', 'search', 'list', 'impact', 'delete', 'move', 'status', 'complete', 'finished']);

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

export class ActionStream {
  private buf = '';
  private text: string[] = [];
  private cur: { name: string; attrs: Record<string, string>; lines: string[] } | null = null;

  /** Feed a streamed chunk. Returns actions completed by this chunk. */
  push(chunk: string): Action[] {
    this.buf += chunk;
    const out: Action[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this.line(line, out);
    }
    return out;
  }

  /** Call when the stream ends. Flushes text; returns truncated block (if any) separately. */
  end(): { actions: Action[]; truncated: PartialBlock | null } {
    const out: Action[] = [];
    if (this.buf.length) { const rest = this.buf; this.buf = ''; this.line(rest, out); }
    const truncated = this.partial();
    this.cur = null;
    this.flushText(out);
    return { actions: out, truncated };
  }

  /** Block currently being written (for live UI, e.g. showing a file streaming in). */
  partial(): PartialBlock | null {
    return this.cur ? { name: this.cur.name, attrs: this.cur.attrs, body: this.cur.lines.join('\n') } : null;
  }

  private flushText(out: Action[]) {
    const t = this.text.join('\n').trim();
    this.text = [];
    if (t) out.push({ type: 'text', text: t });
  }

  private line(line: string, out: Action[]) {
    if (this.cur) {
      if (line.trim() === `</${this.cur.name}>`) {
        const a = this.close(this.cur);
        this.cur = null;
        if (a) out.push(a);
      } else this.cur.lines.push(line);
      return;
    }
    const t = line.trim();
    let m = /^<(\w+)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*\/>$/.exec(t);
    if (m && SELF.has(m[1])) { this.flushText(out); const a = this.self(m[1], parseAttrs(m[2])); if (a) out.push(a); return; }
    m = /^<(\w+)((?:\s+[\w-]+\s*=\s*"[^"]*")*)\s*>$/.exec(t);
    if (m && BLOCKS.has(m[1])) { this.flushText(out); this.cur = { name: m[1], attrs: parseAttrs(m[2]), lines: [] }; return; }
    this.text.push(line);
  }

  private self(name: string, a: Record<string, string>): Action | null {
    switch (name) {
      case 'read': return a.path ? { type: 'read', path: a.path, lines: a.lines } : null;
      case 'search': return a.query ? { type: 'search', query: a.query } : null;
      case 'list': return { type: 'list', path: a.path || '.', depth: Math.min(Number(a.depth) || 2, 6) };
      case 'impact': return a.target || a.symbol ? { type: 'impact', target: a.target, symbol: a.symbol } : null;
      case 'delete': return a.path ? { type: 'delete', path: a.path } : null;
      case 'move': return a.from && a.to ? { type: 'move', from: a.from, to: a.to } : null;
      case 'status': return { type: 'status', text: a.text || '', step: a.step };
      case 'complete': return { type: 'complete', milestone: a.milestone, next: a.next };
      case 'finished': return { type: 'finished' };
    }
    return null;
  }

  private close(b: { name: string; attrs: Record<string, string>; lines: string[] }): Action | null {
    const body = b.lines.join('\n');
    switch (b.name) {
      case 'file': return b.attrs.path ? { type: 'file', path: b.attrs.path, content: body.endsWith('\n') ? body : body + '\n' } : null;
      case 'shell': return { type: 'shell', cmd: body.trim(), cwd: b.attrs.cwd, timeout: b.attrs.timeout ? Number(b.attrs.timeout) : undefined, background: b.attrs.background === 'true' || undefined, port: b.attrs.port ? Number(b.attrs.port) : undefined };
      case 'memory': return { type: 'memory', file: b.attrs.file || 'notes', op: (b.attrs.op as any) || 'append', content: body };
      case 'question': {
        const opts = [...body.matchAll(/<option>([\s\S]*?)<\/option>/g)].map(x => x[1].trim());
        const text = body.replace(/<option>[\s\S]*?<\/option>/g, '').trim();
        return { type: 'question', text, options: opts };
      }
      case 'edit': {
        const edits = [...body.matchAll(/<find>\n?([\s\S]*?)\n?<\/find>\s*<replace>\n?([\s\S]*?)\n?<\/replace>/g)].map(x => ({ find: x[1], replace: x[2] }));
        return b.attrs.path && edits.length ? { type: 'edit', path: b.attrs.path, edits } : null;
      }
    }
    return null;
  }
}

// ===== Edit applier with tolerant matching =====
export type EditResult = { ok: true; content: string } | { ok: false; error: string };

function countOcc(h: string, n: string): number {
  if (!n) return 0;
  let c = 0, i = 0;
  while ((i = h.indexOf(n, i)) >= 0) { c++; i += n.length; }
  return c;
}

export function applyEdits(content: string, edits: { find: string; replace: string }[]): EditResult {
  let cur = content;
  for (let k = 0; k < edits.length; k++) {
    const { find, replace } = edits[k];
    const n = countOcc(cur, find);
    if (n === 1) { cur = cur.replace(find, () => replace); continue; }
    if (n > 1) return { ok: false, error: `edit #${k + 1}: <find> matches ${n} places; add more surrounding lines so it is unique.` };
    // tolerant: ignore indentation + trailing spaces, line-by-line
    const norm = (s: string) => s.replace(/[ \t]+$/g, '').trim();
    const cl = cur.split('\n'), fl = find.split('\n').map(norm);
    while (fl.length && fl[0] === '') fl.shift();
    while (fl.length && fl[fl.length - 1] === '') fl.pop();
    const hits: number[] = [];
    for (let i = 0; i + fl.length <= cl.length; i++) {
      let ok = true;
      for (let j = 0; j < fl.length; j++) if (norm(cl[i + j]) !== fl[j]) { ok = false; break; }
      if (ok) hits.push(i);
    }
    if (hits.length === 1 && fl.length) {
      const i = hits[0];
      const indent = /^[ \t]*/.exec(cl[i])![0];
      const rep = replace.split('\n');
      const baseIndent = /^[ \t]*/.exec(find.split('\n').find(l => l.trim()) || '')![0];
      const fixed = rep.map(l => (l.startsWith(baseIndent) ? indent + l.slice(baseIndent.length) : l));
      cl.splice(i, fl.length, ...fixed);
      cur = cl.join('\n');
      continue;
    }
    if (hits.length > 1) return { ok: false, error: `edit #${k + 1}: <find> matches ${hits.length} places (ignoring indentation); make it unique.` };
    // help the model: show closest line
    const first = fl.find(l => l) || '';
    const near = cl.findIndex(l => norm(l).includes(first.slice(0, 25)));
    return { ok: false, error: `edit #${k + 1}: <find> text not found in the file.` + (near >= 0 ? ` Closest line ${near + 1}: ${cl[near].slice(0, 120)}` : '') + ' Re-read the file and copy the text exactly.' };
  }
  return { ok: true, content: cur };
}

// ===== Import graph (JS/TS) =====
export function extractImports(src: string): string[] {
  const out = new Set<string>();
  const re = /(?:import|export)\s+(?:[\w*\s{},$]+\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.add((m[1] || m[2] || m[3]) as string);
  return [...out];
}

export function resolveImport(from: string, spec: string, files: Set<string>, aliases: Record<string, string> = { '@/': 'src/' }): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    const parts = from.split('/'); parts.pop();
    for (const seg of spec.split('/')) { if (seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
    base = parts.join('/');
  } else {
    for (const [a, t] of Object.entries(aliases)) if (spec.startsWith(a)) { base = t + spec.slice(a.length); break; }
  }
  if (base === null) return null; // external package
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.json', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  for (const e of exts) if (files.has(base + e)) return base + e;
  return null;
}

export function buildGraph(files: Record<string, string>): { deps: Record<string, string[]>; rdeps: Record<string, string[]> } {
  const set = new Set(Object.keys(files));
  const deps: Record<string, string[]> = {}, rdeps: Record<string, string[]> = {};
  for (const [p, src] of Object.entries(files)) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(p)) continue;
    deps[p] = [];
    for (const s of extractImports(src)) {
      const r = resolveImport(p, s, set);
      if (r) { deps[p].push(r); (rdeps[r] ||= []).push(p); }
    }
  }
  return { deps, rdeps };
}

/** All files that (transitively) depend on `target`. */
export function impactOf(target: string, rdeps: Record<string, string[]>, maxDepth = 4): { direct: string[]; indirect: string[] } {
  const direct = rdeps[target] ? [...rdeps[target]] : [];
  const seen = new Set<string>([target, ...direct]);
  let frontier = [...direct];
  const indirect: string[] = [];
  for (let d = 1; d < maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const f of frontier) for (const r of rdeps[f] || []) if (!seen.has(r)) { seen.add(r); indirect.push(r); next.push(r); }
    frontier = next;
  }
  return { direct, indirect };
}
