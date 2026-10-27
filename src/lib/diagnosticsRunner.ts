import { deleteSetting, getSetting, setSetting } from '@/lib/vfs/db';
import { runJsInWorker } from '@/lib/runtime/jsWorker';
import { pingPyodideWorker } from '@/lib/runtime/pyodideWorker';
import { useProviderStore } from '@/lib/providers/store';
import { formatBytes } from '@/lib/utils';

export type CheckState = 'RUNNING' | 'PASS' | 'FAIL' | 'INFO';

export interface DiagItem {
  id: string;
  label: string;
  state: CheckState;
  durationMs?: number;
  detail: string;
}

export const INITIAL_DIAGNOSTIC_CHECKS: DiagItem[] = [
  { id: 'idb', label: 'IndexedDB Open + Write + Read', state: 'RUNNING', detail: 'Testing…' },
  { id: 'quota', label: 'Browser Storage Quota', state: 'RUNNING', detail: 'Estimating…' },
  { id: 'worker', label: 'Web Worker Execution', state: 'RUNNING', detail: 'Spawning worker…' },
  { id: 'wasm', label: 'WebAssembly Support', state: 'RUNNING', detail: 'Compiling module…' },
  { id: 'pyodide', label: 'Pyodide Python Runtime', state: 'RUNNING', detail: 'Loading Pyodide v0.26.4…' },
  { id: 'sandpack', label: 'Sandpack Render Self-Test', state: 'RUNNING', detail: 'Waiting for bundler done event…' },
  { id: 'provider', label: 'Active AI Provider Test', state: 'RUNNING', detail: 'Checking active profile…' },
  { id: 'viewport', label: 'Viewport, Safe-Area & DPR', state: 'RUNNING', detail: 'Measuring…' },
  { id: 'clipboard', label: 'Clipboard API & Permissions', state: 'RUNNING', detail: 'Checking…' },
];

export async function executeDiagnosticsSuite(
  upsertCheck: (item: DiagItem) => void
): Promise<void> {
  // 1. IndexedDB
  const tIdb = performance.now();
  try {
    const token = `probe_${Date.now()}`;
    await setSetting('_diag_probe', token);
    const readBack = await getSetting<string>('_diag_probe');
    await deleteSetting('_diag_probe');
    if (readBack !== token) throw new Error('Read value mismatch');
    upsertCheck({
      id: 'idb',
      label: 'IndexedDB Open + Write + Read',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tIdb),
      detail: 'Database "kalpa" v1 read/write verified',
    });
  } catch (err) {
    upsertCheck({
      id: 'idb',
      label: 'IndexedDB Open + Write + Read',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tIdb),
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 2. Storage Quota
  const tQuota = performance.now();
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      upsertCheck({
        id: 'quota',
        label: 'Browser Storage Quota',
        state: 'INFO',
        durationMs: Math.round(performance.now() - tQuota),
        detail: `Used ${formatBytes(est.usage ?? 0)} of ${formatBytes(est.quota ?? 0)}`,
      });
    } else {
      upsertCheck({
        id: 'quota',
        label: 'Browser Storage Quota',
        state: 'INFO',
        detail: 'navigator.storage.estimate() not supported in this browser',
      });
    }
  } catch (err) {
    upsertCheck({
      id: 'quota',
      label: 'Browser Storage Quota',
      state: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 3. Web Worker
  let workerOut = '';
  const workerRes = await runJsInWorker({
    code: 'console.log(21 * 2);',
    onStdout: (l) => {
      workerOut = l.trim();
    },
    timeoutMs: 5000,
  });
  upsertCheck({
    id: 'worker',
    label: 'Web Worker Execution',
    state: workerRes.ok && workerOut === '42' ? 'PASS' : 'FAIL',
    durationMs: workerRes.durationMs,
    detail: workerRes.ok ? `Worker evaluated 21*2 = ${workerOut}` : workerRes.error || 'Worker failed',
  });

  // 4. WebAssembly
  const tWasm = performance.now();
  try {
    const minimalWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await WebAssembly.instantiate(minimalWasm);
    upsertCheck({
      id: 'wasm',
      label: 'WebAssembly Support',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tWasm),
      detail: 'WebAssembly binary compiled and instantiated',
    });
  } catch (err) {
    upsertCheck({
      id: 'wasm',
      label: 'WebAssembly Support',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tWasm),
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 5. Viewport & Environment
  const vv = window.visualViewport;
  upsertCheck({
    id: 'viewport',
    label: 'Viewport, Safe-Area & DPR',
    state: 'INFO',
    detail: `Window ${window.innerWidth}×${window.innerHeight}px · VisualViewport ${
      vv ? `${Math.round(vv.width)}×${Math.round(vv.height)}px` : 'n/a'
    } · DPR ${window.devicePixelRatio} · UA: ${navigator.userAgent}`,
  });

  // 6. Clipboard
  try {
    const hasApi = Boolean(navigator.clipboard);
    let permState = 'available';
    if (navigator.permissions?.query) {
      try {
        const p = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        permState = p.state;
      } catch {
        permState = 'query-unsupported';
      }
    }
    upsertCheck({
      id: 'clipboard',
      label: 'Clipboard API & Permissions',
      state: hasApi ? 'PASS' : 'INFO',
      detail: hasApi
        ? `navigator.clipboard present (permission: ${permState})`
        : 'navigator.clipboard unavailable in this context',
    });
  } catch (err) {
    upsertCheck({
      id: 'clipboard',
      label: 'Clipboard API & Permissions',
      state: 'INFO',
      detail: String(err),
    });
  }

  // 7. Pyodide & Active Provider (in parallel)
  const pyPromise = pingPyodideWorker((status) => {
    upsertCheck({
      id: 'pyodide',
      label: 'Pyodide Python Runtime',
      state: 'RUNNING',
      detail: status,
    });
  }).then((res) => {
    upsertCheck({
      id: 'pyodide',
      label: 'Pyodide Python Runtime',
      state: res.ok ? 'PASS' : 'FAIL',
      durationMs: res.durationMs,
      detail: res.ok ? `Python ${res.result} loaded via jsDelivr` : res.error || 'Failed to load Pyodide',
    });
  });

  const provPromise = (async () => {
    const store = useProviderStore.getState();
    await store.initProviders();
    const active = useProviderStore.getState().getActiveProfile();
    const isLocal = active && /localhost|127\.0\.0\.1/.test(active.baseUrl);
    if (!active || (!active.apiKey && !isLocal)) {
      upsertCheck({
        id: 'provider',
        label: 'Active AI Provider Test',
        state: 'INFO',
        detail: 'No active provider key configured yet',
      });
      return;
    }
    const res = await store.testConnection(active);
    upsertCheck({
      id: 'provider',
      label: 'Active AI Provider Test',
      state: res.ok ? 'PASS' : 'FAIL',
      durationMs: res.totalMs,
      detail: res.ok
        ? `${active.label} (${active.model}) · TTFT ${res.ttftMs} ms · "${res.reply}"`
        : `${active.label}: ${res.error}`,
    });
  })();

  await Promise.all([pyPromise, provPromise]);
}
