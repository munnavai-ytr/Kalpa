import { capToolResultText } from './tokens';

function escAttr(v: string | number | boolean): string {
  return String(v).replace(/"/g, '&quot;');
}

export function formatReadResult(
  path: string,
  linesRange: string,
  totalLines: number,
  rawText: string
): string {
  const { text } = capToolResultText(rawText);
  return `<result action="read" path="${escAttr(path)}" lines="${escAttr(linesRange)}" total="${totalLines}">\n${text}\n</result>`;
}

export function formatSearchResult(query: string, matchesCount: number, body: string): string {
  const { text } = capToolResultText(body);
  return `<result action="search" query="${escAttr(query)}" matches="${matchesCount}">\n${text}\n</result>`;
}

export function formatListResult(path: string, depth: number, treeText: string): string {
  const { text } = capToolResultText(treeText);
  return `<result action="list" path="${escAttr(path)}" depth="${depth}">\n${text}\n</result>`;
}

export function formatImpactResult(labelAttr: { target?: string; symbol?: string }, body: string): string {
  const attr = labelAttr.target
    ? `target="${escAttr(labelAttr.target)}"`
    : `symbol="${escAttr(labelAttr.symbol || '')}"`;
  const { text } = capToolResultText(body);
  return `<result action="impact" ${attr}>\n${text}\n</result>`;
}

export function formatEditResult(path: string, status: 'ok' | 'error', detail = ''): string {
  if (status === 'ok') {
    return `<result action="edit" path="${escAttr(path)}" status="ok">${detail}</result>`;
  }
  return `<result action="edit" path="${escAttr(path)}" status="error">\n${detail}\n</result>`;
}

export function formatFileResult(
  path: string,
  status: 'ok' | 'error' | 'rejected',
  reason = ''
): string {
  if (!reason) {
    return `<result action="file" path="${escAttr(path)}" status="${status}"></result>`;
  }
  return `<result action="file" path="${escAttr(path)}" status="${status}">\n${reason}\n</result>`;
}

export function formatPathOpResult(
  action: 'delete' | 'move',
  pathLabel: string,
  status: 'ok' | 'error' | 'rejected',
  reason = ''
): string {
  return `<result action="${action}" path="${escAttr(pathLabel)}" status="${status}">${reason ? `\n${reason}\n` : ''}</result>`;
}

export function formatShellResult(exitCode: number, ms: number, combinedOutput: string): string {
  const { text, truncated } = capToolResultText(combinedOutput);
  return `<result action="shell" exit="${exitCode}" ms="${Math.round(ms)}" truncated="${truncated}">\n${text}\n</result>`;
}

export function formatMemoryResult(file: string, status: 'ok' | 'error', errorText = ''): string {
  return `<result action="memory" file="${escAttr(file)}" status="${status}">${errorText ? `\n${errorText}\n` : ''}</result>`;
}

export function formatPreviewResult(
  status: 'ok' | 'error',
  settledMs: number,
  body: string
): string {
  const { text } = capToolResultText(body);
  return `<result action="preview" status="${status}" settled_ms="${Math.round(settledMs)}">\n${text}\n</result>`;
}

export function formatDevServerResult(
  port: number,
  status: 'running' | 'crashed' | 'starting',
  logTail: string
): string {
  const { text } = capToolResultText(logTail);
  return `<result action="devserver" port="${port}" status="${status}">\n${text}\n</result>`;
}

export function formatAppNoticeResult(message: string): string {
  return `<result action="app-notice">\n${message}\n</result>`;
}

export function bundleResultBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join('\n\n');
}
