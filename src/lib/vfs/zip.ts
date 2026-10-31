import JSZip from 'jszip';
import { detectProjectType, stripCommonRoot } from '@/lib/agent/reliability';
import { ensureBrainFiles } from '@/lib/brain/files';
import { rebuildBrainIndex } from '@/lib/brain/index';
import { getKalpaDB, type ProjectRecord } from './db';
import { isBinaryPath, normalisePath } from './paths';
import { vfs, type VfsWriteEntry } from './vfs';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function downloadProjectZip(
  projectId: string,
  projectName: string,
  opts?: { includeBrain?: boolean }
): Promise<void> {
  const includeBrain = Boolean(opts?.includeBrain);
  const db = await getKalpaDB();
  const rows = await db.getAllFromIndex('files', 'by-project', projectId);
  const zip = new JSZip();
  for (const row of rows) {
    if (row.path.endsWith('/.gitkeep')) continue;
    if (!includeBrain && (row.path === '.kalpa' || row.path.startsWith('.kalpa/'))) continue;
    if (row.encoding === 'base64') {
      zip.file(row.path, row.content, { base64: true });
    } else {
      zip.file(row.path, row.content);
    }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const safeName = projectName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'kalpa-project';
  triggerDownload(blob, `${safeName}.zip`);
}

export async function downloadAllProjectsZip(): Promise<number> {
  const db = await getKalpaDB();
  const projects = await db.getAll('projects');
  const zip = new JSZip();

  for (const proj of projects) {
    const folderName = `${proj.name.replace(/[^a-zA-Z0-9-_ ]+/g, '').trim() || 'project'}-${proj.id.slice(-5)}`;
    const folder = zip.folder(folderName);
    if (!folder) continue;
    const files = await db.getAllFromIndex('files', 'by-project', proj.id);
    for (const f of files) {
      if (f.path.endsWith('/.gitkeep')) continue;
      if (f.encoding === 'base64') {
        folder.file(f.path, f.content, { base64: true });
      } else {
        folder.file(f.path, f.content);
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `kalpa-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  return projects.length;
}

export async function extractZipEntries(file: File): Promise<VfsWriteEntry[]> {
  const zip = await JSZip.loadAsync(file);
  const rawObjects: Record<string, JSZip.JSZipObject> = {};
  for (const [key, obj] of Object.entries(zip.files)) {
    if (!obj.dir) rawObjects[key] = obj;
  }

  const stripped = stripCommonRoot(rawObjects);
  const entries: VfsWriteEntry[] = [];

  for (const [cleanKey, zipObj] of Object.entries(stripped)) {
    let path: string;
    try {
      path = normalisePath(cleanKey);
    } catch {
      continue;
    }
    if (!path) continue;
    if (isBinaryPath(path)) {
      const b64 = await zipObj.async('base64');
      entries.push({ path, content: b64, encoding: 'base64' });
    } else {
      const text = await zipObj.async('string');
      entries.push({ path, content: text, encoding: 'utf8' });
    }
  }
  return entries;
}

export async function extractFolderEntries(files: FileList | File[]): Promise<VfsWriteEntry[]> {
  const list = Array.from(files);
  const rawMap: Record<string, File> = {};
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    if (rel) rawMap[rel] = f;
  }

  const stripped = stripCommonRoot(rawMap);
  const entries: VfsWriteEntry[] = [];

  for (const [cleanKey, fileObj] of Object.entries(stripped)) {
    let path: string;
    try {
      path = normalisePath(cleanKey);
    } catch {
      continue;
    }
    if (!path) continue;
    if (isBinaryPath(path)) {
      const buf = await fileObj.arrayBuffer();
      entries.push({ path, content: uint8ToBase64(new Uint8Array(buf)), encoding: 'base64' });
    } else {
      const text = await fileObj.text();
      entries.push({ path, content: text, encoding: 'utf8' });
    }
  }
  return entries;
}

export async function importZipIntoExistingProject(
  projectId: string,
  file: File
): Promise<{ count: number; entry?: string }> {
  const entries = await extractZipEntries(file);
  if (entries.length > 0) {
    await vfs.writeMany(projectId, entries);
  }
  await ensureBrainFiles(projectId);
  if (entries.length > 0) {
    const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
    await runProjectScaffoldDoctor(projectId, { source: 'zip-import', force: true });
  }
  await rebuildBrainIndex(projectId);
  const snap = await vfs.snapshot(projectId);
  const det = detectProjectType(snap);
  return { count: entries.length, entry: det.entry };
}

export async function importFolderIntoExistingProject(
  projectId: string,
  files: FileList | File[]
): Promise<{ count: number; entry?: string }> {
  const entries = await extractFolderEntries(files);
  if (entries.length > 0) {
    await vfs.writeMany(projectId, entries);
  }
  await ensureBrainFiles(projectId);
  if (entries.length > 0) {
    const { runProjectScaffoldDoctor } = await import('@/lib/agent/verify');
    await runProjectScaffoldDoctor(projectId, { source: 'zip-import', force: true });
  }
  await rebuildBrainIndex(projectId);
  const snap = await vfs.snapshot(projectId);
  const det = detectProjectType(snap);
  return { count: entries.length, entry: det.entry };
}

export function inferStackFromPaths(paths: string[]): ProjectRecord['stack'] {
  if (
    paths.some(
      (p) =>
        p.startsWith('app/') ||
        p.startsWith('src/app/') ||
        p.startsWith('pages/') ||
        p.startsWith('src/pages/') ||
        /^next\.config\./.test(p)
    )
  ) {
    return 'next';
  }
  if (paths.some((p) => p.endsWith('.tsx') || p.endsWith('.jsx'))) {
    return 'react';
  }
  if (paths.includes('index.html') || paths.includes('public/index.html')) {
    return 'html';
  }
  if (paths.some((p) => p.endsWith('.py'))) {
    return 'python';
  }
  return 'blank';
}
