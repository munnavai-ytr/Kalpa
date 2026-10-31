'use client';

import React, { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  Wrench,
  XCircle,
} from 'lucide-react';
import { parseWithFallback } from '@/lib/agent/reliability';
import type { DoctorIssue } from '@/lib/agent/scaffoldDoctor';
import type { ChatRecord, TurnFileChange } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import type {
  ActionOutcomeMeta,
  ExecutableAction,
  LiveStreamItem,
  PartialActionIndicator,
} from '@/stores/agent';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { Spinner } from '@/components/ui/Spinner';
import { ChatCodeBlock } from '@/components/ide/ChatCodeBlock';
import { FileCard } from './ActionCards/FileCard';
import { EditCard } from './ActionCards/EditCard';
import { ShellCard } from './ActionCards/ShellCard';
import { MemoryCard } from './ActionCards/MemoryCard';
import { LookCard } from './ActionCards/LookCard';
import { QuestionCard } from './ActionCards/QuestionCard';
import { MilestoneCard } from './ActionCards/MilestoneCard';
import { ErrorCard } from './ActionCards/ErrorCard';
import { TurnFooter } from './TurnFooter';

function ScaffoldDoctorCard({
  fixedCount,
  issues,
}: {
  fixedCount: number;
  issues: DoctorIssue[];
}) {
  const [open, setOpen] = useState(false);
  const errorCount = issues.filter((i) => i.status === 'error').length;
  const warnCount = issues.filter((i) => i.status === 'warn').length;
  const title =
    fixedCount > 0
      ? `Scaffold fixed (${fixedCount})`
      : `Scaffold check (${issues.length})`;

  const borderClass =
    errorCount > 0
      ? 'border-kalpa-danger/40 bg-kalpa-danger/10'
      : fixedCount > 0
        ? 'border-kalpa-success/35 bg-kalpa-success/10'
        : 'border-kalpa-warn/35 bg-kalpa-warn/10';

  return (
    <div className={`rounded-[10px] border ${borderClass} overflow-hidden text-xs`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left cursor-pointer hover:bg-kalpa-surface/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-kalpa-muted shrink-0" />
          )}
          <Wrench
            className={`w-3.5 h-3.5 shrink-0 ${
              errorCount > 0
                ? 'text-kalpa-danger'
                : fixedCount > 0
                  ? 'text-kalpa-success'
                  : 'text-kalpa-warn'
            }`}
          />
          <span className="font-semibold text-kalpa-text truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
          {errorCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded bg-kalpa-danger/20 text-kalpa-danger">
              {errorCount} error{errorCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {warnCount > 0 ? (
            <span className="px-1.5 py-0.5 rounded bg-kalpa-warn/20 text-kalpa-warn">
              {warnCount} warn
            </span>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="px-3 pb-2.5 pt-1 border-t border-kalpa-border/50 space-y-1.5 bg-kalpa-bg-2/70">
          {issues.map((iss, idx) => (
            <div key={`${iss.id}-${idx}`} className="flex items-start gap-2 leading-relaxed">
              {iss.status === 'fixed' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-kalpa-success shrink-0 mt-0.5" />
              ) : iss.status === 'error' ? (
                <XCircle className="w-3.5 h-3.5 text-kalpa-danger shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 text-kalpa-warn shrink-0 mt-0.5" />
              )}
              <span className="text-kalpa-text break-words">{iss.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function renderSingleActionCard(
  action: ExecutableAction,
  outcome?: ActionOutcomeMeta,
  isLivePendingQuestion = false,
  filesChangedCount?: number
) {
  switch (action.type) {
    case 'status':
      return null;
    case 'file':
    case 'delete':
    case 'move':
      return <FileCard action={action} outcome={outcome} />;
    case 'edit':
      return <EditCard action={action} outcome={outcome} />;
    case 'shell':
      return <ShellCard action={action} outcome={outcome} />;
    case 'memory':
      return <MemoryCard action={action} outcome={outcome} />;
    case 'read':
    case 'search':
    case 'list':
    case 'impact':
      return <LookCard action={action} outcome={outcome} />;
    case 'question':
      return (
        <QuestionCard
          action={action}
          outcome={outcome}
          isLivePending={isLivePendingQuestion}
        />
      );
    case 'complete':
    case 'finished':
      return <MilestoneCard action={action} filesChangedCount={filesChangedCount} />;
  }
}

function parseSavedAssistantContent(
  raw: string,
  filesChanged?: TurnFileChange[]
): LiveStreamItem[] {
  const { actions } = parseWithFallback(raw);
  const items: LiveStreamItem[] = [];
  const changeByPath = new Map((filesChanged ?? []).map((f) => [f.path, f]));
  let idx = 0;

  for (const a of actions) {
    if (a.type === 'text') {
      const last = items[items.length - 1];
      if (last && last.kind === 'text') last.text += `\n\n${a.text}`;
      else items.push({ id: `s-txt-${idx++}`, kind: 'text', text: a.text });
    } else {
      let outcome: ActionOutcomeMeta | undefined;
      if (a.type === 'file' || a.type === 'edit') {
        const fc = changeByPath.get(a.path);
        if (fc) {
          outcome = { ok: true, beforeContent: fc.before, afterContent: fc.after };
        }
      }
      items.push({ id: `s-act-${idx++}`, kind: 'action', action: a, outcome });
    }
  }
  return items;
}

function MarkdownProse({ text }: { text: string }) {
  const currentProject = useProjectStore((s) => s.currentProject);
  const openFile = useProjectStore((s) => s.openFile);
  const addToast = useUiStore((s) => s.addToast);

  return (
    <div className="text-sm leading-relaxed text-kalpa-text prose prose-invert max-w-none break-words px-0.5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className } = props;
            const match = /language-(\w+)/.exec(className || '');
            const rawCode = String(children).replace(/\n$/, '');
            if (match || rawCode.includes('\n')) {
              return (
                <ChatCodeBlock
                  code={rawCode}
                  lang={match?.[1] || ''}
                  onInsertFile={async (path, content) => {
                    if (!currentProject) return;
                    await vfs.write(currentProject.id, path, content);
                    openFile(path);
                    addToast({ title: `Saved ${path}`, kind: 'success' });
                  }}
                />
              );
            }
            return (
              <code className="px-1.5 py-0.5 rounded bg-kalpa-surface font-mono text-xs text-kalpa-text">
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export interface SavedMessageProps {
  msg: ChatRecord;
  onRetry?: () => void;
  onEnableProxyAndRetry?: () => void;
  onSwitchModel?: () => void;
}

export function SavedMessage({
  msg,
  onRetry,
  onEnableProxyAndRetry,
  onSwitchModel,
}: SavedMessageProps) {
  const parsedItems = useMemo(() => {
    if (msg.role !== 'assistant' || msg.meta?.plainChat) return null;
    return parseSavedAssistantContent(msg.content, msg.meta?.filesChanged);
  }, [msg.content, msg.role, msg.meta?.plainChat, msg.meta?.filesChanged]);

  if (msg.role === 'user') {
    if (msg.meta?.hiddenAutoContinue) {
      return (
        <div className="flex items-center gap-2 py-1 text-[11px] font-mono text-kalpa-muted">
          <div className="h-px flex-1 bg-kalpa-border" />
          <span>Auto-continuing milestone</span>
          <div className="h-px flex-1 bg-kalpa-border" />
        </div>
      );
    }
    return (
      <div className="flex justify-end pl-6">
        <div className="rounded-[14px] rounded-br-[4px] px-3.5 py-2.5 bg-kalpa-violet/20 border border-kalpa-violet/35 text-sm text-kalpa-text whitespace-pre-wrap break-words max-w-full">
          {msg.content}
        </div>
      </div>
    );
  }

  const filesChangedCount = msg.meta?.filesChanged?.length;

  return (
    <div className="space-y-2 pr-1">
      {msg.meta?.notices && msg.meta.notices.length > 0 ? (
        <div className="space-y-1">
          {msg.meta.notices.map((n, idx) => (
            <div
              key={`${n}-${idx}`}
              className="px-2.5 py-1.5 rounded-[8px] bg-kalpa-surface/80 border border-kalpa-border text-[11px] font-mono text-kalpa-muted"
            >
              {n}
            </div>
          ))}
        </div>
      ) : null}

      {msg.meta?.plainChat ? (
        msg.content.trim() ? (
          <div className="rounded-[14px] p-3.5 bg-kalpa-bg-2 border border-kalpa-border">
            <MarkdownProse text={msg.content} />
          </div>
        ) : null
      ) : (
        parsedItems?.map((item) => {
          if (item.kind === 'text') {
            const clean = item.text.trim();
            if (!clean) return null;
            return <MarkdownProse key={item.id} text={clean} />;
          }
          if (item.kind === 'scaffold-doctor') {
            return (
              <ScaffoldDoctorCard
                key={item.id}
                fixedCount={item.fixedCount}
                issues={item.issues}
              />
            );
          }
          const card = renderSingleActionCard(item.action, item.outcome, false, filesChangedCount);
          return card ? <div key={item.id}>{card}</div> : null;
        })
      )}

      {msg.meta?.scaffoldFixes && msg.meta.scaffoldFixes.length > 0 ? (
        <div className="space-y-1.5">
          {msg.meta.scaffoldFixes.map((sf) => (
            <ScaffoldDoctorCard key={sf.id} fixedCount={sf.fixedCount} issues={sf.issues} />
          ))}
        </div>
      ) : null}

      {msg.meta?.error ? (
        <ErrorCard
          message={msg.meta.error.message}
          hint={msg.meta.error.hint}
          kind={msg.meta.error.kind}
          rawDetail={msg.meta.error.rawDetail}
          extraBodyHint={msg.meta.error.extraBodyHint}
          suggestProxy={msg.meta.error.suggestProxy}
          providerKind={msg.meta.error.providerKind}
          baseUrl={msg.meta.error.baseUrl}
          onRetry={onRetry}
          onEnableProxyAndRetry={onEnableProxyAndRetry}
          onSwitchModel={onSwitchModel}
        />
      ) : null}

      <TurnFooter message={msg} />
    </div>
  );
}

export interface LiveStreamingMessageProps {
  items: LiveStreamItem[];
  partial: PartialActionIndicator | null;
  hasPendingQuestion: boolean;
}

export function LiveStreamingMessage({
  items,
  partial,
  hasPendingQuestion,
}: LiveStreamingMessageProps) {
  const lastQuestionId = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'action' && it.action.type === 'question') return it.id;
    }
    return null;
  }, [items]);

  return (
    <div className="space-y-2 pr-1">
      {items.map((item) => {
        if (item.kind === 'text') {
          const clean = item.text.trim();
          if (!clean) return null;
          return <MarkdownProse key={item.id} text={clean} />;
        }
        if (item.kind === 'scaffold-doctor') {
          return (
            <ScaffoldDoctorCard
              key={item.id}
              fixedCount={item.fixedCount}
              issues={item.issues}
            />
          );
        }
        const card = renderSingleActionCard(
          item.action,
          item.outcome,
          hasPendingQuestion && item.id === lastQuestionId
        );
        return card ? <div key={item.id}>{card}</div> : null;
      })}

      {partial ? (
        <div className="rounded-[10px] border border-kalpa-violet/45 bg-kalpa-violet/10 px-3 py-2 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Spinner size={12} className="text-kalpa-violet shrink-0" />
            <FileCode2 className="w-3.5 h-3.5 text-kalpa-violet shrink-0" />
            <span className="font-mono text-kalpa-text truncate">
              {partial.pathHint
                ? `Writing ${partial.pathHint}…`
                : `Streaming <${partial.tag}>…`}
            </span>
          </div>
          <span className="font-mono text-[11px] text-kalpa-violet shrink-0 tabular-nums">
            {partial.lineCount} line{partial.lineCount === 1 ? '' : 's'}
          </span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center gap-2 px-1 py-2 text-xs text-kalpa-muted">
          <Spinner size={13} className="text-kalpa-violet" />
          <span>Thinking…</span>
        </div>
      ) : null}
    </div>
  );
}
