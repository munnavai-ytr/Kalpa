import { resolveRelativePath } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import { runSingleShellCommand } from './shellCommands';

function tokenizeSegment(segment: string): {
  tokens: string[];
  redirect?: { mode: '>' | '>>'; target: string };
} {
  const rawTokens: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>' && segment[i + 1] === '>') {
      if (cur) rawTokens.push(cur);
      cur = '';
      rawTokens.push('>>');
      i += 1;
    } else if (ch === '>') {
      if (cur) rawTokens.push(cur);
      cur = '';
      rawTokens.push('>');
    } else if (/\s/.test(ch)) {
      if (cur) {
        rawTokens.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) rawTokens.push(cur);

  const redirIdx = rawTokens.findIndex((t) => t === '>' || t === '>>');
  if (redirIdx >= 0 && rawTokens[redirIdx + 1]) {
    return {
      tokens: rawTokens.slice(0, redirIdx),
      redirect: { mode: rawTokens[redirIdx] as '>' | '>>', target: rawTokens[redirIdx + 1] },
    };
  }
  return { tokens: rawTokens };
}

function splitChain(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '&' && line[i + 1] === '&') {
      parts.push(cur.trim());
      cur = '';
      i += 1;
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

/**
 * Executes a command line against Kalpa's Instant Virtual Shell for <shell> actions
 * when Engine === 'instant'.
 */
export async function runVirtualShellProgrammatic(
  projectId: string,
  commandLine: string,
  onOutput?: (line: string, isErr: boolean) => void
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let cwd = '';
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let exitCode = 0;

  const segments = splitChain(commandLine.trim());
  for (const seg of segments) {
    const { tokens, redirect } = tokenizeSegment(seg);
    if (tokens.length === 0) continue;
    const [cmd, ...args] = tokens;
    const captured: string[] = [];

    const res = await runSingleShellCommand(cmd, args, {
      projectId,
      cwd,
      setCwd: (next) => {
        cwd = next;
      },
      history: [],
      println: (line) => {
        if (redirect) captured.push(line);
        else {
          stdoutLines.push(line);
          onOutput?.(line, false);
        }
      },
      printErr: (line) => {
        stderrLines.push(line);
        onOutput?.(line, true);
      },
      clearScreen: () => {},
    });

    const allSegOut = [...captured, ...res.output];
    if (redirect) {
      const targetPath = resolveRelativePath(cwd, redirect.target);
      if (!targetPath.startsWith('.kalpa/')) {
        const textBody = `${allSegOut.join('\n')}${allSegOut.length ? '\n' : ''}`;
        if (redirect.mode === '>>') {
          const prev = await vfs.read(projectId, targetPath);
          await vfs.write(projectId, targetPath, `${prev?.content ?? ''}${textBody}`);
        } else {
          await vfs.write(projectId, targetPath, textBody);
        }
      }
    } else {
      for (const l of res.output) {
        stdoutLines.push(l);
        onOutput?.(l, false);
      }
    }

    if (!res.ok) {
      exitCode = 1;
      break;
    }
  }

  return {
    exitCode,
    stdout: stdoutLines.join('\n'),
    stderr: stderrLines.join('\n'),
  };
}
