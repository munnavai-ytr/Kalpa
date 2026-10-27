import { resolveRelativePath } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import type { TerminalBackend, TerminalSink } from '@/stores/terminal';
import { terminateActivePythonRun } from './pyodideWorker';
import { terminateActiveJsRun } from './jsWorker';
import { BUILTIN_COMMANDS, runSingleShellCommand } from './shellCommands';

function tokenizeCommand(segment: string): {
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
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>' && segment[i + 1] === '>') {
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
    const mode = rawTokens[redirIdx] as '>' | '>>';
    const target = rawTokens[redirIdx + 1];
    return {
      tokens: rawTokens.slice(0, redirIdx),
      redirect: { mode, target },
    };
  }
  return { tokens: rawTokens };
}

function splitAndChain(line: string): string[] {
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

export class VirtualShellBackend implements TerminalBackend {
  id = 'virtual-shell';
  label = 'Instant Shell';

  private projectId: string;
  private sink: TerminalSink | null = null;
  private cwd = '';
  private buffer = '';
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private busy = false;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  setProjectId(projectId: string) {
    if (this.projectId !== projectId) {
      this.projectId = projectId;
      this.cwd = '';
    }
  }

  attach(sink: TerminalSink) {
    this.sink = sink;
    this.sink.writeln('\x1b[38;2;124;92;255mKalpa Instant Shell\x1b[0m — type \x1b[1mhelp\x1b[0m for commands.');
    this.printPrompt();
  }

  resize(_cols: number, _rows: number) {
    // virtual shell adapts to xterm line wrapping automatically
  }

  dispose() {
    this.sink = null;
  }

  private getPromptString(): string {
    const loc = this.cwd ? `/${this.cwd}` : '~';
    return `\x1b[38;2;255;184;107m${loc}\x1b[0m \x1b[38;2;124;92;255m❯\x1b[0m `;
  }

  private printPrompt() {
    this.sink?.write(this.getPromptString());
  }

  private redrawInputLine() {
    if (!this.sink) return;
    const prompt = this.getPromptString();
    const tailOffset = this.buffer.length - this.cursor;
    let seq = `\r\x1b[2K${prompt}${this.buffer}`;
    if (tailOffset > 0) {
      seq += `\x1b[${tailOffset}D`;
    }
    this.sink.write(seq);
  }

  write(data: string) {
    if (!this.sink) return;

    // Ctrl+C
    if (data === '\x03') {
      if (this.busy) {
        terminateActivePythonRun();
        terminateActiveJsRun();
      } else {
        this.sink.writeln('^C');
        this.buffer = '';
        this.cursor = 0;
        this.printPrompt();
      }
      return;
    }

    if (this.busy) return;

    // Ctrl+L
    if (data === '\x0c') {
      this.sink.clear();
      this.redrawInputLine();
      return;
    }

    // Escape sequences (arrows / Home / End)
    if (data === '\x1b[A') {
      // Up
      if (this.history.length === 0) return;
      if (this.histIdx < 0) this.histIdx = this.history.length - 1;
      else if (this.histIdx > 0) this.histIdx -= 1;
      this.buffer = this.history[this.histIdx] ?? '';
      this.cursor = this.buffer.length;
      this.redrawInputLine();
      return;
    }
    if (data === '\x1b[B') {
      // Down
      if (this.histIdx < 0) return;
      if (this.histIdx < this.history.length - 1) {
        this.histIdx += 1;
        this.buffer = this.history[this.histIdx] ?? '';
      } else {
        this.histIdx = -1;
        this.buffer = '';
      }
      this.cursor = this.buffer.length;
      this.redrawInputLine();
      return;
    }
    if (data === '\x1b[D') {
      if (this.cursor > 0) {
        this.cursor -= 1;
        this.sink.write('\x1b[D');
      }
      return;
    }
    if (data === '\x1b[C') {
      if (this.cursor < this.buffer.length) {
        this.cursor += 1;
        this.sink.write('\x1b[C');
      }
      return;
    }
    if (data === '\x1b[H' || data === '\x01') {
      this.cursor = 0;
      this.redrawInputLine();
      return;
    }
    if (data === '\x1b[F' || data === '\x05') {
      this.cursor = this.buffer.length;
      this.redrawInputLine();
      return;
    }

    // Tab completion
    if (data === '\t') {
      void this.handleTabComplete();
      return;
    }

    // Process character-by-character (handles multi-character paste cleanly)
    for (let i = 0; i < data.length; i++) {
      const ch = data[i];
      if (ch === '\r' || ch === '\n') {
        const line = this.buffer;
        this.buffer = '';
        this.cursor = 0;
        this.histIdx = -1;
        this.sink.writeln('');
        void this.executeLine(line);
        return;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (this.cursor > 0) {
          this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
          this.cursor -= 1;
          this.redrawInputLine();
        }
        continue;
      }
      if (ch >= ' ') {
        this.buffer = this.buffer.slice(0, this.cursor) + ch + this.buffer.slice(this.cursor);
        this.cursor += 1;
        this.redrawInputLine();
      }
    }
  }

  private async handleTabComplete() {
    const before = this.buffer.slice(0, this.cursor);
    const parts = before.split(/\s+/);
    const last = parts[parts.length - 1] ?? '';

    if (parts.length <= 1) {
      const matches = BUILTIN_COMMANDS.filter((c) => c.startsWith(last));
      if (matches.length === 1) {
        const rest = `${matches[0].slice(last.length)} `;
        this.buffer = before + rest + this.buffer.slice(this.cursor);
        this.cursor += rest.length;
        this.redrawInputLine();
      }
      return;
    }

    const allFiles = await vfs.list(this.projectId);
    const prefix = this.cwd ? `${this.cwd}/` : '';
    const relPaths = allFiles
      .map((f) => f.path)
      .filter((p) => !p.endsWith('/.gitkeep') && p.startsWith(prefix))
      .map((p) => p.slice(prefix.length));

    const matches = relPaths.filter((p) => p.startsWith(last));
    if (matches.length === 1) {
      const rest = matches[0].slice(last.length);
      this.buffer = before + rest + this.buffer.slice(this.cursor);
      this.cursor += rest.length;
      this.redrawInputLine();
    }
  }

  private async executeLine(rawLine: string) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      this.printPrompt();
      return;
    }

    this.history.push(trimmed);
    this.busy = true;

    try {
      const segments = splitAndChain(trimmed);
      for (const seg of segments) {
        const { tokens, redirect } = tokenizeCommand(seg);
        if (tokens.length === 0) continue;
        const [cmd, ...args] = tokens;
        const captured: string[] = [];

        const res = await runSingleShellCommand(cmd, args, {
          projectId: this.projectId,
          cwd: this.cwd,
          setCwd: (next) => {
            this.cwd = next;
          },
          history: this.history,
          println: (line) => {
            if (redirect) captured.push(line);
            else this.sink?.writeln(line);
          },
          printErr: (line) => {
            this.sink?.writeln(`\x1b[38;2;255;92;108m${line}\x1b[0m`);
          },
          clearScreen: () => this.sink?.clear(),
        });

        const finalLines = [...captured, ...res.output];
        if (redirect) {
          const targetPath = resolveRelativePath(this.cwd, redirect.target);
          const textBody = `${finalLines.join('\n')}${finalLines.length ? '\n' : ''}`;
          if (redirect.mode === '>>') {
            const prev = await vfs.read(this.projectId, targetPath);
            await vfs.write(this.projectId, targetPath, `${prev?.content ?? ''}${textBody}`);
          } else {
            await vfs.write(this.projectId, targetPath, textBody);
          }
        } else {
          for (const line of res.output) {
            this.sink?.writeln(line);
          }
        }

        if (!res.ok) break;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sink?.writeln(`\x1b[38;2;255;92;108mError: ${msg}\x1b[0m`);
    } finally {
      this.busy = false;
      this.printPrompt();
    }
  }
}
