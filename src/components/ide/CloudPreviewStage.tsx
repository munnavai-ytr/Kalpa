'use client';

import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Clock,
  Cloud,
  ExternalLink,
  MessageSquarePlus,
  Play,
  RotateCw,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import {
  buildTailwindUnappliedDiagnosticMessage,
  runProjectScaffoldDoctor,
} from '@/lib/agent/verify';
import { useSandboxStore } from '@/stores/sandbox';
import { usePreviewStore } from '@/stores/preview';
import { useChatStore } from '@/stores/chat';
import { useAgentStore } from '@/stores/agent';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';

export interface CloudPreviewStageProps {
  projectId: string;
  reloadNonce: number;
  frameWidthClass: string;
}

function formatLease(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CloudPreviewStage({
  projectId,
  reloadNonce,
  frameWidthClass,
}: CloudPreviewStageProps) {
  const { breakpoint } = useBreakpoint();
  const status = useSandboxStore((s) => s.status);
  const remainingMs = useSandboxStore((s) => s.remainingMs);
  const devServerStatus = useSandboxStore((s) => s.devServerStatus);
  const devServerPort = useSandboxStore((s) => s.devServerPort);
  const devServerUrl = useSandboxStore((s) => s.devServerUrl);
  const devServerLogTail = useSandboxStore((s) => s.devServerLogTail);
  const hostBlockedMessage = useSandboxStore((s) => s.hostBlockedMessage);
  const cloudBeaconErrors = useSandboxStore((s) => s.cloudBeaconErrors);
  const cloudBlankScreen = useSandboxStore((s) => s.cloudBlankScreen);
  const cloudStylesUnapplied = useSandboxStore((s) => s.cloudStylesUnapplied);
  const runDevServer = useSandboxStore((s) => s.runDevServer);
  const recreateCloud = useSandboxStore((s) => s.recreateCloud);
  const extendCloud = useSandboxStore((s) => s.extendCloud);
  const pushCloudBeaconError = useSandboxStore((s) => s.pushCloudBeaconError);
  const setCloudBlankScreen = useSandboxStore((s) => s.setCloudBlankScreen);
  const setCloudStylesUnapplied = useSandboxStore((s) => s.setCloudStylesUnapplied);

  const pushPreviewEntry = usePreviewStore((s) => s.pushEntry);
  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const [showLogsOverlay, setShowLogsOverlay] = useState(false);
  const [fixingStyles, setFixingStyles] = useState(false);

  // A7 + B2: Listen for cloud-beacon messages (including Tailwind style probe) from *.e2b.app iframe
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.origin !== 'string' || !ev.origin.endsWith('.e2b.app')) return;
      const data = ev.data;
      if (!data || typeof data !== 'object' || data.kalpa !== 'cloud-beacon') return;

      if (data.type === 'error' || data.type === 'rejection') {
        const message = String(data.message || 'Runtime error in Cloud preview');
        const source = data.source ? String(data.source) : undefined;
        const line = typeof data.line === 'number' && data.line > 0 ? data.line : undefined;
        pushCloudBeaconError({ message, source, line });
        pushPreviewEntry({ level: 'error', message, file: source, line });
      } else if (data.type === 'probe') {
        const rootChildren = typeof data.rootChildren === 'number' ? data.rootChildren : -1;
        const textLen = typeof data.textLen === 'number' ? data.textLen : 0;
        const isBlank = rootChildren === 0 || textLen < 5;
        setCloudBlankScreen(isBlank);

        const tw = typeof data.tw === 'string' ? data.tw : 'unknown';
        if (
          rootChildren > 0 &&
          (tw === 'directives-unprocessed' || tw === 'utilities-missing')
        ) {
          setCloudStylesUnapplied(tw);
        } else {
          setCloudStylesUnapplied(null);
        }
        window.dispatchEvent(
          new CustomEvent('kalpa:cloud-probe', { detail: { rootChildren, textLen, tw } })
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushCloudBeaconError, pushPreviewEntry, setCloudBlankScreen, setCloudStylesUnapplied]);

  const sendFixRequest = (prompt: string) => {
    if (breakpoint === 'phone') setActiveIdeTab('chat');
    if (isAgentRunning) setComposerDraft(prompt);
    else void sendUserMessage(projectId, prompt);
  };

  if (status === 'connecting') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Spinner size={24} className="text-kalpa-violet" />
        <p className="text-sm font-semibold text-kalpa-text">Booting Ubuntu Linux microVM…</p>
        <p className="text-xs text-kalpa-muted max-w-sm">
          Syncing your virtual file system and preparing port {devServerPort}.
        </p>
      </div>
    );
  }

  // A9: Expired sandbox state with one-click Recreate
  if (status === 'expired') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Clock className="w-7 h-7 text-kalpa-warn" />
        <p className="text-sm font-semibold text-kalpa-text">Environment expired - Recreate</p>
        <p className="text-xs text-kalpa-muted max-w-sm">
          Your files are safely stored in Kalpa&apos;s browser VFS. Recreate spins up a fresh sandbox, syncs all files, and restarts your dev server.
        </p>
        <Button
          size="sm"
          variant="primary"
          leftIcon={<RotateCw className="w-3.5 h-3.5" />}
          onClick={() => void recreateCloud(projectId)}
        >
          Environment expired - Recreate
        </Button>
      </div>
    );
  }

  if (status !== 'connected') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Cloud className="w-7 h-7 text-kalpa-muted" />
        <p className="text-sm font-semibold text-kalpa-text">Cloud Sandbox not connected</p>
        <Button size="sm" variant="primary" onClick={() => void recreateCloud(projectId)}>
          Connect Cloud Sandbox
        </Button>
      </div>
    );
  }

  const isWorking = devServerStatus === 'installing' || devServerStatus === 'starting';
  const statusBadgeLabel =
    devServerStatus === 'installing'
      ? 'Installing'
      : devServerStatus === 'starting'
        ? 'Starting'
        : devServerStatus === 'running'
          ? cloudStylesUnapplied
            ? 'Styles not applied'
            : 'Running'
          : devServerStatus === 'crashed'
            ? 'Crashed'
            : 'Stopped';

  const hasIssue =
    devServerStatus === 'crashed' ||
    Boolean(hostBlockedMessage) ||
    cloudBlankScreen ||
    Boolean(cloudStylesUnapplied) ||
    cloudBeaconErrors.length > 0;

  const handleFixStylesAutomatically = async () => {
    if (fixingStyles) return;
    setFixingStyles(true);
    try {
      const docOut = await runProjectScaffoldDoctor(projectId, {
        source: 'auto-fix-styles',
        force: true,
      });
      await runDevServer(projectId, docOut.pkgChanged);
      reloadPreview();
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(t);
          window.removeEventListener('kalpa:cloud-probe', finish);
          resolve();
        };
        const t = setTimeout(finish, 4500);
        window.addEventListener('kalpa:cloud-probe', finish, { once: true });
      });
    } finally {
      setFixingStyles(false);
    }
  };

  const handleAskAiFixStyles = async () => {
    const reason = cloudStylesUnapplied ?? 'directives-unprocessed';
    const diag = await buildTailwindUnappliedDiagnosticMessage(
      projectId,
      reason,
      devServerPort,
      devServerLogTail
    );
    sendFixRequest(`Please fix the unstyled Tailwind setup in this project.\n\n${diag}`);
  };

  const handleAskAiToFix = () => {
    if (
      cloudStylesUnapplied &&
      !cloudBlankScreen &&
      cloudBeaconErrors.length === 0 &&
      devServerStatus === 'running'
    ) {
      void handleAskAiFixStyles();
      return;
    }
    const beaconSection =
      cloudBeaconErrors.length > 0
        ? `\n\nBrowser runtime errors:\n${cloudBeaconErrors
            .map((e) => `- ${e.source ? `${e.source}${e.line ? `:${e.line}` : ''}: ` : ''}${e.message}`)
            .join('\n')}`
        : '';
    const hostSection = hostBlockedMessage ? `\n\nHost check error:\n${hostBlockedMessage}` : '';
    const blankNote = cloudBlankScreen
      ? '\n\nNote: The Cloud preview started on port ' +
        devServerPort +
        ' but rendered a blank screen (#root/#app/#__next has 0 children or empty body).'
      : '';
    const prompt =
      `Please fix the Cloud Sandbox preview issue on port ${devServerPort}.${blankNote}${hostSection}${beaconSection}\n\n` +
      `Recent dev server logs:\n\`\`\`\n${(devServerLogTail || '(no server logs)').slice(-2400)}\n\`\`\``;
    sendFixRequest(prompt);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* A6 + A9: Persistent Cloud Preview status bar */}
      <div className="px-3 py-1.5 border-b border-kalpa-border bg-kalpa-bg-2 flex flex-wrap items-center justify-between gap-2 shrink-0 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {isWorking ? (
            <Spinner size={13} className="text-kalpa-violet shrink-0" />
          ) : devServerStatus === 'crashed' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-kalpa-danger shrink-0" />
          ) : devServerStatus === 'running' && cloudStylesUnapplied ? (
            <AlertTriangle className="w-3.5 h-3.5 text-kalpa-warn shrink-0" />
          ) : (
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                devServerStatus === 'running' ? 'bg-kalpa-success' : 'bg-kalpa-muted'
              }`}
            />
          )}
          <span
            className={`font-semibold ${
              devServerStatus === 'running' && cloudStylesUnapplied
                ? 'text-kalpa-warn'
                : 'text-kalpa-text'
            }`}
          >
            {statusBadgeLabel}
          </span>
          <span className="font-mono text-[11px] text-kalpa-muted">:{devServerPort}</span>
          <span className="font-mono text-[11px] text-kalpa-muted">
            · {formatLease(remainingMs)} left
          </span>
          {remainingMs > 0 && remainingMs < 10 * 60 * 1000 ? (
            <button
              type="button"
              onClick={() => void extendCloud()}
              className="text-[11px] text-kalpa-violet hover:underline font-medium cursor-pointer"
            >
              +15m
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasIssue && !(devServerStatus === 'running' && cloudStylesUnapplied && !cloudBlankScreen && cloudBeaconErrors.length === 0) ? (
            <Button
              size="sm"
              variant="primary"
              leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
              onClick={handleAskAiToFix}
            >
              Ask AI to fix
            </Button>
          ) : null}

          {devServerStatus === 'running' ? (
            <button
              type="button"
              onClick={() => setShowLogsOverlay((v) => !v)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-[8px] text-[11px] text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface cursor-pointer"
            >
              <TerminalSquare className="w-3 h-3" /> Logs
            </button>
          ) : null}

          <Button
            size="sm"
            variant="secondary"
            disabled={isWorking || fixingStyles}
            leftIcon={<Play className="w-3 h-3" />}
            onClick={() => void runDevServer(projectId)}
          >
            {devServerStatus === 'stopped' ? 'Start' : 'Restart'}
          </Button>

          {devServerUrl ? (
            <a
              href={devServerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[10px] border border-kalpa-border bg-kalpa-surface text-[11px] font-medium text-kalpa-text hover:border-kalpa-violet"
            >
              <ExternalLink className="w-3 h-3" /> Open in new tab
            </a>
          ) : null}
        </div>
      </div>

      {/* B2: Styles not applied banner when Tailwind/PostCSS did not process styles */}
      {devServerStatus === 'running' &&
      cloudStylesUnapplied &&
      !cloudBlankScreen &&
      cloudBeaconErrors.length === 0 ? (
        <div className="px-3 py-2 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold text-kalpa-warn">Styles not applied</p>
            <p className="text-[11px] text-kalpa-text">
              The app runs but Tailwind styles are not applied (PostCSS/Tailwind is not running).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              loading={fixingStyles}
              leftIcon={<Wrench className="w-3.5 h-3.5" />}
              onClick={() => void handleFixStylesAutomatically()}
            >
              Fix setup automatically
            </Button>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
              onClick={() => void handleAskAiFixStyles()}
            >
              Ask AI to fix
            </Button>
          </div>
        </div>
      ) : null}

      {/* A7: Blank screen or runtime error banner while server is running */}
      {devServerStatus === 'running' && (cloudBlankScreen || cloudBeaconErrors.length > 0) ? (
        <div className="px-3 py-2 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-semibold text-kalpa-warn">
              {cloudBlankScreen
                ? 'The app started but rendered nothing'
                : `Runtime error in Cloud preview (${cloudBeaconErrors.length})`}
            </p>
            {cloudBeaconErrors.length > 0 ? (
              <p className="font-mono text-[11px] text-kalpa-danger truncate">
                {cloudBeaconErrors[cloudBeaconErrors.length - 1].message}
              </p>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
            onClick={handleAskAiToFix}
          >
            Ask AI to fix
          </Button>
        </div>
      ) : null}

      {devServerStatus === 'running' && devServerUrl ? (
        <div className={`relative flex-1 min-h-0 bg-white ${frameWidthClass}`}>
          <iframe
            key={`cloud-${devServerUrl}-${reloadNonce}`}
            src={devServerUrl}
            title="Cloud Sandbox application preview"
            className="w-full h-full border-0"
          />
          {showLogsOverlay ? (
            <div className="absolute inset-x-3 bottom-3 max-h-[45%] rounded-[12px] bg-kalpa-bg-2/95 backdrop-blur-md border border-kalpa-border p-3 overflow-y-auto font-mono text-[11px] text-kalpa-muted whitespace-pre-wrap shadow-kalpa-soft">
              {devServerLogTail || '(no server output yet)'}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col p-4 gap-2">
          <p className="text-xs text-kalpa-muted">
            {devServerStatus === 'installing'
              ? 'Installing dependencies in /home/user/app…'
              : devServerStatus === 'starting'
                ? `Starting dev server and verifying public host on port ${devServerPort}…`
                : hostBlockedMessage
                  ? hostBlockedMessage
                  : devServerStatus === 'crashed'
                    ? 'Dev server exited or failed readiness probe. Review the logs below or click Ask AI to fix.'
                    : 'Dev server is currently stopped.'}
          </p>
          <div className="flex-1 min-h-0 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border p-3.5 overflow-y-auto font-mono text-xs text-kalpa-muted whitespace-pre-wrap">
            {devServerLogTail || 'Waiting for dev server output…'}
          </div>
        </div>
      )}
    </div>
  );
}
