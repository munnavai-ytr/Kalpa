import { isBrainPath } from '@/lib/brain/caps';
import { rebuildBrainIndex } from '@/lib/brain/index';
import { createCheckpoint } from '@/lib/checkpoints/checkpoints';
import { detectProjectType } from '@/lib/preview/detect';
import { runJsInWorker } from '@/lib/runtime/jsWorker';
import { runPythonInWorker } from '@/lib/runtime/pyodideWorker';
import type { SandboxSession } from '@/lib/sandbox/provider';
import { mirrorChangesToActiveSandbox } from '@/lib/sandbox/sync';
import { getKalpaDB, type EngineKind } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import { uid } from '@/lib/utils';
import { useBrainStore } from '@/stores/brain';
import { usePreviewStore } from '@/stores/preview';
import {
  useSandboxStore,
  type CloudTailwindUnappliedReason,
} from '@/stores/sandbox';
import { filesHash } from './reliability';
import {
  formatAppNoticeResult,
  formatDevServerResult,
  formatPreviewResult,
} from './results';
import {
  applyDoctor,
  runScaffoldDoctor,
  type DoctorIssue,
} from './scaffoldDoctor';
import { computeTurnChanges } from './turnHelpers';

export interface VerificationResult {
  hasError: boolean;
  errorSignature: string;
  resultBlocks: string[];
}

export type ScaffoldDoctorRunSource =
  | 'agent-iteration'
  | 'cloud-devserver'
  | 'sandpack'
  | 'zip-import'
  | 'retry-build'
  | 'manual-check'
  | 'auto-fix-styles';

export interface ProjectScaffoldDoctorRunResult {
  ran: boolean;
  issues: DoctorIssue[];
  relevantIssues: DoctorIssue[];
  changes: Record<string, string | null>;
  changedPaths: string[];
  fixedCount: number;
  hasErrors: boolean;
  hasWarnings: boolean;
  pkgChanged: boolean;
  configChanged: boolean;
  tailwindSetupFixed: boolean;
  appNoticeXml: string | null;
}

const autoCheckedHashesByProject = new Map<string, Set<string>>();
const inFlightByProject = new Map<string, Promise<unknown>>();

function getSeenHashes(projectId: string): Set<string> {
  let set = autoCheckedHashesByProject.get(projectId);
  if (!set) {
    set = new Set<string>();
    autoCheckedHashesByProject.set(projectId, set);
  }
  return set;
}

export function hasAutoCheckedHash(projectId: string, hash: string): boolean {
  return Boolean(hash && autoCheckedHashesByProject.get(projectId)?.has(hash));
}

export function previewImmediateSandpackFiles(
  projectId: string,
  cleanFiles: Record<string, string>,
  currentHash: string
): Record<string, string> {
  if (!projectId || Object.keys(cleanFiles).length === 0) return cleanFiles;
  if (hasAutoCheckedHash(projectId, currentHash)) return cleanFiles;
  const res = runScaffoldDoctor(cleanFiles);
  if (Object.keys(res.changes).length === 0) return cleanFiles;
  return applyDoctor(cleanFiles, res);
}

export async function runProjectScaffoldDoctor(
  projectId: string,
  opts?: {
    source?: ScaffoldDoctorRunSource;
    force?: boolean;
    turnId?: string;
    session?: SandboxSession | null;
  }
): Promise<ProjectScaffoldDoctorRunResult> {
  const prev = inFlightByProject.get(projectId) ?? Promise.resolve();
  const nextPromise = prev
    .catch(() => {})
    .then(() => executeProjectScaffoldDoctor(projectId, opts));
  inFlightByProject.set(projectId, nextPromise);
  try {
    return await nextPromise;
  } finally {
    if (inFlightByProject.get(projectId) === nextPromise) {
      inFlightByProject.delete(projectId);
    }
  }
}

async function executeProjectScaffoldDoctor(
  projectId: string,
  opts?: {
    source?: ScaffoldDoctorRunSource;
    force?: boolean;
    turnId?: string;
    session?: SandboxSession | null;
  }
): Promise<ProjectScaffoldDoctorRunResult> {
  const source = opts?.source ?? 'manual-check';
  const rawSnap = await vfs.snapshot(projectId);
  const workspaceFiles: Record<string, string> = {};
  for (const [p, content] of Object.entries(rawSnap)) {
    if (isBrainPath(p) || p.endsWith('/.gitkeep')) continue;
    workspaceFiles[p] = content;
  }

  if (Object.keys(workspaceFiles).length === 0 && source !== 'manual-check') {
    return {
      ran: false,
      issues: [],
      relevantIssues: [],
      changes: {},
      changedPaths: [],
      fixedCount: 0,
      hasErrors: false,
      hasWarnings: false,
      pkgChanged: false,
      configChanged: false,
      tailwindSetupFixed: false,
      appNoticeXml: null,
    };
  }

  const seenSet = getSeenHashes(projectId);
  const beforeHash = filesHash(workspaceFiles);
  if (!opts?.force && beforeHash && seenSet.has(beforeHash)) {
    return {
      ran: false,
      issues: [],
      relevantIssues: [],
      changes: {},
      changedPaths: [],
      fixedCount: 0,
      hasErrors: false,
      hasWarnings: false,
      pkgChanged: false,
      configChanged: false,
      tailwindSetupFixed: false,
      appNoticeXml: null,
    };
  }

  const docRes = runScaffoldDoctor(workspaceFiles);
  if (beforeHash) seenSet.add(beforeHash);

  const safeChanges: Record<string, string | null> = {};
  for (const [p, c] of Object.entries(docRes.changes)) {
    if (!isBrainPath(p)) safeChanges[p] = c;
  }
  const changedPaths = Object.keys(safeChanges);

  const looksLikeNodeOrJsxApp =
    workspaceFiles['package.json'] !== undefined ||
    Object.keys(workspaceFiles).some(
      (p) => /\.(tsx|jsx)$/.test(p) || /^(vite|next|tailwind|postcss)\.config\./.test(p)
    );

  const relevantIssues = docRes.issues.filter(
    (iss) => iss.id !== 'no-package-json' || looksLikeNodeOrJsxApp
  );

  const fixedCount = relevantIssues.filter((i) => i.status === 'fixed').length;
  const hasErrors = relevantIssues.some((i) => i.status === 'error');
  const hasWarnings = relevantIssues.some((i) => i.status === 'warn');
  const pkgChanged = safeChanges['package.json'] !== undefined;
  const configChanged = changedPaths.some((p) =>
    /^(postcss|tailwind|vite|next)\.config\.|^tsconfig\.json$/.test(p)
  );
  const tailwindSetupFixed = relevantIssues.some(
    (i) =>
      i.status === 'fixed' &&
      (i.id === 'postcss-missing' ||
        i.id === 'tailwind-config-missing' ||
        i.id === 'tw4-with-v3-syntax' ||
        i.id === 'css-not-imported' ||
        ((i.id === 'cjs-in-esm' || i.id === 'esm-in-cjs') &&
          /(tailwind|postcss)\.config/.test(i.message)))
  );

  if (tailwindSetupFixed && !projectId.startsWith('_diag_')) {
    usePreviewStore.getState().setScaffoldTailwindNote(projectId, true);
  }

  const isStandalone = source !== 'agent-iteration' && !projectId.startsWith('_diag_');

  if (changedPaths.length > 0) {
    const db = isStandalone ? await getKalpaDB() : null;
    const proj = db ? await db.get('projects', projectId) : undefined;
    const beforeCp = proj
      ? await createCheckpoint(projectId, 'before: scaffold doctor', opts?.turnId)
      : null;

    const writes: { path: string; content: string; encoding: 'utf8' }[] = [];
    const deletes: string[] = [];
    for (const [p, content] of Object.entries(safeChanges)) {
      if (isBrainPath(p)) continue;
      if (content === null) deletes.push(p);
      else writes.push({ path: p, content, encoding: 'utf8' });
    }

    for (const delPath of deletes) {
      await vfs.remove(projectId, delPath);
    }
    if (writes.length > 0) {
      await vfs.writeMany(projectId, writes);
    }

    const afterWorkspace = applyDoctor(workspaceFiles, {
      issues: docRes.issues,
      changes: safeChanges,
    });
    const afterHash = filesHash(afterWorkspace);
    if (afterHash) seenSet.add(afterHash);

    const activeSb = useSandboxStore.getState();
    const targetSession =
      opts?.session ??
      (activeSb.status === 'connected' && activeSb.projectId === projectId
        ? activeSb.session
        : null);
    if (targetSession) {
      await mirrorChangesToActiveSandbox(projectId, safeChanges, targetSession);
    }

    if (db && proj) {
      const afterSnap = await vfs.snapshot(projectId);
      const filesChanged = computeTurnChanges(rawSnap, afterSnap);
      const afterCp =
        filesChanged.length > 0
          ? await createCheckpoint(projectId, 'after: scaffold doctor', opts?.turnId)
          : undefined;
      await rebuildBrainIndex(projectId);
      await useBrainStore.getState().refreshBrainFromVfs(projectId);
      await db.put('chat', {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        meta: {
          turnId: opts?.turnId ?? uid('turn'),
          beforeCheckpointId: beforeCp?.id,
          afterCheckpointId: afterCp?.id,
          filesChanged,
          scaffoldFixes: [
            {
              id: uid('doc'),
              fixedCount,
              issues: relevantIssues,
            },
          ],
        },
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kalpa:chat-updated', { detail: { projectId } }));
      }
    }
  } else if (
    isStandalone &&
    source === 'zip-import' &&
    (hasErrors || hasWarnings) &&
    relevantIssues.length > 0
  ) {
    const db = await getKalpaDB();
    const proj = await db.get('projects', projectId);
    if (proj) {
      await db.put('chat', {
        id: uid('msg'),
        projectId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        meta: {
          turnId: opts?.turnId ?? uid('turn'),
          scaffoldFixes: [
            {
              id: uid('doc'),
              fixedCount: 0,
              issues: relevantIssues,
            },
          ],
        },
      });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('kalpa:chat-updated', { detail: { projectId } }));
      }
    }
  }

  let appNoticeXml: string | null = null;
  if (changedPaths.length > 0 || ((hasErrors || hasWarnings) && relevantIssues.length > 0)) {
    const msgList = relevantIssues.map((i) =>
      i.status === 'fixed' ? i.message : `[${i.status}] ${i.message}`
    );
    const joined = msgList.join(' ').replace(/\.+$/, '');
    appNoticeXml = `<result action="app-notice">Scaffold Doctor repaired project setup: ${joined}. Do not recreate these files.</result>`;
  }

  return {
    ran: true,
    issues: docRes.issues,
    relevantIssues,
    changes: safeChanges,
    changedPaths,
    fixedCount,
    hasErrors,
    hasWarnings,
    pkgChanged,
    configChanged,
    tailwindSetupFixed,
    appNoticeXml,
  };
}

export async function buildTailwindUnappliedDiagnosticMessage(
  projectId: string,
  twState: CloudTailwindUnappliedReason,
  port: number,
  logTail: string
): Promise<string> {
  const rawSnap = await vfs.snapshot(projectId);
  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries(rawSnap)) {
    if (!isBrainPath(p) && !p.endsWith('/.gitkeep')) files[p] = c;
  }

  const findCfg = (base: string) =>
    ['.js', '.cjs', '.mjs', '.ts'].map((e) => base + e).find((p) => files[p] !== undefined);

  const postcssPath = findCfg('postcss.config');
  const tailwindPath = findCfg('tailwind.config');
  const vitePath = findCfg('vite.config');

  let pkgSummary = '(missing package.json)';
  if (files['package.json']) {
    try {
      const pkg = JSON.parse(files['package.json']) as {
        type?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      pkgSummary = JSON.stringify(
        {
          type: pkg.type ?? '(commonjs default)',
          tailwindcss: all.tailwindcss ?? null,
          postcss: all.postcss ?? null,
          autoprefixer: all.autoprefixer ?? null,
          '@tailwindcss/vite': all['@tailwindcss/vite'] ?? null,
          '@tailwindcss/postcss': all['@tailwindcss/postcss'] ?? null,
        },
        null,
        2
      );
    } catch {
      pkgSummary = '(invalid JSON in package.json)';
    }
  }

  const cssFiles = Object.keys(files).filter((p) => /\.css$/.test(p));
  const cssSummary =
    cssFiles.length > 0
      ? cssFiles.map((p) => `${p}:\n${files[p].slice(0, 400)}`).join('\n\n')
      : '(no .css files in project)';

  const reasonDesc =
    twState === 'directives-unprocessed'
      ? 'raw "@tailwind base/components/utilities" directives remained unprocessed in <style> tags'
      : 'Tailwind utility classes (.flex / .hidden) have no effect in computed styles';

  return [
    `Cloud preview on port ${port} rendered DOM content, but Tailwind styles are NOT applied (${twState}: ${reasonDesc}).`,
    `package.json summary:\n${pkgSummary}`,
    `postcss config (${postcssPath ?? 'missing'}):\n${postcssPath ? files[postcssPath].slice(0, 600) : '(missing)'}`,
    `tailwind config (${tailwindPath ?? 'missing'}):\n${tailwindPath ? files[tailwindPath].slice(0, 800) : '(missing)'}`,
    `vite config (${vitePath ?? 'missing'}):\n${vitePath ? files[vitePath].slice(0, 600) : '(missing)'}`,
    `CSS files:\n${cssSummary}`,
    `Recent dev server logs:\n${(logTail || '(no server logs)').slice(-1600)}`,
  ].join('\n\n');
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
          } else if (sbState.cloudStylesUnapplied) {
            hasError = true;
            const detail = await buildTailwindUnappliedDiagnosticMessage(
              projectId,
              sbState.cloudStylesUnapplied,
              sbState.devServerPort,
              sbState.devServerLogTail
            );
            sig = normalizeErrorSignature(`cloud-styles-unapplied:${sbState.cloudStylesUnapplied}`);
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
