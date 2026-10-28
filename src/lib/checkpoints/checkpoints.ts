import {
  getKalpaDB,
  makeFileKey,
  type CheckpointRecord,
  type FileEncoding,
} from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import { uid } from '@/lib/utils';

const MAX_CHECKPOINTS_PER_PROJECT = 60;

async function sha1Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodeBlobPayload(encoding: FileEncoding, content: string): string {
  return `${encoding}\n${content}`;
}

function decodeBlobPayload(payload: string): { encoding: FileEncoding; content: string } {
  const nl = payload.indexOf('\n');
  if (nl > 0) {
    const head = payload.slice(0, nl);
    if (head === 'utf8' || head === 'base64') {
      return { encoding: head, content: payload.slice(nl + 1) };
    }
  }
  return { encoding: 'utf8', content: payload };
}

export async function createCheckpoint(
  projectId: string,
  label: string,
  turnId?: string
): Promise<CheckpointRecord> {
  const db = await getKalpaDB();
  const fileRows = await db.getAllFromIndex('files', 'by-project', projectId);

  const tree: Record<string, string> = {};
  const blobsToWrite: { hash: string; content: string }[] = [];

  for (const row of fileRows) {
    if (row.path.endsWith('/.gitkeep')) continue;
    const payload = encodeBlobPayload(row.encoding, row.content);
    const hash = await sha1Hex(payload);
    tree[row.path] = hash;
    blobsToWrite.push({ hash, content: payload });
  }

  const record: CheckpointRecord = {
    id: uid('cp'),
    projectId,
    createdAt: Date.now(),
    label: label.trim().slice(0, 60) || 'Checkpoint',
    turnId,
    tree,
  };

  const tx = db.transaction(['blobs', 'checkpoints'], 'readwrite');
  for (const b of blobsToWrite) {
    const exists = await tx.objectStore('blobs').getKey(b.hash);
    if (!exists) {
      await tx.objectStore('blobs').put(b);
    }
  }
  await tx.objectStore('checkpoints').put(record);
  await tx.done;

  await pruneOldCheckpoints(projectId);
  return record;
}

async function pruneOldCheckpoints(projectId: string): Promise<void> {
  const db = await getKalpaDB();
  const list = await db.getAllFromIndex('checkpoints', 'by-project', projectId);
  if (list.length <= MAX_CHECKPOINTS_PER_PROJECT) return;

  list.sort((a, b) => a.createdAt - b.createdAt);
  const toDelete = list.slice(0, list.length - MAX_CHECKPOINTS_PER_PROJECT);

  const delTx = db.transaction('checkpoints', 'readwrite');
  for (const cp of toDelete) {
    await delTx.store.delete(cp.id);
  }
  await delTx.done;

  // Garbage-collect unreferenced blobs across all remaining checkpoints
  const allCheckpoints = await db.getAll('checkpoints');
  const referencedHashes = new Set<string>();
  for (const cp of allCheckpoints) {
    for (const h of Object.values(cp.tree)) {
      referencedHashes.add(h);
    }
  }
  const allBlobKeys = await db.getAllKeys('blobs');
  const orphanKeys = allBlobKeys.filter((k) => !referencedHashes.has(k));
  if (orphanKeys.length > 0) {
    const blobTx = db.transaction('blobs', 'readwrite');
    for (const k of orphanKeys) {
      await blobTx.store.delete(k);
    }
    await blobTx.done;
  }
}

export async function listCheckpoints(projectId: string): Promise<CheckpointRecord[]> {
  const db = await getKalpaDB();
  const list = await db.getAllFromIndex('checkpoints', 'by-project', projectId);
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

export interface CheckpointDiffSummary {
  added: string[];
  removed: string[];
  modified: string[];
}

export function diffCheckpointTrees(
  beforeTree: Record<string, string>,
  afterTree: Record<string, string>
): CheckpointDiffSummary {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [path, hash] of Object.entries(afterTree)) {
    if (!(path in beforeTree)) added.push(path);
    else if (beforeTree[path] !== hash) modified.push(path);
  }
  for (const path of Object.keys(beforeTree)) {
    if (!(path in afterTree)) removed.push(path);
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    modified: modified.sort(),
  };
}

export function diffCheckpoints(
  a: CheckpointRecord,
  b: CheckpointRecord
): CheckpointDiffSummary {
  return diffCheckpointTrees(a.tree, b.tree);
}

export async function getBlobText(hash?: string): Promise<string> {
  if (!hash) return '';
  const db = await getKalpaDB();
  const rec = await db.get('blobs', hash);
  if (!rec) return '';
  const decoded = decodeBlobPayload(rec.content);
  return decoded.encoding === 'utf8' ? decoded.content : `[Binary file (${decoded.content.length} base64 chars)]`;
}

export async function restoreCheckpoint(
  checkpointId: string,
  opts?: { skipBeforeBackup?: boolean }
): Promise<{ backupCheckpoint?: CheckpointRecord }> {
  const db = await getKalpaDB();
  const target = await db.get('checkpoints', checkpointId);
  if (!target) {
    throw new Error('Checkpoint not found');
  }

  let backupCheckpoint: CheckpointRecord | undefined;
  if (!opts?.skipBeforeBackup) {
    backupCheckpoint = await createCheckpoint(
      target.projectId,
      `before restore (${target.label.slice(0, 32)})`
    );
  }

  const currentRows = await db.getAllFromIndex('files', 'by-project', target.projectId);
  const currentByPath = new Map(currentRows.map((r) => [r.path, r]));

  const entriesToWrite: { path: string; content: string; encoding: FileEncoding }[] = [];
  for (const [path, hash] of Object.entries(target.tree)) {
    const blob = await db.get('blobs', hash);
    if (!blob) continue;
    const decoded = decodeBlobPayload(blob.content);
    const cur = currentByPath.get(path);
    if (!cur || cur.content !== decoded.content || cur.encoding !== decoded.encoding) {
      entriesToWrite.push({
        path,
        content: decoded.content,
        encoding: decoded.encoding,
      });
    }
  }

  const pathsToDelete = currentRows
    .map((r) => r.path)
    .filter((p) => !p.endsWith('/.gitkeep') && !(p in target.tree));

  if (pathsToDelete.length > 0) {
    const tx = db.transaction('files', 'readwrite');
    for (const p of pathsToDelete) {
      await tx.store.delete(makeFileKey(target.projectId, p));
    }
    await tx.done;
  }

  if (entriesToWrite.length > 0) {
    await vfs.writeMany(target.projectId, entriesToWrite);
  } else if (pathsToDelete.length > 0) {
    // Trigger VFS change notification when only deletions happened
    const probe = Object.keys(target.tree)[0];
    if (probe) {
      const existing = await vfs.read(target.projectId, probe);
      if (existing) await vfs.write(target.projectId, probe, existing.content, existing.encoding);
    }
  }

  return { backupCheckpoint };
}
