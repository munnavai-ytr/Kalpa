import { isBrainPath } from '@/lib/brain/caps';
import type { ProviderKind } from '@/lib/providers/core';
import type { TurnFileChange } from '@/lib/vfs/db';
import type { AgentStepId, ExecutableAction } from '@/stores/agent';
import type { AgentMode } from './prompts/system';

export function stepFromAction(a: ExecutableAction): { step: AgentStepId; label: string } {
  switch (a.type) {
    case 'status':
      return {
        step: (['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].includes(a.step || '')
          ? a.step
          : 'S0') as AgentStepId,
        label: a.text || 'Working…',
      };
    case 'read':
    case 'search':
    case 'list':
    case 'impact':
      return { step: 'S0', label: `Inspecting ${a.type}…` };
    case 'question':
      return { step: 'S0', label: 'Asking a quick question…' };
    case 'memory':
      if (a.file === 'brief') return { step: 'S1', label: 'Writing project brief…' };
      if (a.file === 'architecture' || a.file === 'conventions' || a.file === 'tasks') {
        return { step: 'S2', label: `Planning (${a.file}.md)…` };
      }
      return { step: 'S6', label: `Updating Brain (${a.file}.md)…` };
    case 'file':
      return { step: 'S3', label: `Writing ${a.path}…` };
    case 'edit':
      return { step: 'S3', label: `Editing ${a.path}…` };
    case 'delete':
    case 'move':
      return { step: 'S3', label: 'Updating workspace paths…' };
    case 'shell':
      return { step: 'S5', label: `Running: ${a.cmd.slice(0, 48)}…` };
    case 'complete':
      return { step: 'S7', label: `Completed ${a.milestone || 'milestone'}` };
    case 'finished':
      return { step: 'S7', label: 'Finishing up…' };
  }
}

export function computeTurnChanges(
  beforeSnap: Record<string, string>,
  afterSnap: Record<string, string>
): TurnFileChange[] {
  const changes: TurnFileChange[] = [];
  const allPaths = new Set([...Object.keys(beforeSnap), ...Object.keys(afterSnap)]);
  for (const path of Array.from(allPaths).sort()) {
    if (isBrainPath(path) || path.endsWith('/.gitkeep')) continue;
    const b = beforeSnap[path];
    const a = afterSnap[path];
    if (b === undefined && a !== undefined) changes.push({ path, status: 'added', before: '', after: a });
    else if (b !== undefined && a === undefined) changes.push({ path, status: 'deleted', before: b, after: '' });
    else if (b !== undefined && a !== undefined && b !== a) changes.push({ path, status: 'modified', before: b, after: a });
  }
  return changes;
}

export function isPureQuestionPrompt(userText: string, assistantRaw: string): boolean {
  const q = userText.trim();
  const looksQuestion =
    /\?\s*$/.test(q) &&
    /^(what|why|how|where|when|who|explain|describe|tell me|does|is|are|can you explain)\b/i.test(q) &&
    !/\b(build|create|make|add|edit|update|fix|change|implement|write|refactor|remove|delete|style)\b/i.test(q);
  const claimsMutation =
    /\b(i(?:'ve| have)?\s+(?:created|built|updated|edited|implemented|fixed|added)|done!|all files created)\b/i.test(
      assistantRaw
    ) || /```/.test(assistantRaw);
  return looksQuestion && !claimsMutation;
}

export function shouldRejectNoOpTurn(opts: {
  mode: AgentMode;
  userText: string;
  assistantRaw: string;
  touchedCodeCount: number;
  memoryWriteCount: number;
  ranAnyTool: boolean;
}): boolean {
  if (opts.mode === 'NEW_PROJECT' || opts.mode === 'CONTINUE') {
    return opts.touchedCodeCount === 0;
  }
  if (opts.mode === 'PLAN') {
    return opts.memoryWriteCount === 0;
  }
  // CHANGE mode
  if (opts.touchedCodeCount > 0 || opts.memoryWriteCount > 0 || opts.ranAnyTool) {
    return false;
  }
  return !isPureQuestionPrompt(opts.userText, opts.assistantRaw);
}

export function buildNoOpRetryPrompt(mode: AgentMode): string {
  if (mode === 'PLAN') {
    return (
      'NO BRAIN MEMORY WAS UPDATED. Emit <memory file="brief" op="replace">...</memory> and ' +
      '<memory file="tasks" op="replace">...</memory> tags on their own lines, then end with <finished />.'
    );
  }
  return [
    'NO FILES WERE CREATED OR EDITED (0 files changed). Replying in prose or Markdown fences does NOT modify the workspace.',
    'You MUST emit XML <file> or <edit> tags right now, with opening and closing tags on their own lines and raw code (no ``` fences):',
    '',
    '<file path="src/App.tsx">',
    'export default function App() {',
    '  return <main>Working App</main>;',
    '}',
    '</file>',
    '',
    'Write the complete working files now, then emit <complete milestone="M1" next="M2" /> or <finished />.',
  ].join('\n');
}

export function buildThinkingExtraBodyHint(kind: ProviderKind): string {
  if (kind === 'gemini') {
    return '{"generationConfig":{"thinkingConfig":{"thinkingBudget":1024}}}';
  }
  return '{"reasoning":{"effort":"low"}}';
}
