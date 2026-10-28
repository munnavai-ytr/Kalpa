'use client';

import { create } from 'zustand';
import { getKalpaDB, type ProjectRecord, type StackKind } from '@/lib/vfs/db';
import { vfs, type VfsFileMeta } from '@/lib/vfs/vfs';
import { getDefaultOpenFile, getStarterFiles } from '@/lib/vfs/starters';
import { extractZipEntries, inferStackFromPaths } from '@/lib/vfs/zip';
import { uid } from '@/lib/utils';

export type UserEditListener = (event: { projectId: string; path: string; content: string }) => void;

const editListeners = new Set<UserEditListener>();

export function onUserEdit(listener: UserEditListener): () => void {
  editListeners.add(listener);
  return () => {
    editListeners.delete(listener);
  };
}

function emitUserEdit(projectId: string, path: string, content: string) {
  for (const fn of editListeners) {
    try {
      fn({ projectId, path, content });
    } catch {
      // ignore listener errors
    }
  }
}

interface ProjectStoreState {
  projects: ProjectRecord[];
  loadingProjects: boolean;

  currentProject: ProjectRecord | null;
  files: VfsFileMeta[];
  snapshot: Record<string, string>;
  openTabs: string[];
  activeFilePath: string | null;
  targetLine: { path: string; line: number; seq: number } | null;
  dirtyBuffers: Record<string, string>;

  loadProjects: () => Promise<void>;
  createProject: (opts: {
    name?: string;
    stack: StackKind;
    engine?: 'instant' | 'cloud';
    initialPrompt?: string;
  }) => Promise<ProjectRecord>;
  renameProject: (id: string, name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<ProjectRecord | null>;
  deleteProject: (id: string) => Promise<void>;
  importProjectFromZip: (file: File) => Promise<ProjectRecord>;

  openWorkspace: (projectId: string) => Promise<boolean>;
  refreshWorkspaceFiles: () => Promise<void>;
  openFile: (path: string, opts?: { line?: number }) => void;
  closeTab: (path: string) => void;
  getOpenFiles: () => string[];
  setDirtyBuffer: (path: string, content: string) => void;
  flushBufferToVfs: (path: string, content?: string) => Promise<void>;
}

let activeUnsubscribe: (() => void) | null = null;

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  loadingProjects: true,
  currentProject: null,
  files: [],
  snapshot: {},
  openTabs: [],
  activeFilePath: null,
  targetLine: null,
  dirtyBuffers: {},

  loadProjects: async () => {
    set({ loadingProjects: true });
    try {
      const db = await getKalpaDB();
      const all = await db.getAll('projects');
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      set({ projects: all, loadingProjects: false });
    } catch {
      set({ loadingProjects: false });
    }
  },

  createProject: async ({ name, stack, engine = 'instant', initialPrompt }) => {
    const db = await getKalpaDB();
    const now = Date.now();
    const id = uid('proj');
    const derivedName =
      name?.trim() ||
      (initialPrompt
        ? initialPrompt
            .trim()
            .split(/\s+/)
            .slice(0, 4)
            .join(' ')
            .slice(0, 36)
        : `Untitled ${stack === 'auto' ? 'App' : stack}`);

    const record: ProjectRecord = {
      id,
      name: derivedName || 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      stack,
      engine,
    };

    await db.put('projects', record);
    const starterMap = getStarterFiles(stack);
    await vfs.writeMany(
      id,
      Object.entries(starterMap).map(([path, content]) => ({ path, content, encoding: 'utf8' }))
    );

    if (initialPrompt && initialPrompt.trim()) {
      await db.put('chat', {
        id: uid('msg'),
        projectId: id,
        role: 'user',
        content: initialPrompt.trim(),
        createdAt: now,
      });
    }

    await get().loadProjects();
    return record;
  },

  renameProject: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getKalpaDB();
    const proj = await db.get('projects', id);
    if (!proj) return;
    proj.name = trimmed;
    proj.updatedAt = Date.now();
    await db.put('projects', proj);
    if (get().currentProject?.id === id) {
      set({ currentProject: { ...proj } });
    }
    await get().loadProjects();
  },

  duplicateProject: async (id) => {
    const db = await getKalpaDB();
    const orig = await db.get('projects', id);
    if (!orig) return null;
    const now = Date.now();
    const newId = uid('proj');
    const copy: ProjectRecord = {
      ...orig,
      id: newId,
      name: `${orig.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };
    await db.put('projects', copy);
    const origFiles = await db.getAllFromIndex('files', 'by-project', id);
    if (origFiles.length > 0) {
      await vfs.writeMany(
        newId,
        origFiles.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding }))
      );
    }
    await get().loadProjects();
    return copy;
  },

  deleteProject: async (id) => {
    const db = await getKalpaDB();
    const tx = db.transaction(['projects', 'files', 'chat', 'checkpoints', 'memory'], 'readwrite');
    await tx.objectStore('projects').delete(id);

    const fileKeys = await tx.objectStore('files').index('by-project').getAllKeys(id);
    for (const k of fileKeys) await tx.objectStore('files').delete(k);

    const chatKeys = await tx.objectStore('chat').index('by-project').getAllKeys(id);
    for (const k of chatKeys) await tx.objectStore('chat').delete(k);

    const cpKeys = await tx.objectStore('checkpoints').index('by-project').getAllKeys(id);
    for (const k of cpKeys) await tx.objectStore('checkpoints').delete(k);

    const memKeys = await tx.objectStore('memory').index('by-project').getAllKeys(id);
    for (const k of memKeys) await tx.objectStore('memory').delete(k);

    await tx.done;
    if (get().currentProject?.id === id) {
      set({ currentProject: null, files: [], snapshot: {}, openTabs: [], activeFilePath: null });
    }
    await get().loadProjects();
  },

  importProjectFromZip: async (file) => {
    const entries = await extractZipEntries(file);
    const paths = entries.map((e) => e.path);
    const stack = inferStackFromPaths(paths);
    const baseName = file.name.replace(/\.zip$/i, '').trim() || 'Imported Project';
    const db = await getKalpaDB();
    const now = Date.now();
    const id = uid('proj');
    const record: ProjectRecord = {
      id,
      name: baseName.slice(0, 48),
      createdAt: now,
      updatedAt: now,
      stack,
      engine: 'instant',
    };
    await db.put('projects', record);
    if (entries.length > 0) {
      await vfs.writeMany(id, entries);
    } else {
      await vfs.write(id, 'README.md', `# ${record.name}\n`);
    }
    await get().loadProjects();
    return record;
  },

  openWorkspace: async (projectId) => {
    if (activeUnsubscribe) {
      activeUnsubscribe();
      activeUnsubscribe = null;
    }
    const db = await getKalpaDB();
    const proj = await db.get('projects', projectId);
    if (!proj) {
      set({ currentProject: null, files: [], snapshot: {}, openTabs: [], activeFilePath: null });
      return false;
    }
    const [files, snapshot] = await Promise.all([vfs.list(projectId), vfs.snapshot(projectId)]);
    const visiblePaths = files
      .map((f) => f.path)
      .filter((p) => !p.endsWith('/.gitkeep') && !p.startsWith('.kalpa/'));
    const initialFile = getDefaultOpenFile(proj.stack, visiblePaths);
    set({
      currentProject: proj,
      files,
      snapshot,
      openTabs: initialFile ? [initialFile] : [],
      activeFilePath: initialFile,
      dirtyBuffers: {},
      targetLine: null,
    });

    activeUnsubscribe = vfs.subscribe(projectId, () => {
      get().refreshWorkspaceFiles();
    });
    return true;
  },

  refreshWorkspaceFiles: async () => {
    const proj = get().currentProject;
    if (!proj) return;
    const [files, snapshot] = await Promise.all([vfs.list(proj.id), vfs.snapshot(proj.id)]);
    const existingSet = new Set(files.map((f) => f.path));
    const openTabs = get().openTabs.filter((t) => existingSet.has(t));
    let activeFilePath = get().activeFilePath;
    if (activeFilePath && !existingSet.has(activeFilePath)) {
      activeFilePath = openTabs[openTabs.length - 1] ?? null;
    }
    set({ files, snapshot, openTabs, activeFilePath });
  },

  openFile: (path, opts) => {
    const tabs = get().openTabs;
    const nextTabs = tabs.includes(path) ? tabs : [...tabs, path];
    set({
      openTabs: nextTabs,
      activeFilePath: path,
      targetLine: opts?.line ? { path, line: opts.line, seq: Date.now() } : get().targetLine,
    });
  },

  closeTab: (path) => {
    const { openTabs, activeFilePath, dirtyBuffers } = get();
    const idx = openTabs.indexOf(path);
    const nextTabs = openTabs.filter((t) => t !== path);
    const nextDirty = { ...dirtyBuffers };
    delete nextDirty[path];
    let nextActive = activeFilePath;
    if (activeFilePath === path) {
      nextActive = nextTabs[Math.max(0, idx - 1)] ?? nextTabs[0] ?? null;
    }
    set({ openTabs: nextTabs, activeFilePath: nextActive, dirtyBuffers: nextDirty });
  },

  getOpenFiles: () => get().openTabs,

  setDirtyBuffer: (path, content) => {
    set((s) => ({
      dirtyBuffers: { ...s.dirtyBuffers, [path]: content },
    }));
  },

  flushBufferToVfs: async (path, explicitContent) => {
    const proj = get().currentProject;
    if (!proj) return;
    const content = explicitContent ?? get().dirtyBuffers[path];
    if (content === undefined) return;
    await vfs.write(proj.id, path, content);
    set((s) => {
      const next = { ...s.dirtyBuffers };
      delete next[path];
      return { dirtyBuffers: next };
    });
    emitUserEdit(proj.id, path, content);
  },
}));
