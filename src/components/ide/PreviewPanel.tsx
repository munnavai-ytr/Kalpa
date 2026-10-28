'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Cloud,
  ExternalLink,
  Info,
  Laptop,
  Play,
  RotateCw,
  Smartphone,
  Tablet,
  TerminalSquare,
} from 'lucide-react';
import { filesHash } from '@/lib/agent/reliability';
import { filterOutBrainFiles } from '@/lib/brain/caps';
import { detectProjectType } from '@/lib/preview/detect';
import { buildStaticHtmlDocument } from '@/lib/preview/staticHtml';
import { buildSandpackBundle } from '@/lib/preview/sandpackFiles';
import { useProviderStore } from '@/lib/providers/store';
import { useAgentStore } from '@/stores/agent';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Spinner } from '@/components/ui/Spinner';
import { SandpackStage } from './SandpackStage';
import { ScriptRunnerView } from './ScriptRunnerView';
import { PreviewConsoleDrawer } from './PreviewConsoleDrawer';
import { CloudPreviewStage } from './CloudPreviewStage';
import { PreviewDebugSheet } from './PreviewDebugSheet';

export function PreviewPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const snapshotProjectId = useProjectStore((s) => s.snapshotProjectId);
  const snapshot = useProjectStore((s) => s.snapshot);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);

  const isAgentRunning = useAgentStore((s) => s.isRunning);
  const phaseLabel = useAgentStore((s) => s.statusLabel);

  const engine = useSandboxStore((s) => s.engine);
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
  const setStatus = usePreviewStore((s) => s.setStatus);
  const setDeviceFrame = usePreviewStore((s) => s.setDeviceFrame);
  const setConsoleOpen = usePreviewStore((s) => s.setConsoleOpen);
  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const pushEntry = usePreviewStore((s) => s.pushEntry);
  const setStaticBlobUrl = usePreviewStore((s) => s.setStaticBlobUrl);
  const setExpectedFilesHash = usePreviewStore((s) => s.setExpectedFilesHash);
  const markPreviewReady = usePreviewStore((s) => s.markPreviewReady);
  const addToast = useUiStore((s) => s.addToast);

  const [debugOpen, setDebugOpen] = useState(false);
  const [slowBundlerWarning, setSlowBundlerWarning] = useState(false);

  const isStaleProjectSnapshot = !currentProject || snapshotProjectId !== currentProject.id;
  const cleanWorkspaceFiles = useMemo(
    () => (isStaleProjectSnapshot ? {} : filterOutBrainFiles(snapshot)),
    [isStaleProjectSnapshot, snapshot]
  );
  const detection = useMemo(() => detectProjectType(cleanWorkspaceFiles), [cleanWorkspaceFiles]);
  const currentHash = useMemo(() => filesHash(cleanWorkspaceFiles), [cleanWorkspaceFiles]);
  const workspaceFileCount = useMemo(
    () => Object.keys(cleanWorkspaceFiles).filter((p) => !p.endsWith('/.gitkeep')).length,
    [cleanWorkspaceFiles]
  );

  useEffect(() => {
    if (!isStaleProjectSnapshot) {
      setExpectedFilesHash(currentHash);
    }
  }, [currentHash, isStaleProjectSnapshot, setExpectedFilesHash]);

  // C6: Listen for both static console events and { kalpa: 'preview-ready', filesHash }
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.kalpa === 'preview-ready' && typeof data.filesHash === 'string') {
        markPreviewReady(data.filesHash);
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
    return () => window.removeEventListener('message', onMessage);
  }, [markPreviewReady, pushEntry]);

  // Build static HTML document when detection.type === 'static'
  useEffect(() => {
    if (isStaleProjectSnapshot || engine === 'cloud' || detection.type !== 'static') {
      setStaticBlobUrl(null);
      return;
    }
    setStatus('building');
    const html = buildStaticHtmlDocument(cleanWorkspaceFiles, currentHash, detection.entry);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setStaticBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [cleanWorkspaceFiles, currentHash, detection.entry, detection.type, engine, isStaleProjectSnapshot, reloadNonce, setStaticBlobUrl, setStatus]);

  const sandpackBundle = useMemo(() => {
    if (isStaleProjectSnapshot || engine === 'cloud') return null;
    if (detection.type === 'react' || detection.type === 'next-lite') {
      return buildSandpackBundle(detection.type, cleanWorkspaceFiles);
    }
    return null;
  }, [cleanWorkspaceFiles, detection.type, engine, isStaleProjectSnapshot]);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const isWebIframeMode =
    engine === 'instant' &&
    (detection.type === 'static' || detection.type === 'react' || detection.type === 'next-lite');
  const isWaitingForFreshFrame =
    isWebIframeMode && Boolean(currentHash) && confirmedFilesHash !== currentHash && errorCount === 0;

  // C6: 30s slow-bundler watchdog banner
  useEffect(() => {
    setSlowBundlerWarning(false);
    if (!isWaitingForFreshFrame) return;
    const t = setTimeout(() => setSlowBundlerWarning(true), 30_000);
    return () => clearTimeout(t);
  }, [currentHash, isWaitingForFreshFrame, reloadNonce]);

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

  const frameWidthClass =
    deviceFrame === 'phone'
      ? 'w-[390px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
      : deviceFrame === 'tablet'
        ? 'w-[820px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
        : 'w-full';

  const externalHref =
    engine === 'cloud' ? devServerUrl : detection.type === 'static' ? staticBlobUrl : null;

  const statusText =
    engine === 'cloud'
      ? devServerStatus === 'installing'
        ? 'Installing…'
        : devServerStatus === 'starting'
          ? `Starting :${devServerPort}…`
          : devServerStatus === 'running'
            ? `Cloud :${devServerPort}`
            : devServerStatus === 'crashed'
              ? 'Server crashed'
              : 'Cloud idle'
      : errorCount > 0
        ? `Error (${errorCount})`
        : isWaitingForFreshFrame || status === 'building'
          ? 'Updating…'
          : status === 'ready'
            ? 'Ready'
            : 'Preview';

  return (
    <div className="relative h-full flex flex-col bg-kalpa-bg">
      <div className="h-11 px-2.5 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconButton label="Reload preview" size="sm" onClick={reloadPreview}>
            <RotateCw className="w-3.5 h-3.5" />
          </IconButton>
          {engine === 'cloud' && currentProject ? (
            <IconButton label="Restart Cloud dev server" size="sm" onClick={() => runDevServer(currentProject.id)}>
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

          {engine === 'instant' ? (
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
            <IconButton
              label="Open in new tab hint"
              size="sm"
              onClick={() =>
                addToast({
                  title: 'In-memory bundler preview',
                  description: 'Switch to Cloud Sandbox or export ZIP to get a standalone public URL.',
                  kind: 'info',
                })
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {slowBundlerWarning ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/35 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">Preview bundler is taking longer than usual on this network.</span>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={reloadPreview} className="underline font-semibold cursor-pointer">
              Reload
            </button>
            <button type="button" onClick={handleQuickSwitchToCloud} className="underline font-semibold cursor-pointer">
              Cloud Sandbox
            </button>
          </div>
        </div>
      ) : null}

      {engine === 'instant' && sandpackBundle?.hasTailwindV4Warning ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/30 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">Tailwind v4 (@import &quot;tailwindcss&quot;) needs PostCSS or standard Tailwind classes.</span>
          <button type="button" onClick={handleQuickSwitchToCloud} className="underline font-semibold shrink-0 cursor-pointer">
            Use Cloud Sandbox
          </button>
        </div>
      ) : null}

      {engine === 'instant' && sandpackBundle && sandpackBundle.unsupportedNextFeatures.length > 0 ? (
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
            onClick={handleQuickSwitchToCloud}
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
        ) : engine === 'cloud' && currentProject ? (
          <CloudPreviewStage projectId={currentProject.id} reloadNonce={reloadNonce} frameWidthClass={frameWidthClass} />
        ) : detection.type === 'cloud-only' ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto space-y-3">
            <Cloud className="w-8 h-8 text-kalpa-violet" />
            <p className="text-sm font-semibold text-kalpa-text">This stack runs in Cloud Sandbox</p>
            <p className="text-xs text-kalpa-muted leading-relaxed">{detection.reason}</p>
            <Button size="sm" variant="primary" leftIcon={<Cloud className="w-3.5 h-3.5" />} onClick={handleQuickSwitchToCloud}>
              Switch to Cloud Sandbox
            </Button>
          </div>
        ) : detection.type === 'static' && staticBlobUrl ? (
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
        ) : (detection.type === 'python' || detection.type === 'node-script') && currentProject ? (
          <ScriptRunnerView
            projectId={currentProject.id}
            projectType={detection.type}
            snapshot={cleanWorkspaceFiles}
            activeFilePath={activeFilePath}
            entryFile={detection.entry}
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

        {engine === 'instant' && consoleOpen ? <PreviewConsoleDrawer /> : null}
      </div>

      <PreviewDebugSheet
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        projectId={currentProject?.id ?? null}
        projectName={currentProject?.name ?? null}
        engine={engine}
        detection={detection}
        workspaceFileCount={workspaceFileCount}
        sandpackFileCount={sandpackBundle ? Object.keys(sandpackBundle.files).length : 0}
        status={status}
        expectedFilesHash={expectedFilesHash}
        confirmedFilesHash={confirmedFilesHash}
        entries={entries}
      />
    </div>
  );
}
