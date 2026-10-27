import { uid } from '@/lib/utils';

export interface PyodideRunOptions {
  file?: string;
  code?: string;
  files?: Record<string, string>;
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  onStatus?: (msg: string) => void;
  timeoutMs?: number;
}

export interface PyodideRunResult {
  ok: boolean;
  durationMs: number;
  error?: string;
  result?: string;
  updatedFiles?: Record<string, string>;
}

let sharedWorker: Worker | null = null;
let currentCancel: (() => void) | null = null;

function getOrCreatePyWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker('/workers/pyodide-worker.js');
  }
  return sharedWorker;
}

export function terminateActivePythonRun(): boolean {
  if (currentCancel) {
    currentCancel();
    return true;
  }
  return false;
}

async function dispatchPyWorker(
  payload: Record<string, unknown>,
  callbacks: {
    onStdout?: (line: string) => void;
    onStderr?: (line: string) => void;
    onStatus?: (msg: string) => void;
    timeoutMs: number;
  }
): Promise<PyodideRunResult> {
  const start = performance.now();
  const worker = getOrCreatePyWorker();
  const id = uid('py');

  return new Promise<PyodideRunResult>((resolve) => {
    let settled = false;

    const cleanup = () => {
      settled = true;
      currentCancel = null;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      cleanup();
      worker.terminate();
      sharedWorker = null;
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: `Execution timed out after ${Math.round(callbacks.timeoutMs / 1000)}s (worker terminated).`,
      });
    }, callbacks.timeoutMs);

    currentCancel = () => {
      if (settled) return;
      cleanup();
      worker.terminate();
      sharedWorker = null;
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: 'Execution interrupted (Ctrl+C).',
      });
    };

    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data) return;
      if (data.type === 'status') {
        callbacks.onStatus?.(data.message);
        return;
      }
      if (data.id !== id) return;
      if (data.type === 'stdout') {
        callbacks.onStdout?.(data.line);
      } else if (data.type === 'stderr') {
        callbacks.onStderr?.(data.line);
      } else if (data.type === 'done') {
        cleanup();
        resolve({
          ok: true,
          durationMs: Math.round(performance.now() - start),
          result: data.result,
          updatedFiles: data.updatedFiles,
        });
      } else if (data.type === 'error') {
        cleanup();
        resolve({
          ok: false,
          durationMs: Math.round(performance.now() - start),
          error: data.error,
        });
      }
    };

    const onError = (err: ErrorEvent) => {
      if (settled) return;
      cleanup();
      worker.terminate();
      sharedWorker = null;
      resolve({
        ok: false,
        durationMs: Math.round(performance.now() - start),
        error: err.message || 'Pyodide worker failed to load',
      });
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ ...payload, id });
  });
}

export function runPythonInWorker(opts: PyodideRunOptions): Promise<PyodideRunResult> {
  return dispatchPyWorker(
    {
      action: 'run',
      file: opts.file,
      code: opts.code,
      files: opts.files ?? {},
    },
    {
      onStdout: opts.onStdout,
      onStderr: opts.onStderr,
      onStatus: opts.onStatus,
      timeoutMs: opts.timeoutMs ?? 30000,
    }
  );
}

export function installPipPackagesInWorker(
  packages: string[],
  callbacks: Pick<PyodideRunOptions, 'onStdout' | 'onStderr' | 'onStatus'>
): Promise<PyodideRunResult> {
  return dispatchPyWorker(
    { action: 'pip', packages },
    {
      ...callbacks,
      timeoutMs: 30000,
    }
  );
}

export function pingPyodideWorker(onStatus?: (msg: string) => void): Promise<PyodideRunResult> {
  return dispatchPyWorker(
    { action: 'ping' },
    { onStatus, timeoutMs: 30000 }
  );
}
