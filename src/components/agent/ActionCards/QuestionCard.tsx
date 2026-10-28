'use client';

import React, { useState } from 'react';
import { HelpCircle, Send } from 'lucide-react';
import type { Action } from '@/lib/agent/actions';
import { useAgentStore, type ActionOutcomeMeta } from '@/stores/agent';
import { Button } from '@/components/ui/Button';

export interface QuestionCardProps {
  action: Extract<Action, { type: 'question' }>;
  outcome?: ActionOutcomeMeta;
  isLivePending?: boolean;
}

export function QuestionCard({ action, outcome, isLivePending = false }: QuestionCardProps) {
  const submitQuestionAnswer = useAgentStore((s) => s.submitQuestionAnswer);
  const [customReply, setCustomReply] = useState('');

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customReply.trim()) return;
    submitQuestionAnswer(customReply.trim());
    setCustomReply('');
  };

  return (
    <div className="rounded-[12px] border border-kalpa-violet/45 bg-kalpa-violet/10 p-3.5 space-y-2.5 text-xs">
      <div className="flex items-start gap-2">
        <HelpCircle className="w-4 h-4 text-kalpa-violet shrink-0 mt-0.5" />
        <div className="space-y-1 min-w-0 flex-1">
          <p className="font-semibold text-kalpa-text leading-relaxed">{action.text}</p>
          {outcome?.summary ? (
            <p className="text-[11px] font-mono text-kalpa-success">{outcome.summary}</p>
          ) : null}
        </div>
      </div>

      {action.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {action.options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={!isLivePending}
              onClick={() => isLivePending && submitQuestionAnswer(opt)}
              className={`px-2.5 py-1.5 rounded-[8px] border text-xs font-medium transition-colors ${
                isLivePending
                  ? 'border-kalpa-violet/50 bg-kalpa-bg-2 text-kalpa-text hover:bg-kalpa-violet hover:text-white cursor-pointer'
                  : 'border-kalpa-border bg-kalpa-bg-2/50 text-kalpa-muted opacity-75'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}

      {isLivePending ? (
        <form onSubmit={handleCustomSubmit} className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={customReply}
            onChange={(e) => setCustomReply(e.target.value)}
            placeholder="Or type a custom answer…"
            className="flex-1 min-h-[36px] px-2.5 rounded-[8px] bg-kalpa-bg-2 border border-kalpa-border text-xs text-kalpa-text focus:outline-none focus:border-kalpa-violet"
          />
          <Button type="submit" size="sm" variant="primary" disabled={!customReply.trim()}>
            <Send className="w-3.5 h-3.5" />
          </Button>
        </form>
      ) : null}
    </div>
  );
}
