import { vfs } from '@/lib/vfs/vfs';
import type { SandboxSession } from './provider';

export type DevServerState = 'stopped' | 'installing' | 'starting' | 'running' | 'crashed';

export interface DevServerPlan {
  command: string;
  port: number;
  needsNpmInstall: boolean;
}

export function inferDevServerPlan(snapshot: Record<string, string>): DevServerPlan | null {
  const pkgRaw = snapshot['package.json'];
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const devScript = pkg.scripts?.dev || '';

      if (deps.next || devScript.includes('next')) {
        return {
          command: 'npx next dev --hostname 0.0.0.0 --port 3000',
          port: 3000,
          needsNpmInstall: true,
        };
      }
      if (deps.vite || devScript.includes('vite')) {
        return {
          command: 'npx vite --host 0.0.0.0 --port 5173',
          port: 5173,
          needsNpmInstall: true,
        };
      }
      if (deps.astro || devScript.includes('astro')) {
        return {
          command: 'npx astro dev --host 0.0.0.0 --port 4321',
          port: 4321,
          needsNpmInstall: true,
        };
      }
      if (devScript) {
        const portMatch = /--port\s+(\d+)|-p\s+(\d+)|PORT=(\d+)/.exec(devScript);
        const port = portMatch ? Number(portMatch[1] || portMatch[2] || portMatch[3]) : 3000;
        return {
          command: `HOST=0.0.0.0 PORT=${port} npm run dev`,
          port,
          needsNpmInstall: true,
        };
      }
      if (pkg.scripts?.start) {
        return {
          command: 'HOST=0.0.0.0 PORT=3000 npm start',
          port: 3000,
          needsNpmInstall: true,
        };
      }
    } catch {
      // ignore invalid package.json
    }
  }

  if (snapshot['index.html'] !== undefined || snapshot['public/index.html'] !== undefined) {
    const dir = snapshot['index.html'] !== undefined ? '.' : 'public';
    return {
      command: `python3 -m http.server 8000 --bind 0.0.0.0 --directory ${dir}`,
      port: 8000,
      needsNpmInstall: false,
    };
  }

  if (snapshot['app.py'] !== undefined || snapshot['main.py'] !== undefined) {
    const py = snapshot['app.py'] ?? snapshot['main.py'] ?? '';
    if (/fastapi|uvicorn/i.test(py)) {
      const mod = snapshot['app.py'] !== undefined ? 'app:app' : 'main:app';
      return {
        command: `uvicorn ${mod} --host 0.0.0.0 --port 8000`,
        port: 8000,
        needsNpmInstall: false,
      };
    }
    if (/flask/i.test(py)) {
      const entry = snapshot['app.py'] !== undefined ? 'app.py' : 'main.py';
      return {
        command: `FLASK_APP=${entry} flask run --host=0.0.0.0 --port=5000`,
        port: 5000,
        needsNpmInstall: false,
      };
    }
  }

  return null;
}

export class CloudDevServerController {
  private bgHandle: { stop(): Promise<void> } | null = null;
  private logLines: string[] = [];
  private lastInstalledPkgJson: string | null = null;
  private runToken = 0;

  status: DevServerState = 'stopped';
  port = 3000;
  previewUrl: string | null = null;

  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  private appendLog(chunk: string) {
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return;
    this.logLines.push(...lines);
    if (this.logLines.length > 80) {
      this.logLines = this.logLines.slice(-80);
    }
    this.onChange();
  }

  getLogTail(count = 40): string {
    return this.logLines.slice(-count).join('\n');
  }

  async stop(): Promise<void> {
    this.runToken++;
    if (this.bgHandle) {
      await this.bgHandle.stop();
      this.bgHandle = null;
    }
    this.status = 'stopped';
    this.previewUrl = null;
    this.onChange();
  }

  async startOrRestart(
    projectId: string,
    session: SandboxSession,
    opts?: { forceInstall?: boolean; onTerminalEcho?: (line: string) => void }
  ): Promise<{ status: DevServerState; port: number; url: string | null; logTail: string }> {
    const token = ++this.runToken;
    if (this.bgHandle) {
      await this.bgHandle.stop();
      this.bgHandle = null;
    }

    const snap = await vfs.snapshot(projectId);
    const plan = inferDevServerPlan(snap);
    if (!plan) {
      this.status = 'stopped';
      this.previewUrl = null;
      this.onChange();
      return { status: 'stopped', port: 0, url: null, logTail: 'No web dev server detected.' };
    }

    this.port = plan.port;
    this.logLines = [];

    const pkgRaw = snap['package.json'] ?? null;
    if (
      plan.needsNpmInstall &&
      pkgRaw &&
      (opts?.forceInstall || pkgRaw !== this.lastInstalledPkgJson)
    ) {
      this.status = 'installing';
      this.onChange();
      opts?.onTerminalEcho?.('$ npm install');
      const installRes = await session.exec('npm install --no-audit --no-fund', {
        timeoutMs: 180_000,
        onStdout: (s) => this.appendLog(s),
        onStderr: (s) => this.appendLog(s),
      });
      if (token !== this.runToken) {
        return { status: this.status, port: plan.port, url: null, logTail: this.getLogTail() };
      }
      if (installRes.exitCode !== 0) {
        this.status = 'crashed';
        this.previewUrl = null;
        this.onChange();
        return {
          status: 'crashed',
          port: plan.port,
          url: null,
          logTail: this.getLogTail(40),
        };
      }
      this.lastInstalledPkgJson = pkgRaw;
    }

    this.status = 'starting';
    this.previewUrl = null;
    this.onChange();
    opts?.onTerminalEcho?.(`$ ${plan.command}`);

    let crashedDuringBoot = false;
    this.bgHandle = await session.startBackground(plan.command, {
      onStdout: (s) => this.appendLog(s),
      onStderr: (s) => this.appendLog(s),
      onExit: (code, errMsg) => {
        if (token !== this.runToken) return;
        crashedDuringBoot = true;
        if (errMsg) this.appendLog(errMsg);
        this.appendLog(`[devserver exited with code ${code}]`);
        this.status = 'crashed';
        this.previewUrl = null;
        this.onChange();
      },
    });

    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && token === this.runToken && !crashedDuringBoot) {
      const probe = await session.exec(
        `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:${plan.port} || true`,
        { timeoutMs: 5_000 }
      );
      const code = Number(probe.stdout.trim());
      if (code >= 200 && code < 500) {
        this.status = 'running';
        this.previewUrl = session.getPreviewUrl(plan.port);
        this.onChange();
        return {
          status: 'running',
          port: plan.port,
          url: this.previewUrl,
          logTail: this.getLogTail(40),
        };
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (token !== this.runToken) {
      return { status: this.status, port: plan.port, url: this.previewUrl, logTail: this.getLogTail() };
    }

    this.status = 'crashed';
    this.previewUrl = null;
    this.onChange();
    return {
      status: 'crashed',
      port: plan.port,
      url: null,
      logTail: this.getLogTail(40) || `Timed out waiting for port ${plan.port} after 90s.`,
    };
  }
}
