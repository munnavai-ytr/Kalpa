'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Cloud,
  Download,
  ExternalLink,
  Info,
  Laptop,
  MessageSquarePlus,
  Play,
  RotateCw,
  Smartphone,
  Tablet,
  TerminalSquare,
} from 'lucide-react';
import { filesHash } from '@/lib/agent/reliability';
import { filterOutBrainFiles } from '@/lib/brain/caps';
import { exportProjectAsZip } from '@/lib/export/zip';
import { chooseEngine, detectExtendedStack } from '@/lib/preview/detect';
import { buildStaticHtmlDocument } from '@/lib/preview/staticHtml';
import { buildSandpackBundle, type SandpackStackKind } from '@/lib/preview/sandpackFiles';
import { useProviderStore } from '@/lib/providers/store';
import { useAgentStore } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useChatStore } from '@/stores/chat';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { SandpackStage } from './SandpackStage';
import { ScriptRunnerView } from './ScriptRunnerView';
import { PreviewConsoleDrawer } from './PreviewConsoleDrawer';
import { CloudPreviewStage } from './CloudPreviewStage';
import { PreviewDebugSheet } from './PreviewDebugSheet';

const SANDPACK_STACKS = new Set<string>(['react', 'next-lite', 'vue', 'svelte', 'solid', 'angular']);

export function PreviewPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const snapshotProjectId = useProjectStore((s) => s.snapshotProjectId);
  const snapshot = useProjectStore((s) => s.snapshot);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);

  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const phaseLabel = useAgentStore((s) => s.statusLabel);
  const tasksMarkdown = useBrainStore((s) => s.memory.tasks);
  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);

  const engine = useSandboxStore((s) => s.engine);
  const sbStatus = useSandboxStore((s) => s.status);
  const userSelectedCloud = useSandboxStore((s) => s.userSelectedCloud);
  const devServerStatus = useSandboxStore((s) => s.devServerStatus);
  const devServerPort = useSandboxStore((s) => s.devServerPort);
  const devServerUrl = useSandboxStore((s) => s.devServerUrl);
  const runDevServer = useSandboxStore((s) => s.runDevServer);
  const switchEngine = useSandboxStore((s) => s.switchEngine);

  const status = usePreviewStore((s) => s.status);
  const deviceFrame = usePreviewStore((s) => s.deviceFrame);
  const consoleOpen = usePreviewStore((s) => s.consoleOpen);
  const reloadNonce = usePreviewStore((s) => s.reloadNonce);
  const entries = usePreviewStore((s) => s.entries);
  const staticBlobUrl = usePreviewStore((s) => s.staticBlobUrl);
  const expectedFilesHash = usePreviewStore((s) => s.expectedFilesHash);
  const confirmedFilesHash = usePreviewStore((s) => s.confirmedFilesHash);
  const staleAfterMaxRetries = usePreviewStore((s) => s.staleAfterMaxRetries);
  const tailwindProbe = usePreviewStore((s) => s.tailwindProbe);
  const setStatus = usePreviewStore((s) => s.setStatus);
  const setDeviceFrame = usePreviewStore((s) => s.setDeviceFrame);
  const setConsoleOpen = usePreviewStore((s) => s.setConsoleOpen);
  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const requestAutoRebuildForHash = usePreviewStore((s) => s.requestAutoRebuildForHash);
  const pushEntry = usePreviewStore((s) => s.pushEntry);
  const setStaticBlobUrl = usePreviewStore((s) => s.setStaticBlobUrl);
  const setExpectedFilesHash = usePreviewStore((s) => s.setExpectedFilesHash);
  const markPreviewReady = usePreviewStore((s) => s.markPreviewReady);
  const markPreviewBlank = usePreviewStore((s) => s.markPreviewBlank);
  const markPreviewTimeout = usePreviewStore((s) => s.markPreviewTimeout);
  const setTailwindProbe = usePreviewStore((s) => s.setTailwindProbe);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);
  const addToast = useUiStore((s) => s.addToast);

  const [debugOpen, setDebugOpen] = useState(false);
  const [newTabSheetOpen, setNewTabSheetOpen] = useState(false);

  const isStaleProjectSnapshot = !currentProject || snapshotProjectId !== currentProject.id;
  const cleanWorkspaceFiles = useMemo(
    () => (isStaleProjectSnapshot ? {} : filterOutBrainFiles(snapshot)),
    [isStaleProjectSnapshot, snapshot]
  );
  const detection = useMemo(() => detectExtendedStack(cleanWorkspaceFiles), [cleanWorkspaceFiles]);
  const chosenEngine = useMemo(
    () =>
      chooseEngine({
        detection,
        files: cleanWorkspaceFiles,
        cloudConnected: sbStatus === 'connected',
        userSwitchedToCloud: engine === 'cloud' && userSelectedCloud,
      }),
    [cleanWorkspaceFiles, detection, engine, sbStatus, userSelectedCloud]
  );

  const currentHash = useMemo(() => filesHash(cleanWorkspaceFiles), [cleanWorkspaceFiles]);
  const workspaceFileCount = useMemo(
    () => Object.keys(cleanWorkspaceFiles).filter((p) => !p.endsWith('/.gitkeep')).length,
    [cleanWorkspaceFiles]
  );
  const completedMilestoneCount = useMemo(
    () => (tasksMarkdown.match(/^\s*-\s*\[x\]/gim) || []).length,
    [tasksMarkdown]
  );

  useEffect(() => {
    if (!isStaleProjectSnapshot) {
      setExpectedFilesHash(currentHash);
    }
  }, [currentHash, isStaleProjectSnapshot, setExpectedFilesHash]);

  // B1 + B2(a) + B3: Handle preview-ready, preview-probe, tw-probe, and static console messages
  useEffect(() => {
    let freshnessTimer: ReturnType<typeof setTimeout> | null = null;
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;

      if (data.kalpa === 'tw-probe') {
        setTailwindProbe({
          ok: Boolean(data.ok),
          runtime: data.runtime === 'v4' ? 'v4' : 'v3',
          source: data.source === 'self' ? 'self' : data.source === 'cdn' ? 'cdn' : 'failed',
        });
        return;
      }

      const expectedHash = usePreviewStore.getState().expectedFilesHash;
      const agentBusy = useAgentStore.getState().isRunning;

      if (data.kalpa === 'preview-ready' && typeof data.filesHash === 'string') {
        if (data.filesHash === expectedHash) {
          if (freshnessTimer) clearTimeout(freshnessTimer);
          markPreviewReady(data.filesHash);
        } else if (expectedHash && !agentBusy) {
          if (freshnessTimer) clearTimeout(freshnessTimer);
          freshnessTimer = setTimeout(() => {
            const st = usePreviewStore.getState();
            if (
              st.expectedFilesHash &&
              st.confirmedFilesHash !== st.expectedFilesHash &&
              !useAgentStore.getState().isRunning
            ) {
              requestAutoRebuildForHash(st.expectedFilesHash);
            }
          }, 2500);
        }
        return;
      }

      if (data.kalpa === 'preview-probe') {
        if (data.filesHash && expectedHash && data.filesHash !== expectedHash) return;
        const rootChildren = typeof data.rootChildren === 'number' ? data.rootChildren : -1;
        const textLen = typeof data.textLen === 'number' ? data.textLen : 0;
        const hasVisualMedia = Boolean(data.hasVisualMedia);
        if (rootChildren === 0 || (textLen < 5 && !hasVisualMedia)) {
          markPreviewBlank();
        }
        return;
      }

      if (data.source === 'kalpa-static-preview') {
        pushEntry({
          level: data.level || 'log',
          message: String(data.message ?? ''),
          file: data.file,
          line: data.line,
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      if (freshnessTimer) clearTimeout(freshnessTimer);
      window.removeEventListener('message', onMessage);
    };
  }, [markPreviewBlank, markPreviewReady, pushEntry, requestAutoRebuildForHash, setTailwindProbe]);

  const useCloudView = engine === 'cloud' || chosenEngine === 'cloud';

  // Build static HTML document when detection.type === 'static'
  useEffect(() => {
    if (isStaleProjectSnapshot || useCloudView || detection.type !== 'static') {
      setStaticBlobUrl(null);
      return;
    }
    if (usePreviewStore.getState().lastReadyFilesHash !== currentHash) {
      setStatus('building');
    }
    const html = buildStaticHtmlDocument(cleanWorkspaceFiles, currentHash, detection.entry);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setStaticBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [cleanWorkspaceFiles, currentHash, detection.entry, detection.type, isStaleProjectSnapshot, reloadNonce, setStaticBlobUrl, setStatus, useCloudView]);

  const sandpackBundle = useMemo(() => {
    if (isStaleProjectSnapshot || useCloudView) return null;
    if (SANDPACK_STACKS.has(detection.type)) {
      return buildSandpackBundle(detection.type as SandpackStackKind, cleanWorkspaceFiles);
    }
    return null;
  }, [cleanWorkspaceFiles, detection.type, isStaleProjectSnapshot, useCloudView]);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const isWebIframeMode =
    !useCloudView && (detection.type === 'static' || SANDPACK_STACKS.has(detection.type));

  // B2(b): Guaranteed 30s termination into 'timeout' state (never stay on Updating... forever)
  useEffect(() => {
    if (!isWebIframeMode || status !== 'building') return;
    const t = setTimeout(() => {
      markPreviewTimeout();
    }, 30_000);
    return () => clearTimeout(t);
  }, [currentHash, isWebIframeMode, markPreviewTimeout, reloadNonce, status]);

  const handleQuickSwitchToCloud = async () => {
    if (!currentProject) return;
    if (!e2bApiKey.trim()) {
      addToast({
        title: 'Add E2B API key in Settings -> Engines',
        description: 'Cloud Sandbox runs a real Linux server using your own E2B key.',
        kind: 'info',
      });
      return;
    }
    await switchEngine(currentProject.id, 'cloud');
  };

  const handleAskAiFixBlank = () => {
    if (!currentProject) return;
    const recentLogs = entries
      .slice(-6)
      .map((e) => `[${e.level}] ${e.message}`)
      .join('\n');
    const prompt =
      `The preview started for ${detection.type} (${detection.entry || 'workspace'}) but rendered a blank screen (#root/#app/#__next is empty). ` +
      `Please inspect the entry mount and components and fix the blank render.${recentLogs ? `\n\nConsole logs:\n\`\`\`\n${recentLogs}\n\`\`\`` : ''}`;
    if (breakpoint === 'phone') setActiveIdeTab('chat');
    if (isAgentRunning) setComposerDraft(prompt);
    else void sendUserMessage(currentProject.id, prompt);
  };

  const frameWidthClass =
    deviceFrame === 'phone'
      ? 'w-[390px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
      : deviceFrame === 'tablet'
        ? 'w-[820px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
        : 'w-full';

  const externalHref = useCloudView
    ? devServerUrl
    : detection.type === 'static'
      ? staticBlobUrl
      : null;

  const statusText = useCloudView
    ? devServerStatus === 'installing'
      ? 'Installing…'
      : devServerStatus === 'starting'
        ? `Starting :${devServerPort}…`
        : devServerStatus === 'running'
          ? `Cloud :${devServerPort}`
          : devServerStatus === 'crashed'
            ? 'Server crashed'
            : 'Cloud idle'
    : errorCount > 0 || status === 'error'
      ? `Error (${Math.max(1, errorCount)})`
      : status === 'timeout'
        ? 'Timed out'
        : status === 'blank'
          ? 'Blank screen'
          : status === 'building'
            ? 'Updating…'
            : status === 'ready'
              ? 'Ready'
              : 'Preview';

  const pythonAutoRunKey =
    currentProject && !isAgentRunning
      ? `${currentProject.id}:m:${completedMilestoneCount}`
      : undefined;

  return (
    <div className="relative h-full flex flex-col bg-kalpa-bg">
      <div className="h-11 px-2.5 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconButton label="Reload preview" size="sm" onClick={reloadPreview}>
            <RotateCw className="w-3.5 h-3.5" />
          </IconButton>
          {useCloudView && currentProject ? (
            <IconButton label="Restart Cloud dev server" size="sm" onClick={() => void runDevServer(currentProject.id)}>
              <Play className="w-3.5 h-3.5 text-kalpa-success" />
            </IconButton>
          ) : null}
          <span className="text-xs font-medium text-kalpa-muted truncate">{statusText}</span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {breakpoint === 'desktop' ? (
            <>
              <IconButton label="Phone frame (390px)" size="sm" active={deviceFrame === 'phone'} onClick={() => setDeviceFrame('phone')}>
                <Smartphone className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton label="Tablet frame (820px)" size="sm" active={deviceFrame === 'tablet'} onClick={() => setDeviceFrame('tablet')}>
                <Tablet className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton label="Fit desktop width" size="sm" active={deviceFrame === 'desktop'} onClick={() => setDeviceFrame('desktop')}>
                <Laptop className="w-3.5 h-3.5" />
              </IconButton>
            </>
          ) : null}

          <IconButton label="Preview inspector" size="sm" active={debugOpen} onClick={() => setDebugOpen(true)}>
            <Info className="w-3.5 h-3.5" />
          </IconButton>

          {!useCloudView ? (
            <IconButton label="Toggle preview console" size="sm" active={consoleOpen} onClick={() => setConsoleOpen(!consoleOpen)}>
              <TerminalSquare className="w-3.5 h-3.5" />
            </IconButton>
          ) : null}

          {externalHref ? (
            <a
              href={externalHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open preview in new tab"
              title="Open in new tab"
              className="inline-flex items-center justify-center min-h-[36px] min-w-[36px] p-1.5 rounded-[10px] text-kalpa-muted hover:text-kalpa-text hover:bg-kalpa-surface"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          ) : (
            <IconButton label="Open in new tab options" size="sm" onClick={() => setNewTabSheetOpen(true)}>
              <ExternalLink className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {/* B2(b): 30s bundler timeout banner */}
      {!useCloudView && status === 'timeout' ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">Preview timed out after 30s on this network.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={reloadPreview} className="underline font-semibold cursor-pointer">
              Reload
            </button>
            <button type="button" onClick={() => void handleQuickSwitchToCloud()} className="underline font-semibold cursor-pointer">
              Cloud Sandbox
            </button>
          </div>
        </div>
      ) : null}

      {/* B2(a): Max 2 freshness auto-rebuild cap banner */}
      {!useCloudView && staleAfterMaxRetries ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">Preview may be out of date.</span>
          <button type="button" onClick={reloadPreview} className="underline font-semibold shrink-0 cursor-pointer">
            Rebuild
          </button>
        </div>
      ) : null}

      {/* B1: Tailwind probe failure banner */}
      {!useCloudView && tailwindProbe && !tailwindProbe.ok ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/30 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">
            Tailwind styles did not load (network/CDN). Try Rebuild, or use the Cloud Sandbox.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={reloadPreview} className="underline font-semibold cursor-pointer">
              Rebuild
            </button>
            <button type="button" onClick={() => void handleQuickSwitchToCloud()} className="underline font-semibold cursor-pointer">
              Cloud Sandbox
            </button>
          </div>
        </div>
      ) : null}

      {/* B3: Blank-screen detection banner */}
      {!useCloudView && status === 'blank' && errorCount === 0 ? (
        <div className="px-3 py-2 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          <span className="text-kalpa-warn font-medium truncate">
            The app started but rendered nothing (#root / #app is empty).
          </span>
          <Button
            size="sm"
            variant="primary"
            leftIcon={<MessageSquarePlus className="w-3.5 h-3.5" />}
            onClick={handleAskAiFixBlank}
          >
            Ask AI to fix
          </Button>
        </div>
      ) : null}

      {/* Next-Lite limited server features banner */}
      {!useCloudView && sandpackBundle && sandpackBundle.unsupportedNextFeatures.length > 0 ? (
        <div className="px-3 py-1.5 bg-kalpa-violet/15 border-b border-kalpa-violet/35 text-[11px] text-kalpa-text flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
            <span className="truncate">
              Server features detected:{' '}
              {sandpackBundle.unsupportedNextFeatures.map((u) => `${u.file} (${u.reason})`).join(', ')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleQuickSwitchToCloud()}
            className="inline-flex items-center gap-1 text-kalpa-violet font-semibold hover:underline shrink-0 cursor-pointer"
          >
            <Cloud className="w-3 h-3" /> Switch to Cloud
          </button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden bg-kalpa-bg flex flex-col">
        {isStaleProjectSnapshot ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-kalpa-muted">
            <Spinner size={20} className="text-kalpa-violet" />
            <p className="text-xs font-mono">Syncing project workspace…</p>
          </div>
        ) : useCloudView && currentProject ? (
          <CloudPreviewStage projectId={currentProject.id} reloadNonce={reloadNonce} frameWidthClass={frameWidthClass} />
        ) : chosenEngine === 'needs-cloud' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-3">
            <Cloud className="w-8 h-8 text-kalpa-violet" />
            <p className="text-sm font-semibold text-kalpa-text">This stack runs in Cloud Sandbox</p>
            <p className="text-xs text-kalpa-muted leading-relaxed">{detection.reason}</p>
            <Button size="sm" variant="primary" leftIcon={<Cloud className="w-3.5 h-3.5" />} onClick={() => void handleQuickSwitchToCloud()}>
              Connect Cloud Sandbox
            </Button>
          </div>
        ) : detection.type === 'static' && staticBlobUrl && currentProject ? (
          <div className={`flex-1 min-h-0 bg-white ${frameWidthClass}`}>
            <iframe
              key={`static-${currentProject.id}-${reloadNonce}`}
              src={staticBlobUrl}
              title="Static application preview"
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="w-full h-full border-0"
            />
          </div>
        ) : sandpackBundle && currentProject ? (
          <div className={`flex-1 min-h-0 ${frameWidthClass}`}>
            <SandpackStage projectId={currentProject.id} reloadNonce={reloadNonce} bundle={sandpackBundle} />
          </div>
        ) : (chosenEngine === 'python' || chosenEngine === 'node-script') && currentProject ? (
          <ScriptRunnerView
            projectId={currentProject.id}
            projectType={chosenEngine === 'python' ? 'python' : 'node-script'}
            snapshot={cleanWorkspaceFiles}
            activeFilePath={activeFilePath}
            entryFile={detection.entry}
            autoRunKey={chosenEngine === 'python' ? pythonAutoRunKey : undefined}
          />
        ) : isAgentRunning ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto space-y-3">
            <Spinner size={24} className="text-kalpa-violet" />
            <p className="text-sm font-semibold text-kalpa-text">Kalpa is building your app…</p>
            <p className="text-xs font-mono text-kalpa-violet">{phaseLabel || 'Writing workspace files…'}</p>
            <p className="text-xs text-kalpa-muted leading-relaxed">
              Live preview will start automatically as soon as your project files are written.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-kalpa-muted space-y-2">
            <p className="text-sm font-medium text-kalpa-text">Workspace has no runnable files yet</p>
            <p className="text-xs max-w-sm leading-relaxed">
              Describe what you want in Chat or import a ZIP / folder — Preview renders static HTML, React, Next.js, Python, and JS automatically.
            </p>
          </div>
        )}

        {!useCloudView && consoleOpen ? <PreviewConsoleDrawer /> : null}
      </div>

      {/* B6: Sandpack / Next-Lite standalone URL explanation sheet (never codesandbox.io) */}
      <Modal
        open={newTabSheetOpen}
        onClose={() => setNewTabSheetOpen(false)}
        title="In-Memory Preview Bundle"
        description="Instant Engine compiles your code locally in browser memory, so there is no standalone public URL yet."
        maxWidthClass="max-w-md"
      >
        <div className="space-y-3 text-xs text-kalpa-muted">
          <p className="leading-relaxed">
            To open your app in an external browser tab or share a live URL, run it in your Cloud Sandbox (E2B) or export the project as a standard ZIP archive.
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Download className="w-3.5 h-3.5" />}
              onClick={() => {
                setNewTabSheetOpen(false);
                if (currentProject) {
                  void exportProjectAsZip(currentProject.id, currentProject.name);
                }
              }}
            >
              Export ZIP
            </Button>
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Cloud className="w-3.5 h-3.5" />}
              onClick={() => {
                setNewTabSheetOpen(false);
                void handleQuickSwitchToCloud();
              }}
            >
              Open in Cloud Sandbox
            </Button>
          </div>
        </div>
      </Modal>

      <PreviewDebugSheet
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        projectId={currentProject?.id ?? null}
        projectName={currentProject?.name ?? null}
        engine={useCloudView ? 'cloud' : 'instant'}
        detection={detection}
        workspaceFileCount={workspaceFileCount}
        sandpackFileCount={sandpackBundle ? Object.keys(sandpackBundle.files).length : 0}
        status={status}
        expectedFilesHash={expectedFilesHash}
        confirmedFilesHash={confirmedFilesHash}
        tailwindProbe={tailwindProbe}
        entries={entries}
      />
    </div>
  );
}
