import { extractImports, resolveImport } from './actions';
import { compactAssistantMessage, compactResultUserMessage } from './compact';
import {
  assembleSystemPrompt,
  environmentBlock,
  NEW_PROJECT_PREAMBLE,
  PLAN_ONLY_PREAMBLE,
  type AgentMode,
} from './prompts/system';
import { updateRollingSummary } from './summary';
import { computeContextAllocation, estimateTokens } from './tokens';
import { extractJsExports } from './tools';
import { isBrainPath } from '@/lib/brain/caps';
import { readAllBrainMemory } from '@/lib/brain/files';
import { fileIndexBlock, readOrBuildBrainIndex } from '@/lib/brain/index';
import { brainPack } from '@/lib/brain/pack';
import type { ChatMessage } from '@/lib/providers/core';
import type { ProviderProfile } from '@/lib/providers/store';
import type { ChatRecord, EngineKind, StackKind } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';

export interface BuildAgentContextOptions {
  projectId: string;
  engine: EngineKind;
  preferredStack?: StackKind;
  mode: AgentMode;
  latestUserText: string;
  profile: ProviderProfile;
  economyMode?: boolean;
  selectedFilesScale?: number;
  forceDropOlderHistory?: boolean;
  openEditorFiles: string[];
  recentTouchedPaths: string[];
  chatHistory: ChatRecord[];
  ephemeralTurnMessages: ChatMessage[];
  summarisedUpToId?: string | null;
  onSummarisedUpTo?: (lastMessageId: string) => void;
  signal?: AbortSignal;
}

function formatSelectedFileContent(path: string, content: string): string {
  const lines = content.split('\n');
  if (lines.length <= 400) {
    return `### ${path}\n\`\`\`\n${content}\n\`\`\``;
  }
  const head = lines.slice(0, 120).join('\n');
  const exportsList = extractJsExports(content);
  const sigNote = exportsList.length ? `\n// Exported symbols: ${exportsList.join(', ')}` : '';
  const trimmedCount = lines.length - 120;
  return `### ${path}\n\`\`\`\n${head}${sigNote}\n[trimmed ${trimmedCount} lines - use read]\n\`\`\``;
}

function buildSelectedFilesSection(
  codeSnap: Record<string, string>,
  opts: {
    openEditorFiles: string[];
    recentTouchedPaths: string[];
    userText: string;
    budgetTokens: number;
  }
): string {
  if (opts.budgetTokens <= 200) return '';
  const allPaths = Object.keys(codeSnap);
  if (allPaths.length === 0) return '';

  const openSet = new Set(opts.openEditorFiles);
  const recentSet = new Set(opts.recentTouchedPaths);
  const lowerMsg = opts.userText.toLowerCase();
  const keywords = lowerMsg
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 4)
    .slice(0, 16);

  const hasSrc = allPaths.some((p) => p.startsWith('src/'));
  const aliases = hasSrc ? { '@/': 'src/' } : { '@/': '' };
  const fileSet = new Set(allPaths);
  const importedByOpen = new Set<string>();

  for (const openPath of opts.openEditorFiles) {
    const src = codeSnap[openPath];
    if (!src) continue;
    for (const spec of extractImports(src)) {
      const resolved = resolveImport(openPath, spec, fileSet, aliases);
      if (resolved) importedByOpen.add(resolved);
    }
  }

  const scored: { path: string; score: number }[] = [];
  for (const path of allPaths) {
    let score = 0;
    if (openSet.has(path)) score += 3;
    if (recentSet.has(path)) score += 3;
    const baseName = path.split('/').pop()?.toLowerCase() || '';
    if (lowerMsg.includes(path.toLowerCase()) || (baseName.length > 3 && lowerMsg.includes(baseName))) {
      score += 2;
    }
    if (importedByOpen.has(path)) score += 1;
    const lowerContent = codeSnap[path].slice(0, 8000).toLowerCase();
    if (keywords.some((kw) => path.toLowerCase().includes(kw) || lowerContent.includes(kw))) {
      score += 1;
    }
    if (score > 0) scored.push({ path, score });
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const chosenBlocks: string[] = [];
  let usedTokens = 12;
  for (const item of scored) {
    const formatted = formatSelectedFileContent(item.path, codeSnap[item.path]);
    const t = estimateTokens(formatted);
    if (usedTokens + t > opts.budgetTokens) continue;
    chosenBlocks.push(formatted);
    usedTokens += t;
  }

  if (chosenBlocks.length === 0) return '';
  return `<selected_files>\n${chosenBlocks.join('\n\n')}\n</selected_files>`;
}

export async function buildAgentMessages(
  opts: BuildAgentContextOptions
): Promise<ChatMessage[]> {
  const economyActive = Boolean(opts.economyMode || opts.profile.economyMode);
  const effectiveMaxOut = economyActive
    ? Math.min(opts.profile.effectiveMaxOutput ?? opts.profile.maxOutputTokens, 4096)
    : (opts.profile.effectiveMaxOutput ?? opts.profile.maxOutputTokens);
  const alloc = computeContextAllocation(opts.profile.contextTokens, effectiveMaxOut);

  const [rawSnap, memoryInitial, index] = await Promise.all([
    vfs.snapshot(opts.projectId),
    readAllBrainMemory(opts.projectId),
    readOrBuildBrainIndex(opts.projectId),
  ]);

  const codeSnap: Record<string, string> = {};
  for (const [p, content] of Object.entries(rawSnap)) {
    if (!isBrainPath(p) && !p.endsWith('/.gitkeep')) {
      codeSnap[p] = content;
    }
  }

  let validHistory = opts.chatHistory.filter(
    (m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0
  );
  if (opts.summarisedUpToId) {
    const cutIdx = validHistory.findIndex((m) => m.id === opts.summarisedUpToId);
    if (cutIdx >= 0) {
      validHistory = validHistory.slice(cutIdx + 1);
    }
  }

  const recentSix = validHistory.slice(-6);
  let olderRecords = opts.forceDropOlderHistory
    ? []
    : validHistory.slice(0, Math.max(0, validHistory.length - 6));

  let olderChatMsgs: ChatMessage[] = olderRecords.map((m) => ({
    role: m.role,
    content:
      m.role === 'assistant'
        ? compactAssistantMessage(m.content)
        : compactResultUserMessage(m.content),
  }));

  let memory = memoryInitial;
  const olderTokens = olderChatMsgs.reduce((acc, m) => acc + estimateTokens(m.content), 0);

  if (olderRecords.length >= 4 && olderTokens > alloc.conversationBudget) {
    if (economyActive) {
      // A9: In economy mode, skip the extra LLM summary call and trim older messages directly
      olderChatMsgs = olderChatMsgs.slice(-2);
    } else {
      try {
        const ok = await updateRollingSummary(opts.projectId, opts.profile, olderRecords, opts.signal);
        if (ok) {
          const lastOld = olderRecords[olderRecords.length - 1];
          if (lastOld) opts.onSummarisedUpTo?.(lastOld.id);
          olderRecords = [];
          olderChatMsgs = [];
          memory = await readAllBrainMemory(opts.projectId);
        }
      } catch {
        // Fall back to trimming older messages below
      }
    }
  }

  const recentMsgs: ChatMessage[] = recentSix.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const envBlock = environmentBlock({
    engine: opts.engine,
    userText: opts.latestUserText,
    mode: opts.mode,
    preferredStack: opts.preferredStack,
  });
  const modePreamble =
    opts.mode === 'NEW_PROJECT'
      ? NEW_PROJECT_PREAMBLE
      : opts.mode === 'PLAN'
        ? PLAN_ONLY_PREAMBLE
        : undefined;
  const strictFormat = Boolean(opts.profile.strictFormat);
  const indexBlock = fileIndexBlock(index, alloc.indexBudget);

  const fileScale = (economyActive ? 0.6 : 1) * (opts.selectedFilesScale ?? 1);
  let selectedFilesBlock = buildSelectedFilesSection(codeSnap, {
    openEditorFiles: opts.openEditorFiles,
    recentTouchedPaths: opts.recentTouchedPaths,
    userText: opts.latestUserText,
    budgetTokens: Math.round(alloc.selectedFilesBudget * fileScale),
  });

  let brainBlock = brainPack(memory, { budgetTokens: alloc.brainBudget, shrinkLevel: 0 });

  const totalTokensFor = (sys: string, older: ChatMessage[]) => {
    const conv = [...older, ...recentMsgs, ...opts.ephemeralTurnMessages];
    return estimateTokens(sys) + conv.reduce((s, m) => s + estimateTokens(m.content), 0);
  };

  const makeSys = (selFiles: string, brain: string) =>
    assembleSystemPrompt({
      envBlock,
      brainBlock: brain,
      indexBlock,
      selectedFilesBlock: selFiles,
      modePreamble,
      strictFormat,
    });

  let sysPrompt = makeSys(selectedFilesBlock, brainBlock);

  if (totalTokensFor(sysPrompt, olderChatMsgs) > alloc.totalBudget) {
    selectedFilesBlock = '';
    sysPrompt = makeSys(selectedFilesBlock, brainBlock);
  }
  if (totalTokensFor(sysPrompt, olderChatMsgs) > alloc.totalBudget) {
    olderChatMsgs = [];
  }
  if (totalTokensFor(sysPrompt, olderChatMsgs) > alloc.totalBudget) {
    brainBlock = brainPack(memory, { budgetTokens: alloc.brainBudget, shrinkLevel: 1 });
    sysPrompt = makeSys(selectedFilesBlock, brainBlock);
  }
  if (totalTokensFor(sysPrompt, olderChatMsgs) > alloc.totalBudget) {
    brainBlock = brainPack(memory, { budgetTokens: alloc.brainBudget, shrinkLevel: 2 });
    sysPrompt = makeSys(selectedFilesBlock, brainBlock);
  }

  return [
    { role: 'system', content: sysPrompt },
    ...olderChatMsgs,
    ...recentMsgs,
    ...opts.ephemeralTurnMessages,
  ];
}
