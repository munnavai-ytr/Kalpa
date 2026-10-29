import { buildTailwindHeadTags } from '@/lib/preview/tailwindInject';
import { useProviderStore } from '@/lib/providers/store';
import { CloudDevServerController } from '@/lib/sandbox/devServer';
import { createE2bSandboxSession } from '@/lib/sandbox/e2b';
import type { SandboxSession } from '@/lib/sandbox/provider';
import {
  classifyShellCommand,
  detectBlockedHost,
  splitShellLines,
  type ShellKind,
} from '@/lib/sandbox/shellClass';
import { syncFullVfsToSandbox } from '@/lib/sandbox/sync';
import { getKalpaDB } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import type { DiagItem } from './diagnosticsRunner';

export const INITIAL_PREVIEW_SANDBOX_DIAGNOSTIC_CHECKS: DiagItem[] = [
  {
    id: 'shell-classifier',
    label: 'Shell Classifier (10 Multi-Line & Server Samples)',
    state: 'RUNNING',
    detail: 'Classifying server / install / build / test / other commands…',
  },
  {
    id: 'tailwind-runtime',
    label: 'Tailwind Runtime Self-Test (Hidden Iframe Probe)',
    state: 'RUNNING',
    detail: 'Booting hidden preview iframe with bg-red-500 p-4 text-white…',
  },
  {
    id: 'cloud-preview-selftest',
    label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
    state: 'RUNNING',
    detail: 'Checking E2B API key…',
  },
];

async function deleteTempVfsProject(projectId: string): Promise<void> {
  const db = await getKalpaDB();
  const tx = db.transaction(['projects', 'files', 'checkpoints'], 'readwrite');
  await tx.objectStore('projects').delete(projectId);
  const fKeys = await tx.objectStore('files').index('by-project').getAllKeys(projectId);
  for (const k of fKeys) await tx.objectStore('files').delete(k);
  const cpKeys = await tx.objectStore('checkpoints').index('by-project').getAllKeys(projectId);
  for (const k of cpKeys) await tx.objectStore('checkpoints').delete(k);
  await tx.done;
}

function waitForCloudBeaconProbe(url: string, timeoutMs = 10_000): Promise<{
  ok: boolean;
  detail: string;
}> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.resolve({ ok: true, detail: 'DOM unavailable (SSR)' });
  }
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.setAttribute('aria-hidden', 'true');

    let settled = false;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      iframe.remove();
      resolve({ ok, detail });
    };

    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== iframe.contentWindow) return;
      if (typeof ev.origin !== 'string' || !ev.origin.endsWith('.e2b.app')) return;
      const d = ev.data;
      if (!d || typeof d !== 'object' || d.kalpa !== 'cloud-beacon') return;
      if (d.type === 'error' || d.type === 'rejection') {
        finish(false, `Beacon caught runtime error: ${String(d.message)}`);
      } else if (d.type === 'probe') {
        const ok = Number(d.rootChildren) >= 1 && Number(d.textLen) >= 5;
        finish(
          ok,
          ok
            ? `BEACON_JS verified (rootChildren=${d.rootChildren}, textLen=${d.textLen})`
            : `BEACON_JS reported blank DOM (rootChildren=${d.rootChildren}, textLen=${d.textLen})`
        );
      }
    };

    const timer = setTimeout(() => {
      finish(false, `Timed out waiting for BEACON_JS postMessage from ${url}`);
    }, timeoutMs);

    window.addEventListener('message', onMsg);
    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

export async function runTailwindRuntimeSelfTest(): Promise<DiagItem> {
  const tStart = performance.now();
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return {
      id: 'tailwind-runtime',
      label: 'Tailwind Runtime Self-Test (Hidden Iframe Probe)',
      state: 'INFO',
      detail: 'Skipped outside browser DOM',
    };
  }

  const headTags = buildTailwindHeadTags({ runtime: 'v4' });
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  ${headTags}
</head>
<body>
  <div class="hidden" id="__tw_probe"></div>
  <div id="tw_sample" class="bg-red-500 p-4 text-white">Kalpa Tailwind Self-Test</div>
</body>
</html>`;

  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.position = 'fixed';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  try {
    const probe = await new Promise<{
      ok: boolean;
      runtime: string;
      source: string;
    }>((resolve) => {
      let done = false;
      const finish = (val: { ok: boolean; runtime: string; source: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(val);
      };
      const onMessage = (ev: MessageEvent) => {
        if (ev.source !== iframe.contentWindow) return;
        const data = ev.data;
        if (data && typeof data === 'object' && data.kalpa === 'tw-probe') {
          finish({
            ok: Boolean(data.ok),
            runtime: String(data.runtime || 'v4'),
            source: String(data.source || 'failed'),
          });
        }
      };
      const timer = setTimeout(() => {
        finish({ ok: false, runtime: 'v4', source: 'failed' });
      }, 8_000);
      window.addEventListener('message', onMessage);
      iframe.src = blobUrl;
      document.body.appendChild(iframe);
    });

    const ms = Math.round(performance.now() - tStart);
    if (!probe.ok) {
      return {
        id: 'tailwind-runtime',
        label: 'Tailwind Runtime Self-Test (Hidden Iframe Probe)',
        state: 'FAIL',
        durationMs: ms,
        detail: 'FAILED — Tailwind probe (__tw_probe) remained visible after self-hosted & CDN fallback',
      };
    }

    const srcDesc = probe.source === 'self' ? 'self-hosted' : 'CDN';
    return {
      id: 'tailwind-runtime',
      label: 'Tailwind Runtime Self-Test (Hidden Iframe Probe)',
      state: 'PASS',
      durationMs: ms,
      detail: `Loaded ${probe.runtime} (${probe.source} / ${srcDesc}) · verified bg-red-500 p-4 text-white & hidden probe`,
    };
  } finally {
    iframe.remove();
    URL.revokeObjectURL(blobUrl);
  }
}

export function runShellClassifierDiagnostics(): DiagItem {
  const t0 = performance.now();
  try {
    const multi = splitShellLines('# install and start\nnpm install\nnpm run dev');
    if (multi.length !== 2) {
      throw new Error(`splitShellLines expected 2 commands, got ${multi.length}`);
    }

    const samples: { cmd: string; kind: ShellKind; port?: number }[] = [
      { cmd: multi[0], kind: 'install' },
      { cmd: multi[1], kind: 'server', port: 3000 },
      { cmd: 'npx vite build', kind: 'build' },
      { cmd: 'python3 -m http.server 8000', kind: 'server', port: 8000 },
      { cmd: 'npx vite --host 0.0.0.0 --port 5173', kind: 'server', port: 5173 },
      { cmd: 'npx next dev -p 4000', kind: 'server', port: 4000 },
      { cmd: 'npm run build', kind: 'build' },
      { cmd: 'pip3 install fastapi uvicorn', kind: 'install' },
      { cmd: 'npx vitest run', kind: 'test' },
      { cmd: 'node scripts/seed.js', kind: 'other' },
    ];

    const summaryParts: string[] = [];
    for (const s of samples) {
      const res = classifyShellCommand(s.cmd);
      if (res.kind !== s.kind || (s.port !== undefined && res.port !== s.port)) {
        throw new Error(
          `Sample "${s.cmd}" -> got kind=${res.kind} port=${res.port}, expected kind=${s.kind} port=${s.port}`
        );
      }
      summaryParts.push(`${s.cmd} -> ${res.kind}${res.port ? `:${res.port}` : ''}`);
    }

    const blocked = detectBlockedHost(
      'Blocked request. This host ("5173-sbx.e2b.app") is not allowed.'
    );
    if (blocked !== '5173-sbx.e2b.app') {
      throw new Error(`detectBlockedHost mismatch: ${blocked}`);
    }

    return {
      id: 'shell-classifier',
      label: 'Shell Classifier (10 Multi-Line & Server Samples)',
      state: 'PASS',
      durationMs: Math.round(performance.now() - t0),
      detail: summaryParts.join(' · '),
    };
  } catch (err) {
    return {
      id: 'shell-classifier',
      label: 'Shell Classifier (10 Multi-Line & Server Samples)',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - t0),
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executePreviewSandboxDiagnostics(
  upsertCheck: (item: DiagItem) => void
): Promise<void> {
  // C2: Pure 10-sample shell classifier check
  upsertCheck(runShellClassifierDiagnostics());

  // C3: Hidden iframe Tailwind runtime check
  const twItem = await runTailwindRuntimeSelfTest();
  upsertCheck(twItem);

  // C1: Cloud preview self-test (Vite + wrapper + public host probe + BEACON_JS)
  await useProviderStore.getState().initProviders();
  const e2bKey = useProviderStore.getState().e2bApiKey.trim();
  if (!e2bKey) {
    upsertCheck({
      id: 'cloud-preview-selftest',
      label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
      state: 'INFO',
      detail: 'No E2B API key configured in Settings -> Engines (skipped live Vite + host probe test)',
    });
    return;
  }

  const tAll = performance.now();
  const diagProjId = `_diag_cloud_vite_${Date.now()}`;
  let session: SandboxSession | null = null;
  const ctrl = new CloudDevServerController(() => {});

  try {
    upsertCheck({
      id: 'cloud-preview-selftest',
      label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
      state: 'RUNNING',
      detail: 'Booting E2B sandbox & syncing Vite + React test app…',
    });

    await vfs.writeMany(diagProjId, [
      {
        path: 'package.json',
        encoding: 'utf8',
        content: JSON.stringify(
          {
            name: 'kalpa-cloud-selftest',
            private: true,
            type: 'module',
            scripts: { dev: 'vite' },
            dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
            devDependencies: { vite: '^5.4.10' },
          },
          null,
          2
        ),
      },
      {
        path: 'index.html',
        encoding: 'utf8',
        content:
          '<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>Kalpa Cloud Test</title></head><body><div id="root"></div><script type="module" src="/src/main.js"></script></body></html>\n',
      },
      {
        path: 'src/main.js',
        encoding: 'utf8',
        content:
          "import React from 'react';\nimport { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')).render(React.createElement('main', null, 'Kalpa Cloud Vite Self-Test Ready'));\n",
      },
    ]);

    const tBoot = performance.now();
    session = await createE2bSandboxSession(e2bKey, 5 * 60 * 1000);
    await syncFullVfsToSandbox(diagProjId, session);
    const bootMs = Math.round(performance.now() - tBoot);

    upsertCheck({
      id: 'cloud-preview-selftest',
      label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
      state: 'RUNNING',
      detail: `Sandbox booted (${bootMs}ms) · installing Vite + React & probing public host…`,
    });

    const tStartSrv = performance.now();
    const startRes = await ctrl.startOrRestart(diagProjId, session, { waitTimeoutMs: 120_000 });
    const srvMs = Math.round(performance.now() - tStartSrv);

    if (startRes.status !== 'running' || !startRes.url || !ctrl.hostProbeOk) {
      throw new Error(
        startRes.hostBlockedMessage || startRes.logTail || 'Vite dev server failed readiness/host probe'
      );
    }

    const publicHost = new URL(startRes.url).host;
    const hostProbe = await ctrl.probeHostOnce(session, startRes.port, publicHost);
    if (hostProbe.blockedHost || hostProbe.httpCode < 200 || hostProbe.httpCode >= 400) {
      throw new Error(
        `Public host ${publicHost} failed probe (HTTP ${hostProbe.httpCode}): ${hostProbe.bodyHead}`
      );
    }

    const tBeacon = performance.now();
    const beaconRes = await waitForCloudBeaconProbe(startRes.url, 10_000);
    const beaconMs = Math.round(performance.now() - tBeacon);
    if (!beaconRes.ok) {
      throw new Error(beaconRes.detail);
    }

    upsertCheck({
      id: 'cloud-preview-selftest',
      label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
      state: 'PASS',
      durationMs: Math.round(performance.now() - tAll),
      detail: `Boot ${bootMs}ms · Vite+install+Host(${publicHost}) ${srvMs}ms · Beacon ${beaconMs}ms (${beaconRes.detail})`,
    });
  } catch (err) {
    upsertCheck({
      id: 'cloud-preview-selftest',
      label: 'Cloud Preview Self-Test (Vite + Host Probe + Beacon)',
      state: 'FAIL',
      durationMs: Math.round(performance.now() - tAll),
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await ctrl.stop().catch(() => {});
    if (session) {
      await session.kill().catch(() => {});
    }
    await deleteTempVfsProject(diagProjId).catch(() => {});
  }
}
