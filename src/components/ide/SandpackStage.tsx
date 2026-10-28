'use client';

import React, { useEffect, useRef } from 'react';
import {
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  useSandpackConsole,
} from '@codesandbox/sandpack-react';
import { AlertTriangle, FileCode, MessageSquarePlus } from 'lucide-react';
import type { SandpackBundleSpec } from '@/lib/preview/sandpackFiles';
import { buildFixPromptFromError, parseFileLineFromMessage } from '@/lib/preview/errors';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useChatStore } from '@/stores/chat';
import { useAgentStore } from '@/stores/agent';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Button } from '@/components/ui/Button';

interface SandpackBridgeProps {
  projectId: string;
  bundle: SandpackBundleSpec;
}

function SandpackBridge({ projectId, bundle }: SandpackBridgeProps) {
  const { breakpoint } = useBreakpoint();
  const { sandpack, listen } = useSandpack();
  const { logs } = useSandpackConsole({ resetOnPreviewRestart: true });

  const setStatus = usePreviewStore((s) => s.setStatus);
  const pushEntry = usePreviewStore((s) => s.pushEntry);
  const markPreviewReady = usePreviewStore((s) => s.markPreviewReady);
  const openFile = useProjectStore((s) => s.openFile);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);
  const addToast = useUiStore((s) => s.addToast);

  const seenLogCountRef = useRef(0);
  const expectedHashRef = useRef(bundle.expectedFilesHash);
  const prevFilesRef = useRef<Record<string, string>>(bundle.files);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    expectedHashRef.current = bundle.expectedFilesHash;
  }, [bundle.expectedFilesHash]);

  // C5: Debounced content-only updates without remounting SandpackProvider
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      prevFilesRef.current = bundle.files;
      return;
    }

    const changed: Record<string, string> = {};
    for (const [k, v] of Object.entries(bundle.files)) {
      if (prevFilesRef.current[k] !== v) {
        changed[k] = v;
      }
    }
    prevFilesRef.current = bundle.files;
    if (Object.keys(changed).length === 0) return;

    setStatus('building');
    const timer = setTimeout(() => {
      sandpack.updateFile(changed);
    }, 250);
    return () => clearTimeout(timer);
  }, [bundle.files, sandpack, setStatus]);

  useEffect(() => {
    setStatus('building');
    const unsub = listen((msg: any) => {
      if (msg.type === 'done' && !msg.compilatonError) {
        markPreviewReady(expectedHashRef.current);
      } else if (msg.type === 'action' && msg.action === 'show-error') {
        const title = msg.title ? `${msg.title}: ` : '';
        const text = `${title}${msg.message || 'Bundler error'}`;
        const parsed = parseFileLineFromMessage(text);
        pushEntry({
          level: 'error',
          message: text,
          file: msg.path ? String(msg.path).replace(/^\/+/, '') : parsed.file,
          line: msg.line ?? parsed.line,
        });
      }
    });
    return () => unsub();
  }, [listen, markPreviewReady, pushEntry, setStatus]);

  useEffect(() => {
    if (logs.length < seenLogCountRef.current) {
      seenLogCountRef.current = 0;
    }
    const fresh = logs.slice(seenLogCountRef.current);
    seenLogCountRef.current = logs.length;
    for (const item of fresh) {
      const text = (item.data ?? [])
        .map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))
        .join(' ');
      if (!text) continue;
      const method = item.method;
      const level =
        method === 'error'
          ? 'error'
          : method === 'warn'
            ? 'warn'
            : method === 'info'
              ? 'info'
              : 'log';
      pushEntry({ level, message: text });
    }
  }, [logs, pushEntry]);

  const activeErr = sandpack.error;
  if (!activeErr) return null;

  const cleanFile = activeErr.path ? activeErr.path.replace(/^\/+/, '') : undefined;
  const line = activeErr.line;
  const fullMessage = `${activeErr.title ? `${activeErr.title}: ` : ''}${activeErr.message}`;

  return (
    <div className="absolute inset-x-3 bottom-3 z-20 rounded-[14px] bg-kalpa-bg-2/95 backdrop-blur-md border border-kalpa-danger/50 p-4 shadow-kalpa-soft space-y-3 max-h-[55%] overflow-y-auto">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-kalpa-danger shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-semibold text-kalpa-danger">Preview Compile / Runtime Error</p>
          {cleanFile ? (
            <button
              type="button"
              onClick={() => {
                openFile(cleanFile, line ? { line } : undefined);
                if (breakpoint === 'phone') setActiveIdeTab('code');
              }}
              className="inline-flex items-center gap-1 text-xs font-mono text-kalpa-violet hover:underline cursor-pointer"
            >
              <FileCode className="w-3.5 h-3.5" />
              {cleanFile}
              {line ? `:${line}` : ''}
            </button>
          ) : null}
          <pre className="text-xs font-mono text-kalpa-text whitespace-pre-wrap break-words m-0 pt-1">
            {fullMessage}
          </pre>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
          onClick={() => {
            const prompt = buildFixPromptFromError({
              id: 'err',
              level: 'error',
              message: fullMessage,
              file: cleanFile,
              line,
              time: Date.now(),
            });
            if (breakpoint === 'phone') setActiveIdeTab('chat');
            if (isAgentRunning) {
              setComposerDraft(prompt);
              addToast({ title: 'Agent busy — copied error into Chat input', kind: 'info' });
            } else {
              void sendUserMessage(projectId, prompt);
            }
          }}
        >
          Ask AI to fix
        </Button>
      </div>
    </div>
  );
}

export interface SandpackStageProps {
  projectId: string;
  reloadNonce: number;
  bundle: SandpackBundleSpec;
}

export function SandpackStage({ projectId, reloadNonce, bundle }: SandpackStageProps) {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <SandpackProvider
        key={`${projectId}-${bundle.structuralHash}-${reloadNonce}`}
        template={bundle.template}
        files={bundle.files}
        options={{
          recompileMode: 'delayed',
          recompileDelay: 350,
          autorun: true,
        }}
        style={{ height: '100%', width: '100%' }}
      >
        <SandpackPreview
          showNavigator={false}
          showRefreshButton={false}
          showOpenInCodeSandbox={false}
          style={{ height: '100%', width: '100%' }}
        />
        <SandpackBridge projectId={projectId} bundle={bundle} />
      </SandpackProvider>
    </div>
  );
}
