'use client';

import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ProjectBrainIndex } from '@/lib/brain/index';

export interface BrainIndexTableProps {
  index: ProjectBrainIndex | null;
  onOpenFile: (path: string) => void;
}

export function BrainIndexTable({ index, onOpenFile }: BrainIndexTableProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = index?.files ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        f.exports.some((e) => e.toLowerCase().includes(q)) ||
        f.note.toLowerCase().includes(q)
    );
  }, [index, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-kalpa-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter indexed files, exports, or notes…"
            className="w-full min-h-[38px] pl-8 pr-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs text-kalpa-text"
          />
        </div>
        <span className="text-xs text-kalpa-muted tabular-nums">
          {filtered.length} of {index?.fileCount ?? 0} files
        </span>
      </div>

      <div className="rounded-[12px] border border-kalpa-border overflow-x-auto max-h-[52vh]">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-kalpa-surface border-b border-kalpa-border text-kalpa-muted sticky top-0">
            <tr>
              <th className="py-2 px-3 font-medium">Path</th>
              <th className="py-2 px-2 font-medium">Lang</th>
              <th className="py-2 px-2 font-medium text-right">Lines</th>
              <th className="py-2 px-3 font-medium">Exports</th>
              <th className="py-2 px-2 font-medium text-right">Importers</th>
              <th className="py-2 px-3 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-kalpa-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-kalpa-muted">
                  No matching files in index.
                </td>
              </tr>
            ) : (
              filtered.map((f) => (
                <tr key={f.path} className="hover:bg-kalpa-surface/70">
                  <td className="py-2 px-3 font-mono">
                    <button
                      type="button"
                      onClick={() => onOpenFile(f.path)}
                      className="text-kalpa-violet hover:underline text-left cursor-pointer"
                    >
                      {f.path}
                    </button>
                  </td>
                  <td className="py-2 px-2 text-kalpa-muted">{f.lang}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-kalpa-muted">
                    {f.lines}
                  </td>
                  <td className="py-2 px-3 font-mono text-kalpa-text max-w-[180px] truncate">
                    {f.exports.join(', ') || '—'}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-kalpa-muted">
                    {f.importedBy.length}
                  </td>
                  <td className="py-2 px-3 text-kalpa-muted max-w-[240px] truncate">
                    {f.note || '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
