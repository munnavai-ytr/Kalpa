export interface SandboxSession {
  id: string;
  expiresAt: number; // epoch ms
  writeFiles(files: { path: string; content: string }[]): Promise<void>;
  readFile(path: string): Promise<string>;
  remove(path: string): Promise<void>;
  exec(
    cmd: string,
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      onStdout?: (s: string) => void;
      onStderr?: (s: string) => void;
    }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  startBackground(
    cmd: string,
    opts?: {
      cwd?: string;
      onStdout?: (s: string) => void;
      onStderr?: (s: string) => void;
      onExit?: (exitCode: number, errMsg?: string) => void;
    }
  ): Promise<{ stop(): Promise<void> }>;
  openPty(opts: {
    cols: number;
    rows: number;
    onData: (d: string) => void;
  }): Promise<{
    write(d: string): void;
    resize(c: number, r: number): void;
    close(): void;
  }>;
  getPreviewUrl(port: number): string;
  extend(ms: number): Promise<number>; // returns new expiresAt
  kill(): Promise<void>;
}
