'use client';

import React, { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Download, Eye, Minimize2, Pencil, RotateCcw } from 'lucide-react';
import {
  BRAIN_MEMORY_FILES,
  MEMORY_MAX_CHARS,
  type BrainMemoryFile,
} from '@/lib/brain/caps';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Modal } from '@/components/ui/Modal';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { DiffView } from './DiffView';
import { BrainIndexTable } from './BrainIndexTable';

type BrainTabId = BrainMemoryFile | 'index';

export function BrainPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const openFile = useProjectStore((s) => s.openFile);
  const addToast = useUiStore((s) => s.addToast);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const brainOpen = useBrainStore((s) => s.brainOpen);
  const setBrainOpen = useBrainStore((s) => s.setBrainOpen);
  const memory = useBrainStore((s) => s.memory);
  const index = useBrainStore((s) => s.index);
  const compacting = useBrainStore((s) => s.compacting);
  const compactProposal = useBrainStore((s) => s.compactProposal);
  const refreshBrainFromVfs = useBrainStore((s) => s.refreshBrainFromVfs);
  const saveUserMemoryFile = useBrainStore((s) => s.saveUserMemoryFile);
  const compactFileWithAi = useBrainStore((s) => s.compactFileWithAi);
  const acceptCompactProposal = useBrainStore((s) => s.acceptCompactProposal);
  const discardCompactProposal = useBrainStore((s) => s.discardCompactProposal);
  const resetAllMemory = useBrainStore((s) => s.resetAllMemory);
  const exportBrainDownload = useBrainStore((s) => s.exportBrainDownload);

  const [tab, setTab] = useState<BrainTabId>('brief');
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (brainOpen && currentProject) {
      void refreshBrainFromVfs(currentProject.id);
    }
  }, [brainOpen, currentProject, refreshBrainFromVfs]);

  const activeFileContent = tab !== 'index' ? memory[tab] ?? '' : '';
  const charCount = editMode ? draft.length : activeFileContent.length;
  const pct = Math.min(100, Math.round((charCount / MEMORY_MAX_CHARS) * 100));

  const handleSwitchTab = (next: BrainTabId) => {
    setTab(next);
    setEditMode(false);
    setConfirmReset(false);
    discardCompactProposal();
  };

  const handleSaveEdit = async () => {
    if (!currentProject || tab === 'index') return;
    try {
      await saveUserMemoryFile(currentProject.id, tab, draft);
      setEditMode(false);
      addToast({ title: `Saved ${tab}.md & created checkpoint`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'Cannot save memory file',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    }
  };

  const handleCompact = async () => {
    if (!currentProject || tab === 'index') return;
    try {
      await compactFileWithAi(currentProject.id, tab);
    } catch (err) {
      addToast({
        title: 'Compaction failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    }
  };

  const body = (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-kalpa-border">
        {BRAIN_MEMORY_FILES.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => handleSwitchTab(f)}
            className={`px-3 py-1.5 rounded-[8px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
              tab === f
                ? 'bg-kalpa-violet/20 text-kalpa-text'
                : 'text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface'
            }`}
          >
            {f}
          </button>
        ))}
        <button
          type="button"
          onClick={() => handleSwitchTab('index')}
          className={`px-3 py-1.5 rounded-[8px] text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
            tab === 'index'
              ? 'bg-kalpa-violet/20 text-kalpa-text'
              : 'text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface'
          }`}
        >
          Index ({index?.fileCount ?? 0})
        </button>
      </div>

      {tab === 'index' ? (
        <BrainIndexTable
          index={index}
          onOpenFile={(path) => {
            openFile(path);
            setActiveIdeTab('code');
            setBrainOpen(false);
          }}
        />
      ) : (
        <div className="space-y-3">
          {/* Size meter + actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-[200px]">
              <div className="w-28 h-1.5 rounded-full bg-kalpa-surface overflow-hidden">
                <div
                  style={{ width: `${pct}%` }}
                  className={`h-full ${
                    charCount > MEMORY_MAX_CHARS
                      ? 'bg-kalpa-danger'
                      : pct > 80
                        ? 'bg-kalpa-warn'
                        : 'bg-kalpa-violet'
                  }`}
                />
              </div>
              <span className="text-xs font-mono tabular-nums text-kalpa-muted">
                {charCount.toLocaleString()} / {MEMORY_MAX_CHARS.toLocaleString()} chars
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={editMode ? <Eye className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                onClick={() => {
                  if (!editMode) setDraft(activeFileContent);
                  setEditMode((v) => !v);
                }}
              >
                {editMode ? 'Preview' : 'Edit'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                loading={compacting}
                leftIcon={<Minimize2 className="w-3.5 h-3.5" />}
                onClick={handleCompact}
              >
                Compact with AI
              </Button>
            </div>
          </div>

          {/* Compaction Diff Proposal */}
          {compactProposal && compactProposal.file === tab ? (
            <div className="p-3 rounded-[12px] border border-kalpa-violet/40 bg-kalpa-violet/10 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-kalpa-text">
                  Proposed compaction ({compactProposal.before.length.toLocaleString()} →{' '}
                  {compactProposal.after.length.toLocaleString()} chars)
                </span>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" onClick={discardCompactProposal}>
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    leftIcon={<Check className="w-3.5 h-3.5" />}
                    onClick={() => currentProject && acceptCompactProposal(currentProject.id)}
                  >
                    Accept
                  </Button>
                </div>
              </div>
              <DiffView
                path={`.kalpa/${tab}.md`}
                before={compactProposal.before}
                after={compactProposal.after}
                maxHeightClass="max-h-56"
              />
            </div>
          ) : null}

          {editMode ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="w-full p-3 rounded-[12px] bg-kalpa-bg border border-kalpa-border font-mono text-xs text-kalpa-text leading-relaxed focus:outline-none focus:border-kalpa-violet"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={draft.length > MEMORY_MAX_CHARS}
                  onClick={handleSaveEdit}
                >
                  Save &amp; Checkpoint
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-[12px] bg-kalpa-bg border border-kalpa-border max-h-[48vh] overflow-y-auto text-sm text-kalpa-text space-y-2 leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]}>{activeFileContent}</Markdown>
            </div>
          )}
        </div>
      )}

      {/* Footer Actions */}
      <div className="pt-2 border-t border-kalpa-border flex flex-wrap items-center justify-between gap-2">
        {confirmReset ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-kalpa-danger font-medium">Reset all Brain files to blank templates?</span>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                if (!currentProject) return;
                await resetAllMemory(currentProject.id);
                setConfirmReset(false);
                addToast({ title: 'Brain reset (checkpoint saved)', kind: 'info' });
              }}
            >
              Confirm Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={() => setConfirmReset(true)}
          >
            Reset memory
          </Button>
        )}

        <Button
          size="sm"
          variant="secondary"
          leftIcon={<Download className="w-3.5 h-3.5" />}
          onClick={() =>
            currentProject && exportBrainDownload(currentProject.id, currentProject.name)
          }
        >
          Export brain
        </Button>
      </div>
    </div>
  );

  if (breakpoint === 'phone') {
    return (
      <Sheet open={brainOpen} onClose={() => setBrainOpen(false)} title="Project Brain">
        <div className="p-4">{body}</div>
      </Sheet>
    );
  }

  return (
    <Modal
      open={brainOpen}
      onClose={() => setBrainOpen(false)}
      title="Project Brain (.kalpa)"
      maxWidthClass="max-w-3xl"
    >
      {body}
    </Modal>
  );
}
