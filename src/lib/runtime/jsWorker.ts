import { uid } from '@/lib/utils';

export interface JsRunOptions {
  entryFile?: string;
  code?: string;
  files?: Record<string, string>;
  args?: string[];
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  timeoutMs?: number;
}

export interface JsRunResult {
  ok: boolean;
  durationMs: number;
  error?: string;
}

let activeAbortFn: (() => void) | null = null;

export function terminateActiveJsRun(): boolean {
  if (activeAbortFn) {
    activeAbortFn();
    return true;
  }
  return false;
}

export function runJsInWorker(opts: JsRunOptions): Promise<JsRunResult> {
  const start = performance.now();
  const timeoutMs = opts.timeoutMs ?? 15000;
  const worker = new Worker('/workers/js-worker.js');
  const id = uid('js');

  return new Promise<JsRunResult>((resolve) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      activeAbortFn = null;
      clearTimeout(timer);
      worker.terminate();
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: `Execution timed out after ${Math.round(timeoutMs / 1000)}s (worker terminated).`,
      });
    }, timeoutMs);

    activeAbortFn = () => {
      if (settled) return;
      cleanup();
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: 'Execution interrupted (Ctrl+C).',
      });
    };

    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.id !== id) return;
      if (data.type === 'stdout') {
        opts.onStdout?.(data.line);
      } else if (data.type === 'stderr') {
        opts.onStderr?.(data.line);
      } else if (data.type === 'done') {
        cleanup();
        resolve({ ok: true, durationMs: Math.round(performance.now() - start) });
      } else if (data.type === 'error') {
        cleanup();
        resolve({
          ok: false,
          durationMs: Math.round(performance.now() - start),
          error: data.error,
        });
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      cleanup();
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: err.message || 'JS Worker error',
      });
    };

    worker.postMessage({
      id,
      entryFile: opts.entryFile,
      code: opts.code,
      files: opts.files ?? {},
      args: opts.args ?? [],
    });
  });
}
