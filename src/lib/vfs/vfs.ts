import {
  getKalpaDB,
  makeFileKey,
  type FileEncoding,
  type FileRecord,
} from './db';
import {
  MAX_PROJECT_FILES,
  MAX_TEXT_FILE_BYTES,
  isBinaryPath,
  normalisePath,
  validatePath,
} from './paths';

export interface VfsFileMeta {
  path: string;
  encoding: FileEncoding;
  hash: string;
  updatedAt: number;
  size: number;
}

export interface VfsWriteEntry {
  path: string;
  content: string;
  encoding?: FileEncoding;
}

type VfsListener = () => void;

const listenersByProject = new Map<string, Set<VfsListener>>();
let channel: BroadcastChannel | null = null;

function ensureChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!channel) {
    channel = new BroadcastChannel('kalpa-vfs-sync');
    channel.onmessage = (ev) => {
      const pid = ev.data?.projectId;
      if (typeof pid === 'string') {
        notifyLocal(pid);
      }
    };
  }
  return channel;
}

function notifyLocal(projectId: string) {
  const set = listenersByProject.get(projectId);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      // ignore listener errors
    }
  }
}

function emitChange(projectId: string) {
  notifyLocal(projectId);
  try {
    ensureChannel()?.postMessage({ projectId, t: Date.now() });
  } catch {
    // ignore broadcast error
  }
}

function quickHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

async function touchProjectTimestamp(projectId: string) {
  const db = await getKalpaDB();
  const proj = await db.get('projects', projectId);
  if (proj) {
    proj.updatedAt = Date.now();
    await db.put('projects', proj);
  }
}

export const vfs = {
  async list(projectId: string): Promise<VfsFileMeta[]> {
    const db = await getKalpaDB();
    const rows = await db.getAllFromIndex('files', 'by-project', projectId);
    return rows
      .map((r) => ({
        path: r.path,
        encoding: r.encoding,
        hash: r.hash,
        updatedAt: r.updatedAt,
        size: r.encoding === 'base64' ? Math.floor((r.content.length * 3) / 4) : r.content.length,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },

  async read(
    projectId: string,
    rawPath: string
  ): Promise<{ content: string; encoding: FileEncoding; updatedAt: number } | null> {
    const path = validatePath(rawPath);
    const db = await getKalpaDB();
    const row = await db.get('files', makeFileKey(projectId, path));
    if (!row) return null;
    return { content: row.content, encoding: row.encoding, updatedAt: row.updatedAt };
  },

  async write(
    projectId: string,
    rawPath: string,
    content: string,
    encoding?: FileEncoding
  ): Promise<void> {
    const path = validatePath(rawPath);
    const enc: FileEncoding = encoding ?? (isBinaryPath(path) ? 'base64' : 'utf8');
    if (enc === 'utf8') {
      const byteLen = new TextEncoder().encode(content).byteLength;
      if (byteLen > MAX_TEXT_FILE_BYTES) {
        throw new Error(`File "${path}" exceeds the 2 MB text file limit`);
      }
    }
    const db = await getKalpaDB();
    const existing = await db.get('files', makeFileKey(projectId, path));
    if (!existing) {
      const currentAll = await db.getAllKeysFromIndex('files', 'by-project', projectId);
      if (currentAll.length >= MAX_PROJECT_FILES) {
        throw new Error(`Project cannot exceed ${MAX_PROJECT_FILES} files`);
      }
    }
    const now = Date.now();
    const record: FileRecord = {
      key: makeFileKey(projectId, path),
      projectId,
      path,
      content,
      encoding: enc,
      hash: quickHash(content),
      updatedAt: now,
    };
    await db.put('files', record);
    await touchProjectTimestamp(projectId);
    emitChange(projectId);
  },

  async writeMany(projectId: string, entries: VfsWriteEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (entries.length > MAX_PROJECT_FILES) {
      throw new Error(`Cannot write more than ${MAX_PROJECT_FILES} files in a project`);
    }
    const db = await getKalpaDB();
    const tx = db.transaction(['files', 'projects'], 'readwrite');
    const now = Date.now();

    for (const entry of entries) {
      const path = validatePath(entry.path);
      const enc: FileEncoding = entry.encoding ?? (isBinaryPath(path) ? 'base64' : 'utf8');
      if (enc === 'utf8' && entry.content.length > MAX_TEXT_FILE_BYTES) {
        throw new Error(`File "${path}" exceeds the 2 MB text file limit`);
      }
      await tx.objectStore('files').put({
        key: makeFileKey(projectId, path),
        projectId,
        path,
        content: entry.content,
        encoding: enc,
        hash: quickHash(entry.content),
        updatedAt: now,
      });
    }

    const proj = await tx.objectStore('projects').get(projectId);
    if (proj) {
      proj.updatedAt = now;
      await tx.objectStore('projects').put(proj);
    }
    await tx.done;
    emitChange(projectId);
  },

  async remove(projectId: string, pathOrFolder: string): Promise<number> {
    const norm = normalisePath(pathOrFolder);
    if (!norm) return 0;
    const db = await getKalpaDB();
    const all = await db.getAllFromIndex('files', 'by-project', projectId);
    const prefix = `${norm}/`;
    const toDelete = all.filter((r) => r.path === norm || r.path.startsWith(prefix));
    if (toDelete.length === 0) return 0;

    const tx = db.transaction(['files', 'projects'], 'readwrite');
    for (const row of toDelete) {
      await tx.objectStore('files').delete(row.key);
    }
    const proj = await tx.objectStore('projects').get(projectId);
    if (proj) {
      proj.updatedAt = Date.now();
      await tx.objectStore('projects').put(proj);
    }
    await tx.done;
    emitChange(projectId);
    return toDelete.length;
  },

  async move(projectId: string, fromRaw: string, toRaw: string): Promise<void> {
    const from = validatePath(fromRaw);
    const to = validatePath(toRaw);
    if (from === to) return;

    const db = await getKalpaDB();
    const all = await db.getAllFromIndex('files', 'by-project', projectId);
    const prefix = `${from}/`;
    const matches = all.filter((r) => r.path === from || r.path.startsWith(prefix));
    if (matches.length === 0) {
      throw new Error(`Path not found: ${from}`);
    }

    const now = Date.now();
    const tx = db.transaction(['files', 'projects'], 'readwrite');
    for (const row of matches) {
      const nextPath = row.path === from ? to : `${to}/${row.path.slice(prefix.length)}`;
      validatePath(nextPath);
      await tx.objectStore('files').delete(row.key);
      await tx.objectStore('files').put({
        ...row,
        key: makeFileKey(projectId, nextPath),
        path: nextPath,
        updatedAt: now,
      });
    }
    const proj = await tx.objectStore('projects').get(projectId);
    if (proj) {
      proj.updatedAt = now;
      await tx.objectStore('projects').put(proj);
    }
    await tx.done;
    emitChange(projectId);
  },

  async exists(projectId: string, rawPath: string): Promise<boolean> {
    const norm = normalisePath(rawPath);
    if (!norm) return true;
    const db = await getKalpaDB();
    const exact = await db.get('files', makeFileKey(projectId, norm));
    if (exact) return true;
    const all = await db.getAllFromIndex('files', 'by-project', projectId);
    const prefix = `${norm}/`;
    return all.some((r) => r.path.startsWith(prefix));
  },

  async snapshot(projectId: string): Promise<Record<string, string>> {
    const db = await getKalpaDB();
    const rows = await db.getAllFromIndex('files', 'by-project', projectId);
    const out: Record<string, string> = {};
    for (const row of rows) {
      if (row.encoding === 'utf8') {
        out[row.path] = row.content;
      }
    }
    return out;
  },

  subscribe(projectId: string, cb: VfsListener): () => void {
    ensureChannel();
    let set = listenersByProject.get(projectId);
    if (!set) {
      set = new Set();
      listenersByProject.set(projectId, set);
    }
    set.add(cb);
    return () => {
      const s = listenersByProject.get(projectId);
      if (s) {
        s.delete(cb);
        if (s.size === 0) listenersByProject.delete(projectId);
      }
    };
  },
};
