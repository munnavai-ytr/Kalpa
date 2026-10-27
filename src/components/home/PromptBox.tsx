'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Cpu, KeyRound } from 'lucide-react';
import type { StackKind } from '@/lib/vfs/db';
import { useProviderStore } from '@/lib/providers/store';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { StackChips } from './StackChips';

const EXAMPLE_IDEAS = [
  'A personal finance dashboard with monthly budget categories and CSV export…',
  'A Pomodoro focus timer with ambient session history and keyboard shortcuts…',
  'A Markdown documentation site with live search and dark mode…',
  'A recipe scaler web app that converts ingredients for any serving count…',
  'A Python script that analyzes sales trends and prints a clean summary table…',
  'A Flashcard study app with spaced-repetition decks stored locally…',
];

export interface PromptBoxProps {
  onRun: (prompt: string, stack: StackKind) => Promise<void>;
  onOpenModelSheet: () => void;
  running: boolean;
}

export function PromptBox({ onRun, onOpenModelSheet, running }: PromptBoxProps) {
  const { breakpoint } = useBreakpoint();
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const profiles = useProviderStore((s) => s.profiles);
  const activeProfileId = useProviderStore((s) => s.activeProfileId);

  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  const [prompt, setPrompt] = useState('');
  const [stack, setStack] = useState<StackKind>('auto');
  const [focused, setFocused] = useState(false);
  const [typedPlaceholder, setTypedPlaceholder] = useState(EXAMPLE_IDEAS[0]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea height cleanly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(280, el.scrollHeight)}px`;
  }, [prompt]);

  // Typewriter cycling placeholder (pauses on focus or reduced motion)
  useEffect(() => {
    if (focused || prompt.length > 0 || reduceMotion) return;

    let ideaIdx = 0;
    let charIdx = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const full = EXAMPLE_IDEAS[ideaIdx];
      if (!deleting) {
        charIdx += 1;
        setTypedPlaceholder(full.slice(0, charIdx));
        if (charIdx >= full.length) {
          deleting = true;
          timer = setTimeout(tick, 2200);
          return;
        }
        timer = setTimeout(tick, 26);
      } else {
        charIdx -= 2;
        if (charIdx <= 0) {
          charIdx = 0;
          deleting = false;
          ideaIdx = (ideaIdx + 1) % EXAMPLE_IDEAS.length;
          setTypedPlaceholder('');
          timer = setTimeout(tick, 260);
          return;
        }
        setTypedPlaceholder(full.slice(0, charIdx));
        timer = setTimeout(tick, 14);
      }
    };

    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [focused, prompt.length, reduceMotion]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || running) return;
    onRun(prompt.trim(), stack);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const minRows = breakpoint === 'phone' ? 3 : 4;

  return (
    <div className="space-y-3 w-full">
      <div className="kalpa-conic-wrap shadow-kalpa-soft">
        <form
          onSubmit={handleSubmit}
          className="relative rounded-[23px] bg-kalpa-bg-2 p-4 sm:p-5 space-y-4"
        >
          <textarea
            ref={textareaRef}
            rows={minRows}
            value={prompt}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={focused ? 'Describe the app or script you want to build…' : typedPlaceholder}
            aria-label="Describe what you want to build"
            className="w-full resize-none bg-transparent text-base text-kalpa-text placeholder:text-kalpa-muted/75 focus:outline-none leading-relaxed"
          />

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-kalpa-border">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <Chip
                onClick={onOpenModelSheet}
                active={Boolean(activeProfile)}
                icon={<KeyRound className="w-3.5 h-3.5" />}
                className="max-w-[210px]"
              >
                <span className="truncate">
                  {activeProfile
                    ? `${activeProfile.label} · ${activeProfile.model}`
                    : 'Add key'}
                </span>
              </Chip>

              <Chip
                active
                icon={<Cpu className="w-3.5 h-3.5 text-kalpa-success" />}
                title="Instant browser engine active (Cloud Sandbox coming in Prompt 2)"
              >
                Instant
              </Chip>
            </div>

            <Button
              type="submit"
              variant="primary"
              loading={running}
              disabled={!prompt.trim()}
              className="min-w-[104px]"
            >
              <span>Run</span>
              {!running ? <ArrowRight className="w-4 h-4" /> : null}
            </Button>
          </div>
        </form>
      </div>

      <div className="flex items-center justify-between gap-2">
        <StackChips value={stack} onChange={setStack} />
      </div>
    </div>
  );
}
