export const CHARS_PER_TOKEN = 3.6;
export const MAX_TOOL_RESULT_CHARS = 8000;
export const TOOL_RESULT_SLICE = 3500;

export function estimateTokens(s: string): number {
  if (!s) return 0;
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

export interface ContextAllocation {
  totalBudget: number;
  brainBudget: number;
  indexBudget: number;
  selectedFilesBudget: number;
  conversationBudget: number;
}

export function computeContextAllocation(
  contextTokens: number,
  maxOutputTokens: number
): ContextAllocation {
  const safeCtx = Math.max(8192, contextTokens || 128000);
  const safeOut = Math.min(Math.floor(safeCtx * 0.4), Math.max(512, maxOutputTokens || 8192));
  const B = Math.max(4000, Math.floor(safeCtx * 0.8 - safeOut));

  return {
    totalBudget: B,
    brainBudget: Math.floor(B * 0.25),
    indexBudget: Math.floor(B * 0.08),
    selectedFilesBudget: Math.floor(B * 0.35),
    conversationBudget: Math.floor(B * 0.2),
  };
}

export function capToolResultText(
  raw: string,
  maxChars: number = MAX_TOOL_RESULT_CHARS
): { text: string; truncated: boolean } {
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false };
  }
  const head = raw.slice(0, TOOL_RESULT_SLICE);
  const tail = raw.slice(-TOOL_RESULT_SLICE);
  const omitted = raw.length - head.length - tail.length;
  return {
    text: `${head}\n...[ ${omitted} chars omitted ]...\n${tail}`,
    truncated: true,
  };
}
