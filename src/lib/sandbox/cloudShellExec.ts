import {
  formatAppNoticeResult,
  formatDevServerResult,
  formatShellResult,
} from '@/lib/agent/results';
import { useSandboxStore } from '@/stores/sandbox';
import { useTerminalStore } from '@/stores/terminal';
import type { SandboxSession } from './provider';
import { classifyShellCommand, splitShellLines } from './shellClass';
import { prepareShellMarker, syncSandboxChangesBackToVfs } from './sync';

export interface CloudShellActionInput {
  projectId: string;
  session: SandboxSession;
  cmd: string;
  cwd?: string;
  timeoutSec?: number;
  background?: boolean;
  port?: number;
  signal: AbortSignal;
  touchedPathsInTurn: Set<string>;
}

export interface CloudShellActionOutput {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  combinedOutput: string;
  resultBlocks: string[];
}

function isTimeoutOrDeadlineError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /deadline_exceeded|timed?\s*out|timeout/i.test(msg);
}

function isReadOnlyTypecheck(line: string): boolean {
  return /\btsc\b/.test(line) && /--noEmit\b/.test(line) && !/\bbuild\b/.test(line);
}

export async function executeCloudShellAction(
  input: CloudShellActionInput
): Promise<CloudShellActionOutput> {
  const {
    projectId,
    session,
    cmd,
    cwd,
    timeoutSec,
    background,
    port,
    signal,
    touchedPathsInTurn,
  } = input;

  const tAll = performance.now();
  const lines = splitShellLines(cmd);
  const resultBlocks: string[] = [];
  const summaryChunks: string[] = [];

  if (lines.length === 0) {
    return {
      ok: true,
      exitCode: 0,
      durationMs: 0,
      combinedOutput: '',
      resultBlocks: [formatShellResult(0, 0, '')],
    };
  }

  await prepareShellMarker(session);
  let ranForeground = false;
  let finalExitCode = 0;

  for (const line of lines) {
    if (signal.aborted) break;

    useTerminalStore.getState().writeLine(`$ ${line}`, 'system');
    const cls = classifyShellCommand(line);
    const treatAsServer =
      cls.kind === 'server' ||
      (Boolean(background) &&
        cls.kind !== 'install' &&
        cls.kind !== 'build' &&
        cls.kind !== 'test');

    // A2.3: Server or background command -> route through devServer controller, wait up to 90s
    if (treatAsServer) {
      const dsRes = await useSandboxStore.getState().startDevServerCommand(projectId, {
        command: line,
        port: port ?? cls.port,
        waitTimeoutMs: 90_000,
      });
      const mappedStatus = dsRes.status === 'running' ? 'running' : 'crashed';
      const detail = dsRes.hostBlockedMessage
        ? `${dsRes.hostBlockedMessage}\n${dsRes.logTail}`.trim()
        : dsRes.logTail || `(devserver ${mappedStatus})`;
      resultBlocks.push(formatDevServerResult(dsRes.port, mappedStatus, detail));
      summaryChunks.push(`[devserver :${dsRes.port} ${mappedStatus}]\n${detail}`);
      if (mappedStatus === 'crashed') {
        finalExitCode = 1;
      }
      continue;
    }

    // A5: Build guard — stop running dev server before writing build output, then restart + re-probe
    const sbBefore = useSandboxStore.getState();
    const needsBuildGuard =
      cls.kind === 'build' &&
      !isReadOnlyTypecheck(line) &&
      (sbBefore.devServerStatus === 'running' || sbBefore.devServerStatus === 'starting');
    const savedOverride = needsBuildGuard ? sbBefore.getLastDevServerOverride() : null;

    if (needsBuildGuard) {
      useTerminalStore
        .getState()
        .writeLine('[kalpa] Stopping dev server before build to prevent output corruption…', 'system');
      await sbBefore.stopDevServer();
    }

    const lineStart = performance.now();
    const timeoutMs = timeoutSec ? timeoutSec * 1000 : cls.timeoutMs;
    ranForeground = true;

    let exitCode = 0;
    let combinedLineOut = '';
    let convertedToServer = false;

    try {
      const execRes = await session.exec(line, {
        cwd,
        timeoutMs,
        onStdout: (s) => useTerminalStore.getState().writeLine(s.trimEnd(), 'info'),
        onStderr: (s) => useTerminalStore.getState().writeLine(s.trimEnd(), 'stderr'),
      });
      exitCode = execRes.exitCode;
      combinedLineOut = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n');
    } catch (err) {
      if (isTimeoutOrDeadlineError(err) && cls.kind === 'other') {
        // A2.4: Convert timed-out 'other' command to background server instead of failing
        convertedToServer = true;
        const fallbackPort = port ?? cls.port ?? 3000;
        const notice = `command is still running (treated as a server): ${line}`;
        useTerminalStore.getState().writeLine(`[kalpa] ${notice}`, 'system');
        const dsRes = await useSandboxStore.getState().startDevServerCommand(projectId, {
          command: line,
          port: fallbackPort,
          waitTimeoutMs: 45_000,
        });
        const mappedStatus = dsRes.status === 'running' ? 'running' : 'crashed';
        resultBlocks.push(formatAppNoticeResult(notice));
        resultBlocks.push(
          formatDevServerResult(
            dsRes.port,
            mappedStatus,
            dsRes.logTail || notice
          )
        );
        summaryChunks.push(`${notice}\n${dsRes.logTail}`);
      } else {
        exitCode = 124;
        combinedLineOut = err instanceof Error ? err.message : String(err);
        useTerminalStore.getState().writeLine(combinedLineOut, 'stderr');
      }
    }

    const lineMs = performance.now() - lineStart;

    if (!convertedToServer) {
      resultBlocks.push(formatShellResult(exitCode, lineMs, combinedLineOut));
      summaryChunks.push(`$ ${line}\n${combinedLineOut}`.trim());
    }

    if (needsBuildGuard) {
      useTerminalStore
        .getState()
        .writeLine('[kalpa] Restarting dev server after build…', 'system');
      const dsAfter = await useSandboxStore.getState().startDevServerCommand(projectId, {
        ...(savedOverride ?? {}),
        waitTimeoutMs: 90_000,
      });
      const afterStatus = dsAfter.status === 'running' ? 'running' : 'crashed';
      const afterDetail = dsAfter.hostBlockedMessage
        ? `${dsAfter.hostBlockedMessage}\n${dsAfter.logTail}`.trim()
        : dsAfter.logTail || `(devserver ${afterStatus})`;
      resultBlocks.push(formatDevServerResult(dsAfter.port, afterStatus, afterDetail));
      summaryChunks.push(`[devserver :${dsAfter.port} ${afterStatus}]\n${afterDetail}`);
    }

    // A2.5: Stop remaining lines on non-zero exit and report full output
    if (!convertedToServer && exitCode !== 0) {
      finalExitCode = exitCode;
      break;
    }
  }

  if (ranForeground) {
    const syncBack = await syncSandboxChangesBackToVfs(projectId, session);
    syncBack.syncedPaths.forEach((p) => touchedPathsInTurn.add(p));
    if (syncBack.warning) {
      resultBlocks.push(formatAppNoticeResult(syncBack.warning));
    }
  }

  const totalMs = Math.round(performance.now() - tAll);
  return {
    ok: finalExitCode === 0,
    exitCode: finalExitCode,
    durationMs: totalMs,
    combinedOutput: summaryChunks.filter(Boolean).join('\n\n'),
    resultBlocks,
  };
}
