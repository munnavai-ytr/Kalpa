import { estimateTokens } from '@/lib/agent/tokens';
import type { BrainMemoryFile } from './caps';

function takeLastH2Entries(markdown: string, count: number): string {
  if (count <= 0) return '';
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  const parts = normalized.split(/\n(?=##\s+)/);
  if (parts.length <= 1) return normalized;
  const heading = parts[0].startsWith('## ') ? '' : parts[0];
  const entries = parts[0].startsWith('## ') ? parts : parts.slice(1);
  const sliced = entries.slice(-count);
  return [heading, ...sliced].filter(Boolean).join('\n\n').trim();
}

function extractOpenKnownIssues(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const openMatch = /##\s+Open\b([\s\S]*?)(?=\n##\s+|$)/i.exec(normalized);
  if (!openMatch) return normalized.trim();
  return `# Known Issues (Open)\n${openMatch[1].trim()}`;
}

function compactHeadingsAndFirstLines(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let keptUnderSection = 0;

  for (const line of lines) {
    const t = line.trim();
    if (/^#{1,3}\s+/.test(t)) {
      out.push(t);
      keptUnderSection = 0;
    } else if (t && keptUnderSection < 2 && !t.startsWith('<!--')) {
      out.push(line);
      keptUnderSection++;
    }
  }
  return out.join('\n').trim();
}

export interface BrainPackOptions {
  budgetTokens: number;
  /** 0 = normal, 1 = shrink decisions/changelog further, 2 = minimal (drop decisions & changelog) */
  shrinkLevel?: 0 | 1 | 2;
}

export function brainPack(
  memory: Record<BrainMemoryFile, string>,
  opts: BrainPackOptions
): string {
  const { budgetTokens, shrinkLevel = 0 } = opts;

  const buildCandidate = (
    decisionsLimit: number,
    changelogLimit: number,
    compactArchAndConv: boolean
  ): string => {
    const sections: string[] = [];

    sections.push(`### brief.md\n${memory.brief.trim()}`);
    sections.push(
      `### architecture.md\n${
        compactArchAndConv
          ? compactHeadingsAndFirstLines(memory.architecture)
          : memory.architecture.trim()
      }`
    );
    sections.push(
      `### conventions.md\n${
        compactArchAndConv
          ? compactHeadingsAndFirstLines(memory.conventions)
          : memory.conventions.trim()
      }`
    );

    if (decisionsLimit > 0 && memory.decisions.trim()) {
      sections.push(`### decisions.md\n${takeLastH2Entries(memory.decisions, decisionsLimit)}`);
    }

    sections.push(`### tasks.md\n${memory.tasks.trim()}`);

    const openIssues = extractOpenKnownIssues(memory['known-issues']);
    if (openIssues) {
      sections.push(`### known-issues.md\n${openIssues}`);
    }

    if (changelogLimit > 0 && memory.changelog.trim()) {
      sections.push(`### changelog.md\n${takeLastH2Entries(memory.changelog, changelogLimit)}`);
    }

    if (memory.summary.trim()) {
      sections.push(`### summary.md\n${memory.summary.trim()}`);
    }

    return `<project_memory>\n${sections.join('\n\n')}\n</project_memory>`;
  };

  if (shrinkLevel === 2) {
    return buildCandidate(0, 0, true);
  }
  if (shrinkLevel === 1) {
    return buildCandidate(4, 2, true);
  }

  const full = buildCandidate(15, 8, false);
  if (estimateTokens(full) <= budgetTokens) {
    return full;
  }

  return buildCandidate(8, 4, true);
}
