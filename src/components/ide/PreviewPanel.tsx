'use client';

import React, { useEffect, useMemo } from 'react';
import {
  AlertCircle,
  Cloud,
  ExternalLink,
  Laptop,
  Play,
  RotateCw,
  Smartphone,
  Tablet,
  TerminalSquare,
} from 'lucide-react';
import { detectProjectType } from '@/lib/preview/detect';
import { buildStaticHtmlDocument } from '@/lib/preview/staticHtml';
import { buildSandpackBundle } from '@/lib/preview/sandpackFiles';
import { useProviderStore } from '@/lib/providers/store';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { IconButton } from '@/components/ui/IconButton';
import { SandpackStage } from './SandpackStage';
import { ScriptRunnerView } from './ScriptRunnerView';
import { PreviewConsoleDrawer } from './PreviewConsoleDrawer';
import { CloudPreviewStage } from './CloudPreviewStage';

export function PreviewPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const snapshot = useProjectStore((s) => s.snapshot);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const e2bApiKey = useProviderStore((s) => s.e2bApiKey);

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
  const setStatus = usePreviewStore((s) => s.setStatus);
  const setDeviceFrame = usePreviewStore((s) => s.setDeviceFrame);
  const setConsoleOpen = usePreviewStore((s) => s.setConsoleOpen);
  const reloadPreview = usePreviewStore((s) => s.reloadPreview);
  const pushEntry = usePreviewStore((s) => s.pushEntry);
  const setStaticBlobUrl = usePreviewStore((s) => s.setStaticBlobUrl);
  const addToast = useUiStore((s) => s.addToast);

  const projectType = useMemo(() => detectProjectType(snapshot), [snapshot]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (!data || data.source !== 'kalpa-static-preview') return;
      pushEntry({
        level: data.level || 'log',
        message: String(data.message ?? ''),
        file: data.file,
        line: data.line,
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushEntry]);

  useEffect(() => {
    if (engine === 'cloud' || projectType !== 'static') {
      setStaticBlobUrl(null);
      return;
    }
    setStatus('building');
    const html = buildStaticHtmlDocument(snapshot);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    setStaticBlobUrl(url);
    setStatus('ready');
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [engine, projectType, snapshot, reloadNonce, setStaticBlobUrl, setStatus]);

  const sandpackBundle = useMemo(() => {
    if (engine === 'cloud') return null;
    if (
      projectType === 'next' ||
      projectType === 'react' ||
      projectType === 'vue' ||
      projectType === 'svelte' ||
      projectType === 'solid' ||
      projectType === 'angular'
    ) {
      return buildSandpackBundle(projectType, snapshot);
    }
    return null;
  }, [engine, projectType, snapshot]);

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

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const frameWidthClass =
    deviceFrame === 'phone'
      ? 'w-[390px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
      : deviceFrame === 'tablet'
        ? 'w-[820px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
        : 'w-full';

  const externalHref =
    engine === 'cloud'
      ? devServerUrl
      : projectType === 'static'
        ? staticBlobUrl
        : null;

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
      : status === 'building'
        ? 'Building…'
        : errorCount > 0
          ? `Error (${errorCount})`
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
            <IconButton
              label="Restart Cloud dev server"
              size="sm"
              onClick={() => runDevServer(currentProject.id)}
            >
              <Play className="w-3.5 h-3.5 text-kalpa-success" />
            </IconButton>
          ) : null}

          <span className="text-xs font-medium text-kalpa-muted truncate">{statusText}</span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {breakpoint === 'desktop' ? (
            <>
              <IconButton
                label="Phone frame (390px)"
                size="sm"
                active={deviceFrame === 'phone'}
                onClick={() => setDeviceFrame('phone')}
              >
                <Smartphone className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                label="Tablet frame (820px)"
                size="sm"
                active={deviceFrame === 'tablet'}
                onClick={() => setDeviceFrame('tablet')}
              >
                <Tablet className="w-3.5 h-3.5" />
              </IconButton>
              <IconButton
                label="Fit desktop width"
                size="sm"
                active={deviceFrame === 'desktop'}
                onClick={() => setDeviceFrame('desktop')}
              >
                <Laptop className="w-3.5 h-3.5" />
              </IconButton>
            </>
          ) : null}

          {engine === 'instant' ? (
            <IconButton
              label="Toggle preview console"
              size="sm"
              active={consoleOpen}
              onClick={() => setConsoleOpen(!consoleOpen)}
            >
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
                  description:
                    'Switch to Cloud Sandbox or export ZIP to get a standalone public URL.',
                  kind: 'info',
                })
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {engine === 'instant' && sandpackBundle?.hasTailwindV4Warning ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/30 text-[11px] text-kalpa-warn flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">
            Tailwind v4 (@import &quot;tailwindcss&quot;) needs PostCSS or standard Tailwind classes.
          </span>
          <button
            type="button"
            onClick={handleQuickSwitchToCloud}
            className="underline font-semibold shrink-0 cursor-pointer"
          >
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
              {sandpackBundle.unsupportedNextFeatures
                .map((u) => `${u.file} (${u.reason})`)
                .join(', ')}
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
        {engine === 'cloud' && currentProject ? (
          <CloudPreviewStage
            projectId={currentProject.id}
            reloadNonce={reloadNonce}
            frameWidthClass={frameWidthClass}
          />
        ) : projectType === 'static' && staticBlobUrl ? (
          <div className={`flex-1 min-h-0 bg-white ${frameWidthClass}`}>
            <iframe
              key={`static-${currentProject?.id ?? 'none'}-${reloadNonce}`}
              src={staticBlobUrl}
              title="Static application preview"
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="w-full h-full border-0"
            />
          </div>
        ) : sandpackBundle && currentProject ? (
          <div className={`flex-1 min-h-0 ${frameWidthClass}`}>
            <SandpackStage
              projectId={currentProject.id}
              reloadNonce={reloadNonce}
              bundle={sandpackBundle}
            />
          </div>
        ) : (projectType === 'python' || projectType === 'js') && currentProject ? (
          <ScriptRunnerView
            projectId={currentProject.id}
            projectType={projectType}
            snapshot={snapshot}
            activeFilePath={activeFilePath}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-kalpa-muted space-y-2">
            <p className="text-sm font-medium text-kalpa-text">No runnable web or script entry yet</p>
            <p className="text-xs max-w-sm leading-relaxed">
              Ask Kalpa in Chat to build an app or script — Preview supports static HTML, React/Vue/Svelte, Next.js, Python, JS, and full Linux servers in Cloud Sandbox.
            </p>
          </div>
        )}

        {engine === 'instant' && consoleOpen ? <PreviewConsoleDrawer /> : null}
      </div>
    </div>
  );
}
