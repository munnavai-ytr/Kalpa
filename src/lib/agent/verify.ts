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

  // A8: Cloud Sandbox verification (status, host-probe, beacon runtime errors, blank screen, real logs)
  if (opts.engine === 'cloud') {
    let sbState = useSandboxStore.getState();
    const blocks: string[] = [];
    let hasError = false;
    let sig = '';

    if (sbState.status === 'connected') {
      // Ensure dev server is started if runnable files exist
      if (sbState.devServerStatus === 'stopped') {
        await sbState.ensureDevServerRunning(projectId);
        sbState = useSandboxStore.getState();
      }

      // Wait up to 45s if server is currently installing or starting
      const settleDeadline = Date.now() + 45_000;
      while (
        Date.now() < settleDeadline &&
        !opts.signal?.aborted &&
        (sbState.devServerStatus === 'installing' || sbState.devServerStatus === 'starting')
      ) {
        await new Promise((r) => setTimeout(r, 600));
        sbState = useSandboxStore.getState();
      }

      if (sbState.devServerStatus === 'running') {
        const hostCheck = await sbState.probeActiveHost();
        if (!hostCheck.ok && hostCheck.blockedMessage) {
          hasError = true;
          const detail = `${hostCheck.blockedMessage}\n\nRecent server logs:\n${sbState.devServerLogTail}`;
          sig = normalizeErrorSignature(`host-blocked:${hostCheck.blockedMessage}`);
          blocks.push(formatDevServerResult(sbState.devServerPort, 'crashed', detail));
        } else {
          // Give cloud-beacon 1.6s to report runtime errors or blank screen if iframe is mounted
          await new Promise((r) => setTimeout(r, 1600));
          sbState = useSandboxStore.getState();

          if (sbState.cloudBeaconErrors.length > 0) {
            hasError = true;
            const errLines = sbState.cloudBeaconErrors
              .map((e) => `${e.source ? `${e.source}${e.line ? `:${e.line}` : ''}: ` : ''}${e.message}`)
              .join('\n');
            const detail = `Browser runtime errors in Cloud preview:\n${errLines}\n\nServer logs:\n${sbState.devServerLogTail}`;
            sig = normalizeErrorSignature(`cloud-beacon:${errLines}`);
            blocks.push(formatPreviewResult('error', 1600, detail));
          } else if (sbState.cloudBlankScreen) {
            hasError = true;
            const detail =
              `Cloud preview started on port ${sbState.devServerPort} but rendered a blank screen (#root/#app/#__next is empty and body text length < 5).\n\n` +
              `Server logs:\n${sbState.devServerLogTail || '(no server errors)'}`;
            sig = normalizeErrorSignature(`cloud-blank:${sbState.devServerPort}`);
            blocks.push(formatPreviewResult('error', 1600, detail));
          } else {
            blocks.push(
              formatDevServerResult(
                sbState.devServerPort,
                'running',
                sbState.devServerLogTail || '(dev server clean, public host probe passed)'
              )
            );
          }
        }
      } else if (sbState.devServerStatus === 'crashed' || sbState.hostBlockedMessage) {
        hasError = true;
        const realLog = [
          sbState.hostBlockedMessage,
          sbState.devServerLogTail || 'Dev server exited unexpectedly.',
        ]
          .filter(Boolean)
          .join('\n\n');
        sig = normalizeErrorSignature(`devserver-crashed:${realLog.slice(-260)}`);
        blocks.push(formatDevServerResult(sbState.devServerPort, 'crashed', realLog));
      } else if (sbState.devServerStatus !== 'stopped') {
        blocks.push(
          formatDevServerResult(
            sbState.devServerPort,
            'starting',
            sbState.devServerLogTail || '(dev server still starting)'
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

  // Web preview (Static HTML or Sandpack): wait up to 4.2s to settle + receive preview-probe (B3)
  usePreviewStore.getState().clearEntries();
  const deadline = Date.now() + 4200;
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
    if (st.status === 'blank') {
      const settledMs = performance.now() - tStart;
      const body =
        'Instant preview rendered a blank screen (#root/#app/#__next has 0 children and body text length < 5). Ensure your entry file mounts a visible component cleanly.';
      return {
        hasError: true,
        errorSignature: 'instant-preview-blank',
        resultBlocks: [formatPreviewResult('error', settledMs, body)],
      };
    }
    if (st.status === 'ready' && Date.now() - (deadline - 4200) >= 1750) {
      break;
    }
  }

  const settledMs = performance.now() - tStart;
  const finalState = usePreviewStore.getState();
  const finalErrs = finalState.entries.filter((e) => e.level === 'error');
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
  if (finalState.status === 'blank') {
    const body =
      'Instant preview rendered a blank screen (#root/#app/#__next has 0 children and body text length < 5). Ensure your entry file mounts a visible component cleanly.';
    return {
      hasError: true,
      errorSignature: 'instant-preview-blank',
      resultBlocks: [formatPreviewResult('error', settledMs, body)],
    };
  }

  return {
    hasError: false,
    errorSignature: '',
    resultBlocks: [formatPreviewResult('ok', settledMs, 'Preview compiled and rendered with 0 errors.')],
  };
}
