'use client';

import React, { memo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle } from 'lucide-react';
import type { ChatRecord } from '@/lib/vfs/db';
import { Button } from '@/components/ui/Button';
import { ChatCodeBlock } from './ChatCodeBlock';

export interface ChatMessageRowProps {
  msg: ChatRecord;
  onInsertFile: (path: string, content: string) => void;
  onRetry: () => void;
  onEnableProxyAndRetry: () => void;
}

export const ChatMessageRow = memo(function ChatMessageRow({
  msg,
  onInsertFile,
  onRetry,
  onEnableProxyAndRetry,
}: ChatMessageRowProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const isUser = msg.role === 'user';
  const err = msg.meta?.error;

  return (
    <div className={`space-y-1.5 ${isUser ? 'pl-6' : 'pr-2'}`}>
      <div
        className={`rounded-[14px] p-3.5 text-sm leading-relaxed border ${
          isUser
            ? 'bg-kalpa-violet/15 border-kalpa-violet/35 text-kalpa-text'
            : 'bg-kalpa-bg-2 border-kalpa-border text-kalpa-text'
        }`}
      >
        {msg.content ? (
          <div className="space-y-2 break-words">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                code(props) {
                  const { children, className } = props;
                  const text = String(children).replace(/\n$/, '');
                  const match = /language-(\w+)/.exec(className || '');
                  const isBlock = Boolean(match) || text.includes('\n');
                  if (!isBlock) {
                    return (
                      <code className="px-1.5 py-0.5 rounded bg-kalpa-surface font-mono text-xs">
                        {children}
                      </code>
                    );
                  }
                  return (
                    <ChatCodeBlock
                      code={text}
                      lang={match?.[1] ?? ''}
                      onInsertFile={onInsertFile}
                    />
                  );
                },
              }}
            >
              {msg.content}
            </Markdown>
          </div>
        ) : null}

        {err ? (
          <div className="mt-2 p-3 rounded-[10px] border border-kalpa-danger/40 bg-kalpa-danger/10 space-y-2">
            <div className="flex items-start gap-2 text-xs text-kalpa-danger">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{err.message}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry
              </Button>
              {err.suggestProxy ? (
                <Button size="sm" variant="primary" onClick={onEnableProxyAndRetry}>
                  Enable Use proxy &amp; Retry
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between px-1 text-[11px] text-kalpa-muted">
        <div className="flex items-center gap-1.5 tabular-nums">
          <span>{isUser ? 'You' : msg.meta?.providerLabel || 'Assistant'}</span>
          {msg.meta?.usage && (msg.meta.usage.input || msg.meta.usage.output) ? (
            <>
              <span>·</span>
              <span>
                {msg.meta.usage.input ?? 0} in / {msg.meta.usage.output ?? 0} out tok
              </span>
            </>
          ) : null}
        </div>
        {msg.content ? (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(msg.content);
              setCopiedMsg(true);
              setTimeout(() => setCopiedMsg(false), 1400);
            }}
            className="hover:text-kalpa-text cursor-pointer"
          >
            {copiedMsg ? 'Copied' : 'Copy'}
          </button>
        ) : null}
      </div>
    </div>
  );
});
