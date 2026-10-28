import {
  ActionStream,
  applyEdits,
  buildGraph,
  impactOf,
  type Action,
} from '@/lib/agent/actions';
import { CONSTITUTION } from '@/lib/agent/prompts/constitution';
import { computeContextAllocation, estimateTokens } from '@/lib/agent/tokens';
import { fileIndexBlock, rebuildBrainIndex } from '@/lib/brain/index';
import { createCheckpoint, restoreCheckpoint } from '@/lib/checkpoints/checkpoints';
import { useProviderStore } from '@/lib/providers/store';
import { runE2bSelfTest } from '@/lib/sandbox/e2b';
import { getKalpaDB } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import type { DiagItem } from './diagnosticsRunner';

export const INITIAL_AGENT_DIAGNOSTIC_CHECKS: DiagItem[] = [
  { id: 'agent-protocol', label: 'Agent ActionStream & Tolerant Edits', state: 'RUNNING', detail: 'Streaming XML chunks…' },
  { id: 'checkpoints', label: 'Checkpoint SHA-1 Snapshot Round-Trip', state: 'RUNNING', detail: 'Testing tree restore…' },
  { id: 'brain-index', label: 'Brain Index & Import Graph Builder', state: 'RUNNING', detail: 'Scanning exports & rdeps…' },
  { id: 'token-estimator', label: 'Token Budget & Context Estimator', state: 'RUNNING', detail: 'Computing allocation…' },
  { id: 'e2b-sandbox', label: 'Cloud Sandbox (E2B) Self-Test', state: 'RUNNING', detail: 'Checking E2B key…' },
];

async function cleanupDiagProject(projectId: string): Promise<void> {
  const db = await getKalpaDB();
  const tx = db.transaction(['projects', 'files', 'checkpoints'], 'readwrite');
  await tx.objectStore('projects').delete(projectId);
  const fKeys = await tx.objectStore('files').index('by-project').getAllKeys(projectId);
  for (const k of fKeys) await tx.objectStore('files').delete(k);
  const cpKeys = await tx.objectStore('checkpoints').index('by-project').getAllKeys(projectId);
  for (const k of cpKeys) await tx.objectStore('checkpoints').delete(k);
  await tx.done;
}

export async function executeAgentDiagnosticsSuite(
  upsertCheck: (item: DiagItem) => void
): Promise<void> {
  // 1. Agent Protocol (ActionStream chunking + applyEdits + buildGraph/impactOf)
  const tProto = performance.now();
  try {
    const sampleStream = [
      'Planning milestone M1.',
      '<memory file="brief" op="replace">',
      '# Goal: Habit Tracker',
      '</memory>',
      '<file path="src/math.ts">',
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      '</file>',
      '<complete milestone="M1" next="M2" />',
    ].join('\n');

    const parser = new ActionStream();
    const parsed: Action[] = [];
    for (let i = 0; i < sampleStream.length; i += 7) {
      parsed.push(...parser.push(sampleStream.slice(i, i + 7)));
    }
    const ended = parser.end();
    parsed.push(...ended.actions);

    const hasMem = parsed.some((a) => a.type === 'memory' && a.file === 'brief');
    const hasFile = parsed.some((a) => a.type === 'file' && a.path === 'src/math.ts');
    const hasComplete = parsed.some((a) => a.type === 'complete' && a.milestone === 'M1');
    if (!hasMem || !hasFile || !hasComplete || ended.truncated) {
      throw new Error('Chunked ActionStream parse mismatch');
    }

    const baseCode = 'function greet() {\n    const msg = "hi";\n    return msg;\n}\n';
    const editRes = applyEdits(baseCode, [
      { find: '  const msg = "hi";\n  return msg;', replace: '  const msg = "hello";\n  return msg.toUpperCase();' },
    ]);
    if (!editRes.ok || !editRes.content.includes('toUpperCase()')) {
      throw new Error('Indentation-tolerant applyEdits failed');
    }

    const graph = buildGraph({
      'src/util.ts': 'export const X = 1;',
      'src/card.tsx': 'import { X } from "./util"; export const C = X;',
      'src/page.tsx': 'import { C } from "@/card"; export default C;',
    });
    const imp = impactOf('src/util.ts', graph.rdeps);
    if (!imp.direct.includes('src/card.tsx') || !imp.indirect.includes('src/page.tsx')) {
      throw new Error('Import graph impactOf resolution mismatch');
    }

    upsertCheck({
      id: 'agent-protocol',
      label: 'Agent ActionStream & Tolerant Edits',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tProto),
      detail: `Parsed ${parsed.length} streamed items · indentation-tolerant edit + transitive impact verified`,
    });
  } catch (err) {
    upsertCheck({
      id: 'agent-protocol',
      label: 'Agent ActionStream & Tolerant Edits',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tProto),
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Checkpoint Round-Trip
  const tCp = performance.now();
  const cpProjId = `_diag_cp_${Date.now()}`;
  try {
    await vfs.writeMany(cpProjId, [
      { path: 'app.ts', content: 'export const v = 1;\n', encoding: 'utf8' },
      { path: 'keep.txt', content: 'alpha\n', encoding: 'utf8' },
    ]);
    const cp1 = await createCheckpoint(cpProjId, 'diag-v1');
    await vfs.write(cpProjId, 'app.ts', 'export const v = 999;\n', 'utf8');
    await vfs.write(cpProjId, 'extra.ts', 'temp\n', 'utf8');
    await vfs.remove(cpProjId, 'keep.txt');
    await createCheckpoint(cpProjId, 'diag-v2');

    await restoreCheckpoint(cp1.id, { skipBeforeBackup: true });
    const restored = await vfs.snapshot(cpProjId);
    if (
      restored['app.ts'] !== 'export const v = 1;\n' ||
      restored['keep.txt'] !== 'alpha\n' ||
      'extra.ts' in restored
    ) {
      throw new Error('Restored snapshot did not match checkpoint v1');
    }
    upsertCheck({
      id: 'checkpoints',
      label: 'Checkpoint SHA-1 Snapshot Round-Trip',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tCp),
      detail: 'Created v1/v2 snapshots, restored v1 (reverted edits, restored deleted file, pruned extra file)',
    });
  } catch (err) {
    upsertCheck({
      id: 'checkpoints',
      label: 'Checkpoint SHA-1 Snapshot Round-Trip',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tCp),
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await cleanupDiagProject(cpProjId).catch(() => {});
  }

  // 3. Brain Index Build
  const tBrain = performance.now();
  const brProjId = `_diag_brain_${Date.now()}`;
  try {
    await vfs.writeMany(brProjId, [
      { path: '.kalpa/architecture.md', content: '- `src/api.ts`: Core client fetcher\n', encoding: 'utf8' },
      { path: 'src/api.ts', content: 'export async function fetchItems() { return []; }\n', encoding: 'utf8' },
      { path: 'src/App.tsx', content: 'import { fetchItems } from "./api";\nexport function App() { return null; }\n', encoding: 'utf8' },
    ]);
    const idx = await rebuildBrainIndex(brProjId);
    const apiEntry = idx.files.find((f) => f.path === 'src/api.ts');
    const block = fileIndexBlock(idx, 2000);
    if (
      idx.fileCount !== 2 ||
      !apiEntry?.exports.includes('fetchItems') ||
      !apiEntry.importedBy.includes('src/App.tsx') ||
      !block.includes('Core client fetcher')
    ) {
      throw new Error('Brain index metadata mismatch');
    }
    upsertCheck({
      id: 'brain-index',
      label: 'Brain Index & Import Graph Builder',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tBrain),
      detail: `Indexed ${idx.fileCount} files with exports, reverse dependents, and architecture.md notes`,
    });
  } catch (err) {
    upsertCheck({
      id: 'brain-index',
      label: 'Brain Index & Import Graph Builder',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tBrain),
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await cleanupDiagProject(brProjId).catch(() => {});
  }

  // 4. Token Estimator
  const tTok = performance.now();
  const constTokens = estimateTokens(CONSTITUTION);
  const alloc = computeContextAllocation(128_000, 8192);
  upsertCheck({
    id: 'token-estimator',
    label: 'Token Budget & Context Estimator',
    state: constTokens > 500 && alloc.totalBudget > 80_000 ? 'PASS' : 'FAIL',
    durationMs: Math.round(performance.now() - tTok),
    detail: `Constitution ~${constTokens} tok · 128k window -> budget B=${alloc.totalBudget} tok (Brain ${alloc.brainBudget}, Files ${alloc.selectedFilesBudget}, Conv ${alloc.conversationBudget})`,
  });

  // 5. E2B Cloud Sandbox Self-Test (runs if user configured an E2B key)
  await useProviderStore.getState().initProviders();
  const e2bKey = useProviderStore.getState().e2bApiKey;
  if (!e2bKey.trim()) {
    upsertCheck({
      id: 'e2b-sandbox',
      label: 'Cloud Sandbox (E2B) Self-Test',
      state: 'INFO',
      detail: 'No E2B API key configured in Settings -> Engines (Instant Engine active)',
    });
  } else {
    upsertCheck({
      id: 'e2b-sandbox',
      label: 'Cloud Sandbox (E2B) Self-Test',
      state: 'RUNNING',
      detail: 'Booting Linux microVM & probing Node/Python/HTTP port 8000…',
    });
    const res = await runE2bSelfTest(e2bKey);
    upsertCheck({
      id: 'e2b-sandbox',
      label: 'Cloud Sandbox (E2B) Self-Test',
      state: res.ok ? 'PASS' : 'FAIL',
      durationMs: res.totalMs,
      detail: res.ok
        ? res.steps.map((s) => `${s.step} (${s.ms}ms)`).join(' · ')
        : res.error || 'E2B self-test failed',
    });
  }
}
