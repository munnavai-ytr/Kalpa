'use client';

import React, { useMemo } from 'react';
import { structuredPatch } from 'diff';

export interface DiffViewProps {
  path: string;
  before: string;
  after: string;
  maxHeightClass?: string;
}

export function DiffView({
  path,
  before,
  after,
  maxHeightClass = 'max-h-72',
}: DiffViewProps) {
  const hunks = useMemo(() => {
    const patch = structuredPatch(path, path, before ?? '', after ?? '', '', '', {
      context: 3,
    });
    return patch.hunks;
  }, [path, before, after]);

  if (hunks.length === 0) {
    return (
      <div className="p-3 rounded-[10px] bg-kalpa-bg border border-kalpa-border text-xs font-mono text-kalpa-muted">
        No textual differences in {path}.
      </div>
    );
  }

  return (
    <div
      className={`rounded-[10px] border border-kalpa-border bg-kalpa-bg overflow-auto font-mono text-xs leading-relaxed ${maxHeightClass}`}
    >
      {hunks.map((hunk, hIdx) => {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        return (
          <div key={hIdx} className="border-b border-kalpa-border last:border-b-0">
            <div className="px-3 py-1 bg-kalpa-surface text-[11px] text-kalpa-muted">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </div>
            <div>
              {hunk.lines.map((line, lIdx) => {
                const prefix = line[0];
                const body = line.slice(1);
                let leftNum = '';
                let rightNum = '';
                let rowCls = 'text-kalpa-muted';

                if (prefix === '+') {
                  rightNum = String(newLine++);
                  rowCls = 'bg-kalpa-success/15 text-kalpa-success';
                } else if (prefix === '-') {
                  leftNum = String(oldLine++);
                  rowCls = 'bg-kalpa-danger/15 text-kalpa-danger';
                } else if (prefix === ' ') {
                  leftNum = String(oldLine++);
                  rightNum = String(newLine++);
                  rowCls = 'text-kalpa-text/85';
                } else {
                  return null;
                }

                return (
                  <div key={lIdx} className={`flex px-2 py-0.5 whitespace-pre ${rowCls}`}>
                    <span className="w-8 shrink-0 text-right pr-2 opacity-55 select-none tabular-nums">
                      {leftNum}
                    </span>
                    <span className="w-8 shrink-0 text-right pr-2 opacity-55 select-none tabular-nums">
                      {rightNum}
                    </span>
                    <span className="w-4 shrink-0 select-none">{prefix}</span>
                    <span>{body}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
