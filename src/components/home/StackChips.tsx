'use client';

import React from 'react';
import { Code2, FileCode2, FileText, Globe, Layers, Sparkles } from 'lucide-react';
import type { StackKind } from '@/lib/vfs/db';
import { Chip } from '@/components/ui/Chip';

export interface StackChipsProps {
  value: StackKind;
  onChange: (stack: StackKind) => void;
}

const ITEMS: { id: StackKind; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'auto', label: 'Auto', Icon: Sparkles },
  { id: 'next', label: 'Next.js', Icon: Layers },
  { id: 'react', label: 'React', Icon: Code2 },
  { id: 'html', label: 'HTML', Icon: Globe },
  { id: 'python', label: 'Python', Icon: FileCode2 },
  { id: 'blank', label: 'Blank', Icon: FileText },
];

export function StackChips({ value, onChange }: StackChipsProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto max-w-full py-0.5">
      {ITEMS.map(({ id, label, Icon }) => (
        <Chip
          key={id}
          active={value === id}
          onClick={() => onChange(id)}
          icon={<Icon className="w-3.5 h-3.5" />}
        >
          {label}
        </Chip>
      ))}
    </div>
  );
}
