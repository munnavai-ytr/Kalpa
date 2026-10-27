import type { PreviewConsoleEntry } from '@/stores/preview';

export function parseFileLineFromMessage(msg: string): { file?: string; line?: number } {
  const match = msg.match(/(\/?[a-zA-Z0-9_./-]+\.(?:tsx?|jsx?|py|css|html)):(\d+)/);
  if (!match) return {};
  return {
    file: match[1].replace(/^\/+/, ''),
    line: Number(match[2]),
  };
}

export function buildFixPromptFromError(entry: PreviewConsoleEntry): string {
  const loc = entry.file
    ? ` in \`${entry.file}${entry.line ? `:${entry.line}` : ''}\``
    : '';
  return `Please help fix this preview error${loc}:\n\n\`\`\`\n${entry.message}\n\`\`\``;
}
