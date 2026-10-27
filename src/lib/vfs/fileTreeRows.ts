import type { VfsFileMeta } from './vfs';

export interface TreeRow {
  path: string;
  name: string;
  depth: number;
  isFolder: boolean;
}

export function buildFileTreeRows(
  files: VfsFileMeta[],
  collapsed: Set<string>,
  query: string
): { rows: TreeRow[]; folders: string[] } {
  const folderSet = new Set<string>();
  const cleanFiles: string[] = [];

  for (const f of files) {
    const parts = f.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      folderSet.add(parts.slice(0, i).join('/'));
    }
    if (!f.path.endsWith('/.gitkeep')) {
      cleanFiles.push(f.path);
    }
  }

  const allFolders = Array.from(folderSet).sort();
  const q = query.trim().toLowerCase();

  if (q) {
    const matched = cleanFiles
      .filter((p) => p.toLowerCase().includes(q))
      .map((p) => ({
        path: p,
        name: p,
        depth: 0,
        isFolder: false,
      }));
    return { rows: matched, folders: allFolders };
  }

  const combined: { path: string; isFolder: boolean }[] = [
    ...allFolders.map((p) => ({ path: p, isFolder: true })),
    ...cleanFiles.map((p) => ({ path: p, isFolder: false })),
  ];

  combined.sort((a, b) => {
    const aParts = a.path.split('/');
    const bParts = b.path.split('/');
    const len = Math.min(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      if (aParts[i] !== bParts[i]) {
        const aIsDirHere = i < aParts.length - 1 || a.isFolder;
        const bIsDirHere = i < bParts.length - 1 || b.isFolder;
        if (aIsDirHere !== bIsDirHere) return aIsDirHere ? -1 : 1;
        return aParts[i].localeCompare(bParts[i]);
      }
    }
    return aParts.length - bParts.length;
  });

  const rows: TreeRow[] = [];
  for (const item of combined) {
    const parts = item.path.split('/');
    let hidden = false;
    for (let i = 1; i < parts.length; i++) {
      if (collapsed.has(parts.slice(0, i).join('/'))) {
        hidden = true;
        break;
      }
    }
    if (!hidden) {
      rows.push({
        path: item.path,
        name: parts[parts.length - 1],
        depth: parts.length - 1,
        isFolder: item.isFolder,
      });
    }
  }
  return { rows, folders: allFolders };
}
