import { applyMemoryAction, readAllBrainMemory } from '@/lib/brain/files';
import { MEMORY_MAX_CHARS } from '@/lib/brain/caps';
import { streamChat, type ProviderConfig } from '@/lib/providers/core';
import type { ChatRecord } from '@/lib/vfs/db';
import { compactAssistantMessage, compactResultUserMessage } from './compact';

export const SUMMARY_INSTRUCTION =
  'SUMMARY: Summarise the conversation below in <= 12 bullet points: user goals, decisions, files changed, unresolved questions. Plain markdown only.';

/**
 * Summarises older messages using the user's active model and appends/replaces .kalpa/summary.md.
 */
export async function updateRollingSummary(
  projectId: string,
  profile: ProviderConfig,
  olderMessages: ChatRecord[],
  signal?: AbortSignal
): Promise<boolean> {
  if (olderMessages.length === 0) return false;

  const transcript = olderMessages
    .map((m) => {
      const body =
        m.role === 'assistant'
          ? compactAssistantMessage(m.content)
          : compactResultUserMessage(m.content);
      return `${m.role.toUpperCase()}:\n${body.slice(0, 1200)}`;
    })
    .join('\n\n---\n\n')
    .slice(-18000);

  let generated = '';
  const summaryCfg: ProviderConfig = {
    ...profile,
    maxOutputTokens: Math.min(profile.maxOutputTokens || 1024, 1024),
  };

  for await (const ev of streamChat(
    summaryCfg,
    [
      {
        role: 'user',
        content: `${SUMMARY_INSTRUCTION}\n\n${transcript}`,
      },
    ],
    signal
  )) {
    if (ev.delta) generated += ev.delta;
  }

  const cleanBullets = generated.trim();
  if (!cleanBullets) return false;

  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const block = `## Summary (${stamp})\n${cleanBullets}`;

  const mem = await readAllBrainMemory(projectId);
  const existing = mem.summary || '';
  if (existing.length + block.length + 10 > MEMORY_MAX_CHARS) {
    // Keep tail of existing summary within cap
    const tail = existing.slice(-(MEMORY_MAX_CHARS - block.length - 120));
    const trimmedExisting = tail.includes('\n## ')
      ? `## ${tail.split('\n## ').slice(1).join('\n## ')}`
      : tail;
    await applyMemoryAction(
      projectId,
      'summary',
      'replace',
      `# Conversation Summary\n\n${trimmedExisting.trim()}\n\n${block}`
    );
  } else {
    await applyMemoryAction(projectId, 'summary', 'append', block);
  }
  return true;
}
