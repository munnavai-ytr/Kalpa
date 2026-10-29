import { vfs } from '@/lib/vfs/vfs';
import {
  extractPublicHost,
  hasNpmDependencies,
  inferDevServerPlan,
  type DevServerPlan,
} from './devServerPlan';
import { applyEmergencyBlockedHostFix, prepareSandboxHostLaunch } from './hostRules';
import type { SandboxSession } from './provider';
import { classifyShellCommand, detectBlockedHost } from './shellClass';

export { inferDevServerPlan, type DevServerPlan };
export type DevServerState = 'stopped' | 'installing' | 'starting' | 'running' | 'crashed';

export interface DevServerStartOptions {
  command?: string;
  port?: number;
  forceInstall?: boolean;
  waitTimeoutMs?: number;
  resetOverride?: boolean;
  isAutoRetry?: boolean;
  onTerminalEcho?: (line: string) => void;
}

export interface DevServerStartResult {
  status: DevServerState;
  port: number;
  url: string | null;
  logTail: string;
  hostBlockedMessage: string | null;
}

export class CloudDevServerController {
  private bgHandle: { stop(): Promise<void> } | null = null;
  private logLines: string[] = [];
  private lastInstalledPkgJson: string | null = null;
  private lastOverride: { command?: string; port?: number } | null = null;
  private stablePort: number | null = null;
  private stableUrl: string | null = null;
  private runToken = 0;

  status: DevServerState = 'stopped';
  port = 3000;
  previewUrl: string | null = null;
  hostProbeOk = false;
  hostBlockedMessage: string | null = null;

  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
  }

  getLastOverride(): { command?: string; port?: number } | null {
    return this.lastOverride ? { ...this.lastOverride } : null;
  }

  private appendLog(chunk: string) {
    const lines = chunk.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return;
    this.logLines.push(...lines);
    if (this.logLines.length > 100) this.logLines = this.logLines.slice(-100);
    this.onChange();
  }

  getLogTail(count = 40): string {
    return this.logLines.slice(-count).join('\n');
  }

  private async stopHandleInternal(): Promise<void> {
    const handle = this.bgHandle;
    this.bgHandle = null;
    if (handle) {
      await handle.stop();
    }
  }

  async stop(): Promise<void> {
    this.runToken++;
    await this.stopHandleInternal();
    this.status = 'stopped';
    this.hostProbeOk = false;
    this.onChange();
  }

  async probeHostOnce(
    session: SandboxSession,
    port: number,
    publicHost: string
  ): Promise<{ httpCode: number; bodyHead: string; blockedHost: string | null }> {
    const probeCmd =
      `code=$(curl -s -o /tmp/kalpa-probe.html -w "%{http_code}" -H "Host: ${publicHost}" "http://127.0.0.1:${port}/" || echo 000); ` +
      `printf "%s\\n" "$code"; head -c 400 /tmp/kalpa-probe.html 2>/dev/null || true`;
    const probe = await session.exec(probeCmd, { timeoutMs: 6_000 });
    const nl = probe.stdout.indexOf('\n');
    const codeStr = (nl >= 0 ? probe.stdout.slice(0, nl) : probe.stdout).trim();
    const bodyHead = nl >= 0 ? probe.stdout.slice(nl + 1) : '';
    const httpCode = Number(codeStr) || 0;
    return { httpCode, bodyHead, blockedHost: detectBlockedHost(bodyHead) };
  }

  async startOrRestart(
    projectId: string,
    session: SandboxSession,
    opts?: DevServerStartOptions
  ): Promise<DevServerStartResult> {
    const token = ++this.runToken;
    await this.stopHandleInternal();

    if (opts?.resetOverride) this.lastOverride = null;
    else if (opts?.command) this.lastOverride = { command: opts.command, port: opts.port };

    const snap = await vfs.snapshot(projectId);
    const inferred = inferDevServerPlan(snap);
    const effectiveCmd = opts?.command ?? this.lastOverride?.command ?? inferred?.command;

    if (!effectiveCmd) {
      this.status = 'stopped';
      this.previewUrl = null;
      this.hostProbeOk = false;
      this.hostBlockedMessage = null;
      this.onChange();
      return {
        status: 'stopped',
        port: 0,
        url: null,
        logTail: 'No web dev server detected.',
        hostBlockedMessage: null,
      };
    }

    const classified = classifyShellCommand(effectiveCmd);
    const targetPort =
      opts?.port ?? this.lastOverride?.port ?? classified.port ?? inferred?.port ?? 3000;
    this.port = targetPort;
    if (!opts?.isAutoRetry) this.logLines = [];
    this.hostProbeOk = false;
    this.hostBlockedMessage = null;

    // 1. npm install (timeoutMs: 600_000) if package.json changed or node_modules missing
    const pkgRaw = snap['package.json'] ?? null;
    if (pkgRaw && hasNpmDependencies(pkgRaw)) {
      const nmCheck = await session.exec('[ -d node_modules ] && echo OK || echo MISSING', {
        timeoutMs: 8_000,
      });
      const nodeModulesMissing = !nmCheck.stdout.includes('OK');
      if (opts?.forceInstall || pkgRaw !== this.lastInstalledPkgJson || nodeModulesMissing) {
        this.status = 'installing';
        this.onChange();
        opts?.onTerminalEcho?.('$ npm install --no-audit --no-fund');
        const installRes = await session.exec('npm install --no-audit --no-fund', {
          timeoutMs: 600_000,
          onStdout: (s) => this.appendLog(s),
          onStderr: (s) => this.appendLog(s),
        });
        if (token !== this.runToken) {
          return {
            status: this.status,
            port: targetPort,
            url: this.previewUrl,
            logTail: this.getLogTail(),
            hostBlockedMessage: this.hostBlockedMessage,
          };
        }
        if (installRes.exitCode !== 0) {
          this.status = 'crashed';
          this.previewUrl = null;
          this.onChange();
          return {
            status: 'crashed',
            port: targetPort,
            url: null,
            logTail: this.getLogTail(40),
            hostBlockedMessage: null,
          };
        }
        this.lastInstalledPkgJson = pkgRaw;
      }
    }

    // 2. Apply sandbox-only public host configuration (A4)
    const rawPublicUrl = session.getPreviewUrl(targetPort);
    const publicHost = extractPublicHost(rawPublicUrl);
    const prepared = await prepareSandboxHostLaunch({
      session,
      snapshot: snap,
      baseCommand: effectiveCmd,
      port: targetPort,
      publicHost,
    });
    if (prepared.hostNote) this.appendLog(`[kalpa] ${prepared.hostNote}`);

    this.status = 'starting';
    if (this.stablePort !== targetPort) this.previewUrl = null;
    this.onChange();

    let activeCommand = prepared.command;
    let crashedDuringBoot = false;
    let swappingProcess = false;
    let usedWrapperFallback = false;
    let usedHostBlockRetry = false;
    let earlyExitRetried = Boolean(opts?.isAutoRetry);
    let startedAt = Date.now();

    const spawnServer = async (cmdToSpawn: string) => {
      swappingProcess = true;
      await this.stopHandleInternal();
      swappingProcess = false;
      crashedDuringBoot = false;
      startedAt = Date.now();
      opts?.onTerminalEcho?.(`$ ${cmdToSpawn}`);
      this.bgHandle = await session.startBackground(cmdToSpawn, {
        onStdout: (s) => this.appendLog(s),
        onStderr: (s) => this.appendLog(s),
        onExit: (code, errMsg) => {
          if (token !== this.runToken || swappingProcess) return;
          if (errMsg) this.appendLog(errMsg);
          this.appendLog(`[devserver exited with code ${code}]`);
          if (this.status === 'running' && Date.now() - startedAt < 60_000 && !earlyExitRetried) {
            earlyExitRetried = true;
            this.appendLog('[kalpa] Dev server exited within 60s; restarting once automatically…');
            void this.startOrRestart(projectId, session, { ...opts, isAutoRetry: true });
            return;
          }
          crashedDuringBoot = true;
          this.status = 'crashed';
          this.hostProbeOk = false;
          this.onChange();
        },
      });
    };

    await spawnServer(activeCommand);

    // 3. Poll readiness + public Host header probe every 1s up to 120s (install excluded)
    const waitBudgetMs = opts?.waitTimeoutMs ?? 120_000;
    const deadline = Date.now() + waitBudgetMs;

    while (Date.now() < deadline && token === this.runToken) {
      if (crashedDuringBoot) {
        const recentLog = this.getLogTail(35);
        if (
          !usedWrapperFallback &&
          prepared.fallbackCommand &&
          /Cannot find module|ERR_MODULE_NOT_FOUND|\.kalpa-(?:vite|astro)\.config/i.test(recentLog)
        ) {
          usedWrapperFallback = true;
          activeCommand = prepared.fallbackCommand;
          this.appendLog('[kalpa] Wrapper config failed; falling back to plain command…');
          this.status = 'starting';
          await spawnServer(activeCommand);
          continue;
        }
        if (Date.now() - startedAt < 60_000 && !earlyExitRetried) {
          earlyExitRetried = true;
          this.appendLog('[kalpa] Dev server exited early during boot; restarting once…');
          this.status = 'starting';
          await spawnServer(activeCommand);
          continue;
        }
        break;
      }

      const { httpCode, bodyHead, blockedHost } = await this.probeHostOnce(
        session,
        targetPort,
        publicHost
      );

      if (httpCode >= 200 && httpCode < 500) {
        if (Boolean(blockedHost) || httpCode === 403 || httpCode === 421) {
          if (!usedHostBlockRetry) {
            usedHostBlockRetry = true;
            this.appendLog(
              `[kalpa] Host "${blockedHost || publicHost}" rejected (HTTP ${httpCode}); applying host rule and restarting…`
            );
            activeCommand = await applyEmergencyBlockedHostFix({
              session,
              snapshot: snap,
              currentCommand: activeCommand,
              port: targetPort,
              publicHost,
            });
            await spawnServer(activeCommand);
            await new Promise((r) => setTimeout(r, 800));
            continue;
          }

          swappingProcess = true;
          await this.stopHandleInternal();
          swappingProcess = false;

          const exactMsg =
            bodyHead.trim() ||
            `Blocked request. Host "${publicHost}" was rejected with HTTP ${httpCode}.`;
          this.hostProbeOk = false;
          this.hostBlockedMessage = exactMsg;
          this.appendLog(`[kalpa] ${exactMsg}`);
          this.status = 'crashed';
          this.previewUrl = null;
          this.onChange();
          return {
            status: 'crashed',
            port: targetPort,
            url: null,
            logTail: this.getLogTail(40),
            hostBlockedMessage: exactMsg,
          };
        }

        const resolvedUrl =
          this.stablePort === targetPort && this.stableUrl ? this.stableUrl : rawPublicUrl;
        this.stablePort = targetPort;
        this.stableUrl = resolvedUrl;
        this.previewUrl = resolvedUrl;
        this.hostProbeOk = true;
        this.hostBlockedMessage = null;
        this.status = 'running';
        this.onChange();

        return {
          status: 'running',
          port: targetPort,
          url: this.previewUrl,
          logTail: this.getLogTail(40),
          hostBlockedMessage: null,
        };
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    if (token !== this.runToken) {
      return {
        status: this.status,
        port: targetPort,
        url: this.previewUrl,
        logTail: this.getLogTail(40),
        hostBlockedMessage: this.hostBlockedMessage,
      };
    }

    swappingProcess = true;
    await this.stopHandleInternal();
    swappingProcess = false;

    this.status = 'crashed';
    this.hostProbeOk = false;
    this.previewUrl = null;
    this.onChange();
    const timeoutSec = Math.round(waitBudgetMs / 1000);
    return {
      status: 'crashed',
      port: targetPort,
      url: null,
      logTail:
        this.getLogTail(40) || `Timed out waiting for port ${targetPort} after ${timeoutSec}s.`,
      hostBlockedMessage: this.hostBlockedMessage,
    };
  }
}
