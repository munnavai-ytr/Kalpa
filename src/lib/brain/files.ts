import { applyEdits } from '@/lib/agent/actions';
import { vfs } from '@/lib/vfs/vfs';
import {
  BRAIN_MEMORY_FILES,
  MEMORY_MAX_CHARS,
  memoryFileToPath,
  normalizeMemoryFileName,
  type BrainMemoryFile,
} from './caps';
import { BRAIN_TEMPLATES, isMemoryTemplateEmpty } from './templates';

export async function ensureBrainFiles(projectId: string): Promise<void> {
  const existing = await vfs.snapshot(projectId);
  const missing: { path: string; content: string; encoding: 'utf8' }[] = [];

  for (const mf of BRAIN_MEMORY_FILES) {
    const path = memoryFileToPath(mf);
    if (existing[path] === undefined) {
      missing.push({ path, content: BRAIN_TEMPLATES[mf], encoding: 'utf8' });
    }
  }

  if (missing.length > 0) {
    await vfs.writeMany(projectId, missing);
  }
}

export async function readAllBrainMemory(
  projectId: string
): Promise<Record<BrainMemoryFile, string>> {
  await ensureBrainFiles(projectId);
  const snap = await vfs.snapshot(projectId);
  const out = {} as Record<BrainMemoryFile, string>;
  for (const mf of BRAIN_MEMORY_FILES) {
    out[mf] = snap[memoryFileToPath(mf)] ?? BRAIN_TEMPLATES[mf];
  }
  return out;
}

export async function isBriefStillTemplate(projectId: string): Promise<boolean> {
  const rec = await vfs.read(projectId, memoryFileToPath('brief'));
  if (!rec) return true;
  return isMemoryTemplateEmpty('brief', rec.content);
}

export async function applyMemoryAction(
  projectId: string,
  rawFile: string,
  op: 'append' | 'replace' | 'patch',
  body: string
): Promise<{ ok: true; file: BrainMemoryFile; content: string } | { ok: false; error: string }> {
  const file = normalizeMemoryFileName(rawFile);
  if (!file) {
    return {
      ok: false,
      error: `Invalid memory file "${rawFile}". Allowed files: ${BRAIN_MEMORY_FILES.join(', ')}. (index.json is auto-generated and read-only.)`,
    };
  }

  await ensureBrainFiles(projectId);
  const path = memoryFileToPath(file);
  const curRec = await vfs.read(projectId, path);
  const current = curRec?.content ?? BRAIN_TEMPLATES[file];
  let next = current;

  if (op === 'replace') {
    next = body.trim() ? `${body.trim()}\n` : '';
  } else if (op === 'append') {
    const cleanAdd = body.trim();
    if (!cleanAdd) {
      return { ok: true, file, content: current };
    }
    const base = isMemoryTemplateEmpty(file, current)
      ? `# ${file.charAt(0).toUpperCase() + file.slice(1)}\n`
      : current.trimEnd();
    next = `${base}\n\n${cleanAdd}\n`;
  } else if (op === 'patch') {
    const pairs = [
      ...body.matchAll(/<find>\n?([\s\S]*?)\n?<\/find>\s*<replace>\n?([\s\S]*?)\n?<\/replace>/g),
    ].map((m) => ({ find: m[1], replace: m[2] }));
    if (pairs.length === 0) {
      return {
        ok: false,
        error: `Memory patch on "${file}" contained no <find>...<replace> pairs.`,
      };
    }
    const applied = applyEdits(current, pairs);
    if (!applied.ok) {
      return { ok: false, error: `Memory patch failed on "${file}": ${applied.error}` };
    }
    next = applied.content.endsWith('\n') ? applied.content : `${applied.content}\n`;
  } else {
    return { ok: false, error: `Unknown memory operation "${String(op)}". Use append, replace, or patch.` };
  }

  if (next.length > MEMORY_MAX_CHARS) {
    return {
      ok: false,
      error: `Memory file "${file}.md" would be ${next.length} characters, exceeding the ${MEMORY_MAX_CHARS}-character cap. Compact it using <memory file="${file}" op="replace"> with a shorter version preserving all key decisions and constraints.`,
    };
  }

  await vfs.write(projectId, path, next, 'utf8');
  return { ok: true, file, content: next };
}

export interface MilestoneItem {
  id: string;
  title: string;
  done: boolean;
}

export function parseMilestonesFromTasks(tasksMd: string): {
  completed: number;
  total: number;
  items: MilestoneItem[];
} {
  const items: MilestoneItem[] = [];
  const re = /^-\s*\[([ xX])\]\s*(M\d+)\b[:\s-]*(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tasksMd))) {
    items.push({
      done: m[1].toLowerCase() === 'x',
      id: m[2],
      title: m[3].trim() || m[2],
    });
  }
  return {
    completed: items.filter((i) => i.done).length,
    total: items.length,
    items,
  };
}

export async function markMilestoneCompleted(projectId: string, milestoneId: string): Promise<void> {
  const path = memoryFileToPath('tasks');
  const rec = await vfs.read(projectId, path);
  if (!rec) return;
  const escaped = milestoneId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(-\\s*\\[) (\\]\\s*${escaped}\\b.*)$`, 'm');
  if (!re.test(rec.content)) return;
  const updated = rec.content.replace(re, '$1x$2');
  if (updated.length <= MEMORY_MAX_CHARS) {
    await vfs.write(projectId, path, updated, 'utf8');
  }
}

export async function appendMachineChangelogLine(
  projectId: string,
  counts: { added: number; modified: number; deleted: number }
): Promise<void> {
  if (counts.added === 0 && counts.modified === 0 && counts.deleted === 0) return;
  await ensureBrainFiles(projectId);
  const path = memoryFileToPath('changelog');
  const rec = await vfs.read(projectId, path);
  const cur = rec?.content ?? BRAIN_TEMPLATES.changelog;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- [${stamp}] files: +${counts.added} ~${counts.modified} -${counts.deleted}`;

  let next = `${cur.trimEnd()}\n${line}\n`;
  if (next.length > MEMORY_MAX_CHARS) {
    const sections = next.split('\n## ');
    if (sections.length > 3) {
      next = `${sections[0]}\n## ${sections.slice(-4).join('\n## ')}`;
    } else {
      next = next.slice(-MEMORY_MAX_CHARS + 200);
    }
  }
  await vfs.write(projectId, path, next, 'utf8');
}
