import { detectProjectType } from '@/lib/preview/detect';
import { runJsInWorker } from '@/lib/runtime/jsWorker';
import { runPythonInWorker } from '@/lib/runtime/pyodideWorker';
import { vfs } from '@/lib/vfs/vfs';
import { usePreviewStore } from '@/stores/preview';
import { useSandboxStore } from '@/stores/sandbox';
import type { EngineKind } from '@/lib/vfs/db';
import {
  formatAppNoticeResult,
  formatDevServerResult,
  formatPreviewResult,
} from './results';

export interface VerificationResult {
  hasError: boolean;
  errorSignature: string;
  resultBlocks: string[];
}

function normalizeErrorSignature(text: string): string {
  return text
    .replace(/\d+:\d+/g, 'L:C')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

export async function verifyWorkspaceAfterWrites(
  projectId: string,
  opts: {
    engine: EngineKind;
    modifiedCodeFiles: boolean;
    hasRunVerificationShell: boolean;
    signal?: AbortSignal;
  }
): Promise<VerificationResult> {
  if (!opts.modifiedCodeFiles) {
    return { hasError: false, errorSignature: '', resultBlocks: [] };
  }

  // Cloud Sandbox verification
  if (opts.engine === 'cloud') {
    const sbState = useSandboxStore.getState();
    const blocks: string[] = [];
    let hasError = false;
    let sig = '';

    if (sbState.status === 'connected') {
      if (sbState.devServerStatus === 'crashed') {
        hasError = true;
        sig = normalizeErrorSignature(`devserver-crashed:${sbState.devServerLogTail.slice(-200)}`);
        blocks.push(
          formatDevServerResult(
            sbState.devServerPort,
            'crashed',
            sbState.devServerLogTail || 'Dev server exited unexpectedly.'
          )
        );
      } else {
        const mappedStatus = sbState.devServerStatus === 'running' ? 'running' : 'starting';
        blocks.push(
          formatDevServerResult(
            sbState.devServerPort,
            mappedStatus,
            sbState.devServerLogTail || '(dev server clean)'
          )
        );
      }

      if (!opts.hasRunVerificationShell) {
        hasError = true;
        sig = sig || 'cloud-verify-required';
        blocks.push(
          formatAppNoticeResult(
            'verify-required: You modified code in Cloud Sandbox mode without running a <shell> verification check (for example typecheck, build, test, or curl). Run a verification command before finishing.'
          )
        );
      }
    }

    return { hasError, errorSignature: sig, resultBlocks: blocks };
  }

  // Instant Engine verification
  const snap = await vfs.snapshot(projectId);
  const det = detectProjectType(snap);
  const tStart = performance.now();

  if (det.type === 'empty') {
    return { hasError: false, errorSignature: '', resultBlocks: [] };
  }

  if (det.type === 'cloud-only') {
    return {
      hasError: false,
      errorSignature: '',
      resultBlocks: [formatPreviewResult('ok', 0, `Cloud-only stack (${det.reason})`)],
    };
  }

  // Pure Python or JS/TS script verification in Worker
  if (det.type === 'python') {
    const entry =
      det.entry ||
      (snap['main.py'] !== undefined
        ? 'main.py'
        : Object.keys(snap).find((p) => p.endsWith('.py') && !p.startsWith('.kalpa/')));
    if (entry) {
      const filesForPy: Record<string, string> = {};
      for (const [k, v] of Object.entries(snap)) {
        if (!k.startsWith('.kalpa/')) filesForPy[k] = v;
      }
      const stderrLines: string[] = [];
      const stdoutLines: string[] = [];
      const res = await runPythonInWorker({
        file: entry,
        files: filesForPy,
        onStdout: (l) => stdoutLines.push(l),
        onStderr: (l) => stderrLines.push(l),
        timeoutMs: 12_000,
      });
      const settledMs = performance.now() - tStart;
      if (!res.ok) {
        const errBody = [res.error, ...stderrLines].filter(Boolean).join('\n');
        return {
          hasError: true,
          errorSignature: normalizeErrorSignature(errBody),
          resultBlocks: [formatPreviewResult('error', settledMs, errBody)],
        };
      }
      return {
        hasError: false,
        errorSignature: '',
        resultBlocks: [
          formatPreviewResult(
            'ok',
            settledMs,
            stdoutLines.slice(0, 20).join('\n') || `Python ${entry} ran cleanly.`
          ),
        ],
      };
    }
  }

  if (det.type === 'node-script') {
    const entry =
      det.entry ||
      (snap['index.js'] !== undefined
        ? 'index.js'
        : snap['main.js'] !== undefined
          ? 'main.js'
          : Object.keys(snap).find((p) => /\.(js|mjs|cjs)$/.test(p) && !p.startsWith('.kalpa/')));
    if (entry && snap[entry] !== undefined) {
      const stderrLines: string[] = [];
      const stdoutLines: string[] = [];
      const res = await runJsInWorker({
        entryFile: entry,
        code: snap[entry],
        files: snap,
        onStdout: (l) => stdoutLines.push(l),
        onStderr: (l) => stderrLines.push(l),
        timeoutMs: 5_000,
      });
      const settledMs = performance.now() - tStart;
      if (!res.ok) {
        const errBody = [res.error, ...stderrLines].filter(Boolean).join('\n');
        return {
          hasError: true,
          errorSignature: normalizeErrorSignature(errBody),
          resultBlocks: [formatPreviewResult('error', settledMs, errBody)],
        };
      }
      return {
        hasError: false,
        errorSignature: '',
        resultBlocks: [
          formatPreviewResult('ok', settledMs, stdoutLines.slice(0, 20).join('\n') || 'JS ran cleanly.'),
        ],
      };
    }
  }

  // Web preview (Static HTML or Sandpack React/Next-Lite): wait up to 4s to settle
  usePreviewStore.getState().clearEntries();
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) break;
    await new Promise((r) => setTimeout(r, 350));
    const st = usePreviewStore.getState();
    const errs = st.entries.filter((e) => e.level === 'error');
    if (errs.length > 0) {
      const settledMs = performance.now() - tStart;
      const body = errs
        .map((e) => `${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}: ` : ''}${e.message}`)
        .join('\n');
      return {
        hasError: true,
        errorSignature: normalizeErrorSignature(body),
        resultBlocks: [formatPreviewResult('error', settledMs, body)],
      };
    }
    if (st.status === 'ready' && Date.now() - (deadline - 4000) >= 1100) {
      break;
    }
  }

  const settledMs = performance.now() - tStart;
  const finalErrs = usePreviewStore.getState().entries.filter((e) => e.level === 'error');
  if (finalErrs.length > 0) {
    const body = finalErrs
      .map((e) => `${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}: ` : ''}${e.message}`)
      .join('\n');
    return {
      hasError: true,
      errorSignature: normalizeErrorSignature(body),
      resultBlocks: [formatPreviewResult('error', settledMs, body)],
    };
  }

  return {
    hasError: false,
    errorSignature: '',
    resultBlocks: [formatPreviewResult('ok', settledMs, 'Preview compiled and rendered with 0 errors.')],
  };
}
