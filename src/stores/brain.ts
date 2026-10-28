'use client';

import { create } from 'zustand';
import {
  BRAIN_MEMORY_FILES,
  MEMORY_MAX_CHARS,
  memoryFileToPath,
  type BrainMemoryFile,
} from '@/lib/brain/caps';
import { BRAIN_TEMPLATES } from '@/lib/brain/templates';
import { ensureBrainFiles, readAllBrainMemory } from '@/lib/brain/files';
import {
  readOrBuildBrainIndex,
  rebuildBrainIndex,
  type ProjectBrainIndex,
} from '@/lib/brain/index';
import { createCheckpoint } from '@/lib/checkpoints/checkpoints';
import { streamChat } from '@/lib/providers/core';
import { useProviderStore } from '@/lib/providers/store';
import { vfs } from '@/lib/vfs/vfs';

export interface CompactProposal {
  file: BrainMemoryFile;
  before: string;
  after: string;
}

interface BrainStoreState {
  projectId: string | null;
  memory: Record<BrainMemoryFile, string>;
  index: ProjectBrainIndex | null;
  loading: boolean;
  compacting: boolean;
  compactProposal: CompactProposal | null;

  brainOpen: boolean;
  historyOpen: boolean;
  exportOpen: boolean;

  setBrainOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
  setExportOpen: (open: boolean) => void;

  loadBrain: (projectId: string) => Promise<void>;
  refreshBrainFromVfs: (projectId: string) => Promise<void>;
  saveUserMemoryFile: (projectId: string, file: BrainMemoryFile, content: string) => Promise<void>;
  compactFileWithAi: (projectId: string, file: BrainMemoryFile) => Promise<void>;
  acceptCompactProposal: (projectId: string) => Promise<void>;
  discardCompactProposal: () => void;
  resetAllMemory: (projectId: string) => Promise<void>;
  exportBrainDownload: (projectId: string, projectName: string) => Promise<void>;
}

export const useBrainStore = create<BrainStoreState>((set, get) => ({
  projectId: null,
  memory: { ...BRAIN_TEMPLATES },
  index: null,
  loading: false,
  compacting: false,
  compactProposal: null,

  brainOpen: false,
  historyOpen: false,
  exportOpen: false,

  setBrainOpen: (brainOpen) => set({ brainOpen }),
  setHistoryOpen: (historyOpen) => set({ historyOpen }),
  setExportOpen: (exportOpen) => set({ exportOpen }),

  loadBrain: async (projectId) => {
    set({ loading: true, projectId, compactProposal: null });
    await ensureBrainFiles(projectId);
    const [memory, index] = await Promise.all([
      readAllBrainMemory(projectId),
      rebuildBrainIndex(projectId),
    ]);
    set({ memory, index, loading: false });
  },

  refreshBrainFromVfs: async (projectId) => {
    const [memory, index] = await Promise.all([
      readAllBrainMemory(projectId),
      readOrBuildBrainIndex(projectId),
    ]);
    set({ projectId, memory, index });
  },

  saveUserMemoryFile: async (projectId, file, content) => {
    if (content.length > MEMORY_MAX_CHARS) {
      throw new Error(`Memory file exceeds the ${MEMORY_MAX_CHARS.toLocaleString()} character cap.`);
    }
    const normalized = content.endsWith('\n') ? content : `${content}\n`;
    await vfs.write(projectId, memoryFileToPath(file), normalized, 'utf8');
    await createCheckpoint(projectId, `Edited Brain: ${file}.md`);
    if (file === 'architecture') {
      const index = await rebuildBrainIndex(projectId);
      set((s) => ({
        memory: { ...s.memory, [file]: normalized },
        index,
      }));
    } else {
      set((s) => ({
        memory: { ...s.memory, [file]: normalized },
      }));
    }
  },

  compactFileWithAi: async (projectId, file) => {
    const profile = useProviderStore.getState().getActiveProfile();
    if (!profile || (!profile.apiKey && !/localhost|127\.0\.0\.1/.test(profile.baseUrl))) {
      throw new Error('Configure an active AI provider key before compacting with AI.');
    }
    const before = get().memory[file] ?? '';
    if (!before.trim()) return;

    set({ compacting: true, compactProposal: null });
    try {
      let out = '';
      const prompt = [
        `Rewrite this Kalpa project memory file (${file}.md) to be significantly more concise (at least 35% shorter, strictly under 8,000 characters) while preserving EVERY architectural decision, constraint, user goal, milestone status, and convention.`,
        'Output ONLY the clean markdown content for the file — no code fences wrapping the whole document, no commentary.',
        '',
        before,
      ].join('\n');

      for await (const ev of streamChat(profile, [{ role: 'user', content: prompt }])) {
        if (ev.delta) out += ev.delta;
      }
      const cleaned = out
        .trim()
        .replace(/^```(?:markdown|md)?\n/i, '')
        .replace(/\n```$/, '')
        .trim();

      if (!cleaned) {
        throw new Error('Model returned an empty compaction result.');
      }
      set({
        compacting: false,
        compactProposal: {
          file,
          before,
          after: `${cleaned}\n`.slice(0, MEMORY_MAX_CHARS),
        },
      });
    } catch (err) {
      set({ compacting: false });
      throw err;
    } finally {
      void projectId;
    }
  },

  acceptCompactProposal: async (projectId) => {
    const prop = get().compactProposal;
    if (!prop) return;
    await get().saveUserMemoryFile(projectId, prop.file, prop.after);
    set({ compactProposal: null });
  },

  discardCompactProposal: () => set({ compactProposal: null }),

  resetAllMemory: async (projectId) => {
    await createCheckpoint(projectId, 'Before Brain reset');
    const entries = BRAIN_MEMORY_FILES.map((f) => ({
      path: memoryFileToPath(f),
      content: BRAIN_TEMPLATES[f],
      encoding: 'utf8' as const,
    }));
    await vfs.writeMany(projectId, entries);
    const index = await rebuildBrainIndex(projectId);
    set({ memory: { ...BRAIN_TEMPLATES }, index, compactProposal: null });
  },

  exportBrainDownload: async (projectId, projectName) => {
    const [memory, index] = await Promise.all([
      readAllBrainMemory(projectId),
      readOrBuildBrainIndex(projectId),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      projectId,
      projectName,
      memory,
      index,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = projectName.toLowerCase().replace(/[^a-z0-9-_]+/g, '-') || 'project';
    a.href = url;
    a.download = `${slug}-brain.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
}));
