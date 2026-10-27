'use client';

import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js';
import { Check, Copy, FilePlus2 } from 'lucide-react';
import { normalisePath } from '@/lib/vfs/paths';

function extractLeadingPathComment(code: string): string | null {
  const firstLine = code.split('\n')[0]?.trim() ?? '';
  const match =
    firstLine.match(/^\/\/\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\s*$/) ||
    firstLine.match(/^#\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\s*$/) ||
    firstLine.match(/^<!--\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\s*-->$/) ||
    firstLine.match(/^\/\*\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\s*\*\/$/);
  if (!match) return null;
  try {
    return normalisePath(match[1]);
  } catch {
    return null;
  }
}

export interface ChatCodeBlockProps {
  code: string;
  lang: string;
  onInsertFile: (path: string, content: string) => void;
}

export function ChatCodeBlock({ code, lang, onInsertFile }: ChatCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const detectedPath = useMemo(() => extractLeadingPathComment(code), [code]);

  const highlightedHtml = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  }, [code, lang]);

  return (
    <div className="my-2.5 rounded-[12px] border border-kalpa-border bg-kalpa-bg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-kalpa-surface border-b border-kalpa-border text-[11px] font-mono text-kalpa-muted">
        <span className="truncate">{detectedPath || lang || 'code'}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {detectedPath ? (
            <button
              type="button"
              onClick={() => onInsertFile(detectedPath, code)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-kalpa-violet/20 hover:bg-kalpa-violet/30 text-kalpa-text cursor-pointer"
            >
              <FilePlus2 className="w-3 h-3" />
              Insert as file
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-kalpa-surface-2 text-kalpa-muted hover:text-kalpa-text cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-kalpa-success" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed m-0">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
}
