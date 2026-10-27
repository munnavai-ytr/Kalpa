'use client';

import React, { useEffect, useMemo } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Laptop,
  RotateCw,
  Smartphone,
  Tablet,
  TerminalSquare,
} from 'lucide-react';
import { detectProjectType } from '@/lib/preview/detect';
import { buildStaticHtmlDocument } from '@/lib/preview/staticHtml';
import { buildSandpackBundle } from '@/lib/preview/sandpackFiles';
import { usePreviewStore } from '@/stores/preview';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { IconButton } from '@/components/ui/IconButton';
import { SandpackStage } from './SandpackStage';
import { ScriptRunnerView } from './ScriptRunnerView';
import { PreviewConsoleDrawer } from './PreviewConsoleDrawer';

export function PreviewPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const snapshot = useProjectStore((s) => s.snapshot);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);

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
    if (projectType !== 'static') {
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
  }, [projectType, snapshot, reloadNonce, setStaticBlobUrl, setStatus]);

  const sandpackBundle = useMemo(() => {
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
  }, [projectType, snapshot]);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const frameWidthClass =
    deviceFrame === 'phone'
      ? 'w-[390px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
      : deviceFrame === 'tablet'
        ? 'w-[820px] max-w-full mx-auto border-x border-kalpa-border shadow-kalpa-soft'
        : 'w-full';

  return (
    <div className="relative h-full flex flex-col bg-kalpa-bg">
      <div className="h-11 px-2.5 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconButton label="Reload preview" size="sm" onClick={reloadPreview}>
            <RotateCw className="w-3.5 h-3.5" />
          </IconButton>

          <span className="text-xs font-medium text-kalpa-muted truncate">
            {status === 'building'
              ? 'Building…'
              : errorCount > 0
                ? `Error (${errorCount})`
                : status === 'ready'
                  ? 'Ready'
                  : 'Preview'}
          </span>
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

          <IconButton
            label="Toggle preview console"
            size="sm"
            active={consoleOpen}
            onClick={() => setConsoleOpen(!consoleOpen)}
          >
            <TerminalSquare className="w-3.5 h-3.5" />
          </IconButton>

          {projectType === 'static' && staticBlobUrl ? (
            <a
              href={staticBlobUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open static preview in new tab"
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
                    'Sandpack compiles files in browser memory. Export ZIP or use static HTML to open standalone tabs.',
                  kind: 'info',
                })
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </IconButton>
          )}
        </div>
      </div>

      {sandpackBundle?.hasTailwindV4Warning ? (
        <div className="px-3 py-1.5 bg-kalpa-warn/15 border-b border-kalpa-warn/30 text-[11px] text-kalpa-warn shrink-0">
          Tailwind v4 (@import &quot;tailwindcss&quot; / @theme) is not supported in Instant preview — use standard utility classes or Cloud Sandbox (Prompt 2).
        </div>
      ) : null}

      {sandpackBundle && sandpackBundle.unsupportedNextFeatures.length > 0 ? (
        <div className="px-3 py-1.5 bg-kalpa-violet/15 border-b border-kalpa-violet/35 text-[11px] text-kalpa-text flex items-center gap-1.5 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-kalpa-gold shrink-0" />
          <span className="truncate">
            Needs Cloud Sandbox (Prompt 2):{' '}
            {sandpackBundle.unsupportedNextFeatures
              .map((u) => `${u.file} (${u.reason})`)
              .join(', ')}
          </span>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-hidden bg-kalpa-bg flex flex-col">
        {projectType === 'static' && staticBlobUrl ? (
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
              Instant Preview supports <code className="font-mono">index.html</code>, React/Vue/Svelte apps, Next.js App Router (<code className="font-mono">app/page.tsx</code>), Python (<code className="font-mono">.py</code>), and JS scripts.
            </p>
          </div>
        )}

        {consoleOpen ? <PreviewConsoleDrawer /> : null}
      </div>

      {breakpoint === 'phone' && (projectType === 'static' || sandpackBundle) ? (
        <div className="absolute right-3 bottom-3 z-20 flex items-center gap-2">
          <button
            type="button"
            aria-label="Reload preview"
            onClick={reloadPreview}
            className="min-h-[44px] min-w-[44px] rounded-full kalpa-glass shadow-kalpa-soft flex items-center justify-center text-kalpa-text cursor-pointer"
          >
            <RotateCw className="w-4 h-4" />
          </button>
          {projectType === 'static' && staticBlobUrl ? (
            <a
              href={staticBlobUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open preview in new tab"
              className="min-h-[44px] min-w-[44px] rounded-full kalpa-glass shadow-kalpa-soft flex items-center justify-center text-kalpa-text"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          ) : (
            <button
              type="button"
              aria-label="Open in new tab info"
              onClick={() =>
                addToast({
                  title: 'Sandpack runs in memory',
                  description: 'Static HTML projects open directly in a new tab via Blob URL.',
                  kind: 'info',
                })
              }
              className="min-h-[44px] min-w-[44px] rounded-full kalpa-glass shadow-kalpa-soft flex items-center justify-center text-kalpa-text cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
