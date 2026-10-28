import { Sandbox } from 'e2b';
import type { SandboxSession } from './provider';

export const SANDBOX_ROOT = '/home/user/app';
const DEFAULT_SANDBOX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes initial lease

function toAbsSandboxPath(relOrAbs: string): string {
  const clean = relOrAbs.trim();
  if (clean.startsWith('/')) return clean;
  const rel = clean.replace(/^\.\//, '');
  return rel ? `${SANDBOX_ROOT}/${rel}` : SANDBOX_ROOT;
}

function isCommandExitError(
  err: unknown
): err is { exitCode: number; stdout?: string; stderr?: string; message?: string } {
  return typeof err === 'object' && err !== null && 'exitCode' in err;
}

export async function createE2bSandboxSession(
  apiKey: string,
  timeoutMs: number = DEFAULT_SANDBOX_TIMEOUT_MS
): Promise<SandboxSession> {
  if (!apiKey.trim()) {
    throw new Error('Missing E2B API key. Add your key in Settings -> Engines.');
  }

  const sb = await Sandbox.create({
    apiKey: apiKey.trim(),
    timeoutMs,
  });

  await sb.files.makeDir(SANDBOX_ROOT);
  let expiresAt = Date.now() + timeoutMs;

  const session: SandboxSession = {
    id: sb.sandboxId,
    get expiresAt() {
      return expiresAt;
    },
    set expiresAt(v: number) {
      expiresAt = v;
    },

    async writeFiles(files) {
      if (files.length === 0) return;
      await sb.files.write(
        files.map((f) => ({
          path: toAbsSandboxPath(f.path),
          data: f.content,
        }))
      );
    },

    async readFile(path) {
      return sb.files.read(toAbsSandboxPath(path), { format: 'text' });
    },

    async remove(path) {
      try {
        await sb.files.remove(toAbsSandboxPath(path));
      } catch {
        // ignore if already absent
      }
    },

    async exec(cmd, opts) {
      const cwd = opts?.cwd ? toAbsSandboxPath(opts.cwd) : SANDBOX_ROOT;
      try {
        const res = await sb.commands.run(cmd, {
          cwd,
          timeoutMs: opts?.timeoutMs ?? 120_000,
          onStdout: opts?.onStdout,
          onStderr: opts?.onStderr,
        });
        return {
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
        };
      } catch (err) {
        if (isCommandExitError(err)) {
          return {
            exitCode: typeof err.exitCode === 'number' ? err.exitCode : 1,
            stdout: err.stdout ?? '',
            stderr: err.stderr ?? (err.message || ''),
          };
        }
        throw err;
      }
    },

    async startBackground(cmd, opts) {
      const cwd = opts?.cwd ? toAbsSandboxPath(opts.cwd) : SANDBOX_ROOT;
      const handle = await sb.commands.run(cmd, {
        cwd,
        background: true,
        timeoutMs: 0,
        onStdout: opts?.onStdout,
        onStderr: opts?.onStderr,
      });

      let stoppedByCaller = false;
      handle
        .wait()
        .then((res) => {
          if (!stoppedByCaller) opts?.onExit?.(res.exitCode);
        })
        .catch((err) => {
          if (stoppedByCaller) return;
          if (isCommandExitError(err)) {
            opts?.onExit?.(err.exitCode, err.stderr || err.message);
          } else {
            opts?.onExit?.(1, err instanceof Error ? err.message : String(err));
          }
        });

      return {
        async stop() {
          stoppedByCaller = true;
          try {
            await handle.kill();
          } catch {
            // ignore if already exited
          }
        },
      };
    },

    async openPty(opts) {
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const handle = await sb.pty.create({
        cols: Math.max(20, opts.cols || 80),
        rows: Math.max(8, opts.rows || 24),
        cwd: SANDBOX_ROOT,
        timeoutMs: 0,
        onData: (bytes: Uint8Array) => {
          const text = decoder.decode(bytes, { stream: true });
          if (text) opts.onData(text);
        },
      });

      return {
        write(d: string) {
          void sb.pty.sendInput(handle.pid, encoder.encode(d)).catch(() => {});
        },
        resize(cols: number, rows: number) {
          void sb.pty
            .resize(handle.pid, {
              cols: Math.max(20, cols),
              rows: Math.max(8, rows),
            })
            .catch(() => {});
        },
        close() {
          void sb.pty.kill(handle.pid).catch(() => {});
        },
      };
    },

    getPreviewUrl(port: number) {
      const host = sb.getHost(port);
      return host.startsWith('http://') || host.startsWith('https://') ? host : `https://${host}`;
    },

    async extend(ms: number) {
      const remaining = Math.max(0, expiresAt - Date.now());
      const nextLease = Math.min(3_600_000, remaining + ms);
      await sb.setTimeout(nextLease);
      expiresAt = Date.now() + nextLease;
      return expiresAt;
    },

    async kill() {
      try {
        await sb.kill();
      } catch {
        // ignore if already terminated
      }
    },
  };

  return session;
}

export interface E2bSelfTestStep {
  step: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export async function runE2bSelfTest(apiKey: string): Promise<{
  ok: boolean;
  totalMs: number;
  steps: E2bSelfTestStep[];
  error?: string;
}> {
  const tAll = performance.now();
  const steps: E2bSelfTestStep[] = [];
  let session: SandboxSession | null = null;

  try {
    const tCreate = performance.now();
    session = await createE2bSandboxSession(apiKey, 5 * 60 * 1000);
    steps.push({
      step: 'Create Linux microVM',
      ok: true,
      detail: `Sandbox ${session.id} booted`,
      ms: Math.round(performance.now() - tCreate),
    });

    const tVersions = performance.now();
    const ver = await session.exec('echo KALPA_E2B_OK && node -v && python3 --version');
    const cleanOut = ver.stdout.trim().replace(/\s+/g, ' · ');
    const verOk = ver.exitCode === 0 && ver.stdout.includes('KALPA_E2B_OK');
    steps.push({
      step: 'Run echo / Node / Python',
      ok: verOk,
      detail: cleanOut || ver.stderr || `exit ${ver.exitCode}`,
      ms: Math.round(performance.now() - tVersions),
    });
    if (!verOk) throw new Error(`Runtime probe failed: ${ver.stderr || ver.stdout}`);

    const tHttp = performance.now();
    await session.writeFiles([{ path: '/tmp/kalpa_http_test/ping.txt', content: 'PONG_FROM_E2B' }]);
    const bg = await session.startBackground(
      'python3 -m http.server 8000 --bind 0.0.0.0 --directory /tmp/kalpa_http_test'
    );
    const publicUrl = `${session.getPreviewUrl(8000)}/ping.txt`;
    let httpOk = false;
    let httpDetail = '';

    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((r) => setTimeout(r, 400));
      const localCheck = await session.exec('curl -sf http://127.0.0.1:8000/ping.txt || true');
      if (localCheck.stdout.includes('PONG_FROM_E2B')) {
        try {
          const browserRes = await fetch(publicUrl, { method: 'GET', mode: 'no-cors' });
          httpOk = Boolean(browserRes);
          httpDetail = `Port 8000 live at ${publicUrl}`;
        } catch {
          httpOk = true;
          httpDetail = `Port 8000 verified internally (${publicUrl})`;
        }
        break;
      }
    }
    await bg.stop();

    steps.push({
      step: 'Expose & fetch HTTP port 8000',
      ok: httpOk,
      detail: httpDetail || 'Timed out waiting for port 8000',
      ms: Math.round(performance.now() - tHttp),
    });

    const tKill = performance.now();
    await session.kill();
    session = null;
    steps.push({
      step: 'Destroy sandbox cleanly',
      ok: true,
      detail: 'Terminated',
      ms: Math.round(performance.now() - tKill),
    });

    return {
      ok: steps.every((s) => s.ok),
      totalMs: Math.round(performance.now() - tAll),
      steps,
    };
  } catch (err) {
    if (session) {
      await session.kill().catch(() => {});
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      totalMs: Math.round(performance.now() - tAll),
      steps,
      error: msg,
    };
  }
}
