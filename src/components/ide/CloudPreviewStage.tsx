'use client';

import React from 'react';
import { AlertTriangle, Cloud, MessageSquarePlus, Play } from 'lucide-react';
import { useSandboxStore } from '@/stores/sandbox';
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

export function CloudPreviewStage({
  projectId,
  reloadNonce,
  frameWidthClass,
}: CloudPreviewStageProps) {
  const { breakpoint } = useBreakpoint();
  const status = useSandboxStore((s) => s.status);
  const devServerStatus = useSandboxStore((s) => s.devServerStatus);
  const devServerPort = useSandboxStore((s) => s.devServerPort);
  const devServerUrl = useSandboxStore((s) => s.devServerUrl);
  const devServerLogTail = useSandboxStore((s) => s.devServerLogTail);
  const runDevServer = useSandboxStore((s) => s.runDevServer);
  const recreateCloud = useSandboxStore((s) => s.recreateCloud);

  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

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

  if (status !== 'connected') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
        <Cloud className="w-7 h-7 text-kalpa-muted" />
        <p className="text-sm font-semibold text-kalpa-text">Cloud Sandbox not connected</p>
        <Button size="sm" variant="primary" onClick={() => recreateCloud(projectId)}>
          Connect Cloud Sandbox
        </Button>
      </div>
    );
  }

  if (devServerStatus === 'running' && devServerUrl) {
    return (
      <div className={`flex-1 min-h-0 bg-white ${frameWidthClass}`}>
        <iframe
          key={`cloud-${devServerUrl}-${reloadNonce}`}
          src={devServerUrl}
          title="Cloud Sandbox application preview"
          className="w-full h-full border-0"
        />
      </div>
    );
  }

  const isWorking = devServerStatus === 'installing' || devServerStatus === 'starting';

  return (
    <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
      <div className="p-3.5 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {isWorking ? (
            <Spinner size={15} className="text-kalpa-violet shrink-0" />
          ) : devServerStatus === 'crashed' ? (
            <AlertTriangle className="w-4 h-4 text-kalpa-danger shrink-0" />
          ) : (
            <Cloud className="w-4 h-4 text-kalpa-violet shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-kalpa-text">
              {devServerStatus === 'installing'
                ? 'Installing npm dependencies in Cloud Sandbox…'
                : devServerStatus === 'starting'
                  ? `Starting dev server on port ${devServerPort}…`
                  : devServerStatus === 'crashed'
                    ? 'Cloud dev server crashed or exited'
                    : 'Cloud dev server stopped'}
            </p>
            <p className="text-[11px] text-kalpa-muted font-mono truncate">
              /home/user/app · port {devServerPort}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {devServerStatus === 'crashed' ? (
            <Button
              size="sm"
              variant="primary"
              leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
              onClick={() => {
                const prompt = `The Cloud Sandbox dev server crashed on port ${devServerPort}. Please inspect the logs below and fix the root cause:\n\n\`\`\`\n${devServerLogTail.slice(-2400)}\n\`\`\``;
                if (breakpoint === 'phone') setActiveIdeTab('chat');
                if (isAgentRunning) setComposerDraft(prompt);
                else void sendUserMessage(projectId, prompt);
              }}
            >
              Ask AI to fix
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="secondary"
            disabled={isWorking}
            leftIcon={<Play className="w-3.5 h-3.5" />}
            onClick={() => runDevServer(projectId)}
          >
            {devServerStatus === 'stopped' ? 'Start Server' : 'Restart'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border p-3.5 overflow-y-auto font-mono text-xs text-kalpa-muted whitespace-pre-wrap">
        {devServerLogTail || 'Waiting for dev server output…'}
      </div>
    </div>
  );
}
