import { buildGraph, extractImports, resolveImport } from '@/lib/agent/actions';
import { extractJsExports } from '@/lib/agent/tools';
import { estimateTokens } from '@/lib/agent/tokens';
import { languageFromPath } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import { BRAIN_INDEX_PATH, isBrainPath, memoryFileToPath } from './caps';

export interface FileIndexEntry {
  path: string;
  bytes: number;
  lines: number;
  lang: string;
  imports: string[];
  exports: string[];
  importedBy: string[];
  note: string;
}

export interface ProjectBrainIndex {
  generatedAt: number;
  fileCount: number;
  files: FileIndexEntry[];
}

function parseArchitectureNotes(archMd: string): Record<string, string> {
  const notes: Record<string, string> = {};
  const lines = archMd.split('\n');
  for (const line of lines) {
    const m = /^\s*-\s*`?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)`?\s*:\s*(.+)$/.exec(line.trim());
    if (m) {
      const cleanPath = m[1].replace(/^\/+/, '');
      notes[cleanPath] = m[2].trim().slice(0, 120);
    }
  }
  return notes;
}

function extractPythonImports(src: string): string[] {
  const out = new Set<string>();
  const re = /^\s*(?:import\s+([a-zA-Z0-9_.,\s]+)|from\s+([a-zA-Z0-9_.]+)\s+import\b)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) {
      m[1]
        .split(',')
        .map((s) => s.trim().split(/\s+as\s+/)[0]?.trim())
        .filter(Boolean)
        .forEach((p) => out.add(p));
    } else if (m[2]) {
      out.add(m[2].trim());
    }
  }
  return [...out];
}

function extractFirstNote(src: string, exportsList: string[]): string {
  const lines = src.split('\n').slice(0, 25);
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || t.startsWith("'use ") || t.startsWith('"use ')) continue;
    const doc =
      /^\/\*\*?\s*(.+?)\s*(?:\*\/)?$/.exec(t) ||
      /^\/\/\s*(.+)$/.exec(t) ||
      /^#\s*(?!!)(.+)$/.exec(t);
    if (doc && doc[1] && !doc[1].startsWith('*') && doc[1].length > 3) {
      return doc[1].replace(/\*+\/\s*$/, '').trim().slice(0, 90);
    }
    if (t.startsWith('* ') && t.length > 4) {
      return t.slice(2).trim().slice(0, 90);
    }
    if (!t.startsWith('/*') && !t.startsWith('*')) break;
  }
  if (exportsList.length > 0) {
    return `Exports ${exportsList.slice(0, 3).join(', ')}`;
  }
  return '';
}

export async function rebuildBrainIndex(projectId: string): Promise<ProjectBrainIndex> {
  const [metas, snap] = await Promise.all([vfs.list(projectId), vfs.snapshot(projectId)]);
  const archMd = snap[memoryFileToPath('architecture')] ?? '';
  const archNotes = parseArchitectureNotes(archMd);

  const codeSnap: Record<string, string> = {};
  for (const [p, src] of Object.entries(snap)) {
    if (!isBrainPath(p) && !p.endsWith('/.gitkeep')) {
      codeSnap[p] = src;
    }
  }

  const hasSrc = Object.keys(codeSnap).some((p) => p.startsWith('src/'));
  const aliases = hasSrc ? { '@/': 'src/' } : { '@/': '' };
  const fileSet = new Set(Object.keys(codeSnap));

  // Build graph using actions.ts helpers
  const baseGraph = buildGraph(codeSnap);
  const rdeps: Record<string, string[]> = { ...baseGraph.rdeps };
  const resolvedImportsByFile: Record<string, string[]> = {};

  for (const [p, src] of Object.entries(codeSnap)) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(p)) continue;
    const specs = extractImports(src);
    const list: string[] = [];
    for (const s of specs) {
      const r = resolveImport(p, s, fileSet, aliases);
      if (r) {
        list.push(r);
        const rev = (rdeps[r] ||= []);
        if (!rev.includes(p)) rev.push(p);
      } else {
        list.push(s);
      }
    }
    resolvedImportsByFile[p] = list;
  }

  const entries: FileIndexEntry[] = [];
  for (const m of metas) {
    if (isBrainPath(m.path) || m.path.endsWith('/.gitkeep')) continue;
    const src = snap[m.path] ?? '';
    const isText = m.encoding === 'utf8';
    const lines = isText ? src.split('\n').length : 0;
    const lang = languageFromPath(m.path);

    let imports: string[] = [];
    let exportsList: string[] = [];

    if (isText && /\.(tsx?|jsx?|mjs)$/.test(m.path)) {
      imports = resolvedImportsByFile[m.path] ?? [];
      exportsList = extractJsExports(src);
    } else if (isText && m.path.endsWith('.py')) {
      imports = extractPythonImports(src);
    }

    const archNote = archNotes[m.path];
    const autoNote = isText ? extractFirstNote(src, exportsList) : 'binary asset';
    const note = archNote && autoNote && archNote !== autoNote
      ? `${archNote}`
      : archNote || autoNote;

    entries.push({
      path: m.path,
      bytes: m.size,
      lines,
      lang,
      imports,
      exports: exportsList,
      importedBy: rdeps[m.path] ?? [],
      note,
    });
  }

  const indexObj: ProjectBrainIndex = {
    generatedAt: Date.now(),
    fileCount: entries.length,
    files: entries,
  };

  await vfs.write(projectId, BRAIN_INDEX_PATH, `${JSON.stringify(indexObj, null, 2)}\n`, 'utf8');
  return indexObj;
}

export async function readOrBuildBrainIndex(projectId: string): Promise<ProjectBrainIndex> {
  const rec = await vfs.read(projectId, BRAIN_INDEX_PATH);
  if (rec?.content) {
    try {
      return JSON.parse(rec.content) as ProjectBrainIndex;
    } catch {
      // rebuild on parse failure
    }
  }
  return rebuildBrainIndex(projectId);
}

export function fileIndexBlock(index: ProjectBrainIndex, budgetTokens?: number): string {
  const header = 'path | lang | lines | exports | importedBy | note';
  const files = index.files;

  const formatRow = (f: FileIndexEntry) =>
    `${f.path} | ${f.lang} | ${f.lines} | ${f.exports.slice(0, 5).join(',') || '-'} | ${f.importedBy.length} | ${f.note || '-'}`;

  if (files.length === 0) {
    return `<file_index>\n(no project files yet)\n</file_index>`;
  }

  let rows: string[];
  const needsCollapse =
    files.length > 400 ||
    (budgetTokens !== undefined &&
      estimateTokens(files.map(formatRow).join('\n')) > budgetTokens);

  if (!needsCollapse) {
    rows = files.map(formatRow);
  } else {
    const byTopFolder = new Map<string, FileIndexEntry[]>();
    const rootFiles: FileIndexEntry[] = [];
    for (const f of files) {
      const slash = f.path.indexOf('/');
      if (slash < 0) rootFiles.push(f);
      else {
        const dir = f.path.slice(0, slash);
        const list = byTopFolder.get(dir) ?? [];
        list.push(f);
        byTopFolder.set(dir, list);
      }
    }
    rows = rootFiles.slice(0, 120).map(formatRow);
    for (const [dir, list] of byTopFolder.entries()) {
      if (rows.length + list.length <= 360 && (!budgetTokens || rows.length < 150)) {
        rows.push(...list.map(formatRow));
      } else {
        rows.push(`${dir}/ (${list.length} files) | dir | - | - | - | use <list path="${dir}" />`);
      }
    }
    rows = rows.slice(0, 400);
  }

  return `<file_index>\n${header}\n${rows.join('\n')}\n</file_index>`;
}
