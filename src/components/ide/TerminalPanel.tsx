'use client';

import React, { useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { VirtualShellBackend } from '@/lib/runtime/shell';
import { useProjectStore } from '@/stores/project';
import { useTerminalStore } from '@/stores/terminal';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { IconButton } from '@/components/ui/IconButton';
import { KeyBar } from './KeyBar';

function getXtermTheme(isLight: boolean) {
  if (isLight) {
    return {
      background: '#F7F7FB',
      foreground: '#14142B',
      cursor: '#7C5CFF',
      selectionBackground: 'rgba(124, 92, 255, 0.22)',
      black: '#14142B',
      red: '#D92D4B',
      green: '#0F8A54',
      yellow: '#B85C00',
      blue: '#5636D6',
      magenta: '#C9266B',
      cyan: '#0E7490',
      white: '#F7F7FB',
    };
  }
  return {
    background: '#08080F',
    foreground: '#F4F4FA',
    cursor: '#FFB86B',
    selectionBackground: 'rgba(124, 92, 255, 0.32)',
    black: '#08080F',
    red: '#FF5C6C',
    green: '#3DDC97',
    yellow: '#FFB86B',
    blue: '#7C5CFF',
    magenta: '#FF5F9E',
    cyan: '#5CE1E6',
    white: '#F4F4FA',
  };
}

export function TerminalPanel() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const themeChoice = useUiStore((s) => s.theme);
  const terminalCollapsed = useUiStore((s) => s.terminalCollapsed);
  const setTerminalCollapsed = useUiStore((s) => s.setTerminalCollapsed);
  const setTabletTerminalOpen = useUiStore((s) => s.setTabletTerminalOpen);
  const activeIdeTab = useUiStore((s) => s.activeIdeTab);

  const setActiveBackend = useTerminalStore((s) => s.setActiveBackend);
  const sendTerminalInput = useTerminalStore((s) => s.sendTerminalInput);
  const subscribeLines = useTerminalStore((s) => s.subscribeLines);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const shellRef = useRef<VirtualShellBackend | null>(null);

  const isLight =
    themeChoice === 'light' ||
    (themeChoice === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let unsubLines: (() => void) | null = null;

    (async () => {
      if (!containerRef.current) return;
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ]);
      if (disposed || !containerRef.current) return;

      const term = new Terminal({
        scrollback: 5000,
        cursorBlink: true,
        fontSize: 13,
        lineHeight: 1.35,
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
        theme: getXtermTheme(isLight),
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      term.open(containerRef.current);

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      const safeFit = () => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 20 && rect.height > 20) {
          try {
            fitAddon.fit();
            shellRef.current?.resize(term.cols, term.rows);
          } catch {
            // ignore transient zero-dimension fit errors
          }
        }
      };

      requestAnimationFrame(safeFit);
      observer = new ResizeObserver(safeFit);
      observer.observe(containerRef.current);

      const pid = useProjectStore.getState().currentProject?.id ?? '';
      const backend = new VirtualShellBackend(pid);
      shellRef.current = backend;
      setActiveBackend(backend);

      backend.attach({
        write: (d) => term.write(d),
        writeln: (d) => term.writeln(d),
        clear: () => term.clear(),
      });

      term.onData((data) => {
        sendTerminalInput(data);
      });

      unsubLines = subscribeLines((text, kind) => {
        const prefix =
          kind === 'stderr' ? '\x1b[38;2;255;92;108m' : '\x1b[38;2;154;155;180m';
        term.writeln(`\r\n${prefix}[run] ${text}\x1b[0m`);
      });
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      unsubLines?.();
      shellRef.current?.dispose();
      setActiveBackend(null);
      xtermRef.current?.dispose();
    };
    // Mount xterm once and keep alive across tabs/themes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update theme without remounting xterm
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(isLight);
    }
  }, [isLight]);

  // Sync current project ID into VirtualShellBackend
  useEffect(() => {
    if (currentProject && shellRef.current) {
      shellRef.current.setProjectId(currentProject.id);
    }
  }, [currentProject]);

  // Refit when panel becomes visible on phone/desktop
  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;
    const t = setTimeout(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 20 && rect.height > 20) {
        try {
          fitAddonRef.current.fit();
        } catch {
          // ignore
        }
      }
    }, 60);
    return () => clearTimeout(t);
  }, [activeIdeTab, terminalCollapsed, breakpoint]);

  return (
    <div className="h-full flex flex-col bg-kalpa-bg">
      <div className="h-9 px-3 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-kalpa-text">Terminal</span>
          <span className="text-kalpa-muted">· Instant Shell</span>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton
            label="Clear terminal"
            size="sm"
            onClick={() => xtermRef.current?.clear()}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </IconButton>

          {breakpoint === 'desktop' ? (
            <IconButton
              label={terminalCollapsed ? 'Expand terminal' : 'Collapse terminal'}
              size="sm"
              onClick={() => setTerminalCollapsed(!terminalCollapsed)}
            >
              {terminalCollapsed ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </IconButton>
          ) : breakpoint === 'tablet' ? (
            <IconButton
              label="Close terminal drawer"
              size="sm"
              onClick={() => setTabletTerminalOpen(false)}
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full p-1.5 overflow-hidden"
      />

      {breakpoint !== 'desktop' ? <KeyBar /> : null}
    </div>
  );
}
