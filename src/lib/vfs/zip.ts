import JSZip from 'jszip';
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

export async function downloadProjectZip(projectId: string, projectName: string): Promise<void> {
  const db = await getKalpaDB();
  const rows = await db.getAllFromIndex('files', 'by-project', projectId);
  const zip = new JSZip();
  for (const row of rows) {
    if (row.path.endsWith('/.gitkeep')) continue;
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
  const rawPaths = Object.keys(zip.files).filter((k) => !zip.files[k].dir);

  // Strip common single top-level directory if all files share one
  let commonRoot = '';
  if (rawPaths.length > 0 && rawPaths.every((p) => p.includes('/'))) {
    const firstSeg = rawPaths[0].split('/')[0];
    if (firstSeg && rawPaths.every((p) => p.startsWith(`${firstSeg}/`))) {
      commonRoot = `${firstSeg}/`;
    }
  }

  const entries: VfsWriteEntry[] = [];
  for (const rawKey of rawPaths) {
    const zipObj = zip.files[rawKey];
    if (zipObj.dir) continue;
    const stripped = commonRoot && rawKey.startsWith(commonRoot) ? rawKey.slice(commonRoot.length) : rawKey;
    if (
      !stripped ||
      stripped.startsWith('__MACOSX') ||
      stripped.includes('/.DS_Store') ||
      stripped === '.DS_Store' ||
      stripped.startsWith('node_modules/') ||
      stripped.startsWith('.git/')
    ) {
      continue;
    }
    let path: string;
    try {
      path = normalisePath(stripped);
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

export async function importZipIntoExistingProject(projectId: string, file: File): Promise<number> {
  const entries = await extractZipEntries(file);
  if (entries.length > 0) {
    await vfs.writeMany(projectId, entries);
  }
  return entries.length;
}

export function inferStackFromPaths(paths: string[]): ProjectRecord['stack'] {
  if (paths.some((p) => p.startsWith('app/') || p.startsWith('src/app/') || p.startsWith('pages/'))) {
    return 'next';
  }
  if (paths.some((p) => p.endsWith('.tsx') || p.endsWith('.jsx'))) {
    return 'react';
  }
  if (paths.includes('index.html')) {
    return 'html';
  }
  if (paths.some((p) => p.endsWith('.py'))) {
    return 'python';
  }
  return 'blank';
}
