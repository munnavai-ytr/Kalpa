import type { EngineKind, StackKind } from '@/lib/vfs/db';
import { CONSTITUTION } from './constitution';

export type AgentMode = 'NEW_PROJECT' | 'CONTINUE' | 'CHANGE' | 'PLAN';

export function detectUserLanguage(text: string): 'bn' | 'en' | 'other' {
  if (!text) return 'en';
  if (/[\u0980-\u09FF]/.test(text)) return 'bn';
  const nonAscii = (text.match(/[^\x00-\x7F]/g) || []).length;
  if (nonAscii > Math.max(4, text.length * 0.25)) return 'other';
  return 'en';
}

export function environmentBlock(opts: {
  engine: EngineKind;
  userText: string;
  mode: AgentMode;
  preferredStack?: StackKind;
}): string {
  const isCloud = opts.engine === 'cloud';
  const today = new Date().toISOString().slice(0, 10);
  const lang = detectUserLanguage(opts.userText);
  const effectiveMode = opts.mode === 'PLAN' ? 'CHANGE' : opts.mode;
  const stackLine =
    opts.preferredStack && opts.preferredStack !== 'auto'
      ? `\npreferred_stack: ${opts.preferredStack}`
      : '';

  return `<environment>
engine: ${isCloud ? 'cloud' : 'instant'}
shell: ${
    isCloud
      ? 'linux-bash (Ubuntu, node 20, python 3, git, curl, npm/pnpm)'
      : 'virtual (ls/cat/grep/python/node only; NO npm, NO git)'
  }
preview: ${isCloud ? 'real-dev-server' : 'sandpack-client (static / react / next-lite / pyodide)'}
can_install_packages: ${
    isCloud ? 'yes (npm/pip)' : 'sandpack-auto-from-package.json (browser-compatible only)'
  }
server_code_in_preview: ${
    isCloud
      ? 'YES'
      : 'NO (Next API routes, Server Actions, Node fs/db do NOT run in Instant; tell the user to switch to Cloud Sandbox if needed)'
  }
tailwind: ${
    isCloud
      ? 'any'
      : 'tailwind-v3-or-cdn-in-instant (avoid @import "tailwindcss" v4 syntax in Instant)'
  }
file_limits: max 2MB per file, max 2000 files, paths relative to project root, never touch .kalpa/ directly
user_language: ${lang}
today: ${today}
mode: ${effectiveMode}${stackLine}
</environment>`;
}

export const NEW_PROJECT_PREAMBLE =
  'NEW PROJECT. Follow S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7 strictly. ' +
  'Build Milestone M1 end-to-end and make it visibly run in Preview on this first turn. ' +
  'Put remaining milestones in tasks.md and mark M1 complete with <complete milestone="M1" next="M2" />.';

export const PLAN_ONLY_PREAMBLE =
  'PLAN MODE (/plan): Update project memory (brief, architecture, conventions, decisions, tasks) and present a clear milestone plan to the user. ' +
  'Do NOT create, edit, move, or delete any source code files in this turn, and end with <finished />.';

export const STRICT_FORMAT_REMINDER =
  'STRICT ACTION FORMAT REQUIRED: Never paste source files inside ```markdown``` code fences and never claim "Done" without emitting XML action tags. ' +
  'Every file creation MUST use <file path="relative/path.ext"> on its own line, raw code without fences, and </file> on its own line. ' +
  'Every edit MUST use <edit path="..."><find>...</find><replace>...</replace></edit>.';

export function buildContinueMessage(nextMilestone: string): string {
  return (
    `CONTINUE: Execute milestone ${nextMilestone} from tasks.md. ` +
    'Follow the existing architecture.md and conventions.md. Do not break features from completed milestones. ' +
    'Verify, update memory, and emit <complete .../> or <finished />.'
  );
}

export function buildTruncationMessage(partialHint: string): string {
  return (
    `Your previous response was cut off mid-action (${partialHint}). ` +
    'Re-emit ONLY the incomplete action completely, then continue.'
  );
}

export function buildInterruptedResumeMessage(): string {
  return (
    'Your previous response was interrupted. Continue exactly where you stopped. ' +
    'Do not repeat actions that were already executed.'
  );
}

export function assembleSystemPrompt(parts: {
  envBlock: string;
  brainBlock: string;
  indexBlock: string;
  selectedFilesBlock: string;
  modePreamble?: string;
  strictFormat?: boolean;
}): string {
  // CONSTITUTION MUST stay first for provider prefix prompt caching.
  const blocks = [
    CONSTITUTION,
    parts.envBlock,
    parts.brainBlock,
    parts.indexBlock,
    parts.selectedFilesBlock,
  ];
  const instructions = [
    parts.modePreamble,
    parts.strictFormat ? STRICT_FORMAT_REMINDER : undefined,
  ].filter(Boolean);
  if (instructions.length > 0) {
    blocks.push(`<mode_instruction>\n${instructions.join('\n\n')}\n</mode_instruction>`);
  }
  return blocks.filter(Boolean).join('\n\n');
}
