import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from 'idb';

export type StackKind = 'auto' | 'next' | 'react' | 'html' | 'python' | 'blank';
export type EngineKind = 'instant' | 'cloud';
export type FileEncoding = 'utf8' | 'base64';

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  stack: StackKind;
  engine: EngineKind;
}

export interface FileRecord {
  key: string; // `${projectId}:${path}`
  projectId: string;
  path: string;
  content: string;
  encoding: FileEncoding;
  hash: string;
  updatedAt: number;
}

export interface BlobRecord {
  hash: string;
  content: string;
}

export interface CheckpointRecord {
  id: string;
  projectId: string;
  createdAt: number;
  label: string;
  turnId?: string;
  tree: Record<string, string>;
}

export interface TurnFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  before: string;
  after: string;
}

export interface ChatRecord {
  id: string;
  projectId: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
  meta?: {
    usage?: { input?: number; output?: number };
    error?: {
      message: string;
      hint?: string;
      kind?: string;
      status?: number;
      rawDetail?: string;
      extraBodyHint?: string;
      suggestProxy?: boolean;
      providerKind?: 'openai' | 'anthropic' | 'gemini';
      baseUrl?: string;
    };
    notices?: string[];
    model?: string;
    providerLabel?: string;
    turnId?: string;
    beforeCheckpointId?: string;
    afterCheckpointId?: string;
    redoCheckpointId?: string;
    durationMs?: number;
    filesChanged?: TurnFileChange[];
    hiddenAutoContinue?: boolean;
    milestoneNext?: string;
    stopped?: boolean;
    plainChat?: boolean;
  };
}

export interface MemoryRecord {
  key: string; // `${projectId}:${file}`
  projectId: string;
  file: string;
  content: string;
  updatedAt: number;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface KalpaDBSchema extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: { 'by-updated': number };
  };
  files: {
    key: string;
    value: FileRecord;
    indexes: { 'by-project': string };
  };
  blobs: {
    key: string;
    value: BlobRecord;
  };
  checkpoints: {
    key: string;
    value: CheckpointRecord;
    indexes: { 'by-project': string };
  };
  chat: {
    key: string;
    value: ChatRecord;
    indexes: { 'by-project': string };
  };
  memory: {
    key: string;
    value: MemoryRecord;
    indexes: { 'by-project': string };
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
}

export const DB_NAME = 'kalpa';
export const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<KalpaDBSchema>> | null = null;

export function getKalpaDB(): Promise<IDBPDatabase<KalpaDBSchema>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this environment'));
  }
  if (!dbPromise) {
    dbPromise = openDB<KalpaDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const pStore = db.createObjectStore('projects', { keyPath: 'id' });
          pStore.createIndex('by-updated', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('files')) {
          const fStore = db.createObjectStore('files', { keyPath: 'key' });
          fStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'hash' });
        }
        if (!db.objectStoreNames.contains('checkpoints')) {
          const cStore = db.createObjectStore('checkpoints', { keyPath: 'id' });
          cStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('chat')) {
          const chatStore = db.createObjectStore('chat', { keyPath: 'id' });
          chatStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('memory')) {
          const mStore = db.createObjectStore('memory', { keyPath: 'key' });
          mStore.createIndex('by-project', 'projectId');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
      blocked() {
        // another tab has an older version open
      },
      blocking() {
        dbPromise?.then((d) => d.close()).catch(() => {});
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    });
  }
  return dbPromise;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getKalpaDB();
  const row = await db.get('settings', key);
  return row?.value as T | undefined;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const db = await getKalpaDB();
  await db.put('settings', { key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getKalpaDB();
  await db.delete('settings', key);
}

export async function resetKalpaDB(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.close();
    } catch {
      // ignore
    }
    dbPromise = null;
  }
  await deleteDB(DB_NAME);
}

export function makeFileKey(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}
