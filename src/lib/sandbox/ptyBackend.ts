import type { TerminalBackend, TerminalSink } from '@/stores/terminal';
import type { SandboxSession } from './provider';

export class PtyTerminalBackend implements TerminalBackend {
  id = 'cloud-pty';
  label = 'Cloud Linux PTY';

  private session: SandboxSession;
  private sink: TerminalSink | null = null;
  private ptyHandle: {
    write(d: string): void;
    resize(c: number, r: number): void;
    close(): void;
  } | null = null;
  private cols = 80;
  private rows = 24;
  private disposed = false;
  private pendingInput: string[] = [];

  constructor(session: SandboxSession) {
    this.session = session;
  }

  attach(sink: TerminalSink) {
    this.sink = sink;
    this.disposed = false;
    this.sink.writeln(
      `\x1b[38;2;61;220;151m● Connected to Cloud Sandbox (${this.session.id})\x1b[0m — Ubuntu Linux bash`
    );

    void this.session
      .openPty({
        cols: this.cols,
        rows: this.rows,
        onData: (chunk) => {
          if (!this.disposed) {
            this.sink?.write(chunk);
          }
        },
      })
      .then((handle) => {
        if (this.disposed) {
          handle.close();
          return;
        }
        this.ptyHandle = handle;
        for (const queued of this.pendingInput) {
          handle.write(queued);
        }
        this.pendingInput = [];
      })
      .catch((err) => {
        if (!this.disposed) {
          const msg = err instanceof Error ? err.message : String(err);
          this.sink?.writeln(`\r\n\x1b[38;2;255;92;108m[PTY Error] ${msg}\x1b[0m`);
        }
      });
  }

  write(data: string) {
    if (this.disposed) return;
    if (this.ptyHandle) {
      this.ptyHandle.write(data);
    } else {
      this.pendingInput.push(data);
    }
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.ptyHandle?.resize(cols, rows);
  }

  dispose() {
    this.disposed = true;
    this.ptyHandle?.close();
    this.ptyHandle = null;
    this.sink = null;
  }
}
