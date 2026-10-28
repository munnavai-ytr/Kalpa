'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, MessageSquarePlus, Trash2 } from 'lucide-react';
import { VirtualShellBackend } from '@/lib/runtime/shell';
import { PtyTerminalBackend } from '@/lib/sandbox/ptyBackend';
import type { TerminalBackend } from '@/stores/terminal';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useTerminalStore } from '@/stores/terminal';
import { useChatStore } from '@/stores/chat';
import { useAgentStore } from '@/stores/agent';
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
  const engine = useSandboxStore((s) => s.engine);
  const cloudSession = useSandboxStore((s) => s.session);

  const themeChoice = useUiStore((s) => s.theme);
  const terminalCollapsed = useUiStore((s) => s.terminalCollapsed);
  const setTerminalCollapsed = useUiStore((s) => s.setTerminalCollapsed);
  const setTabletTerminalOpen = useUiStore((s) => s.setTabletTerminalOpen);
  const activeIdeTab = useUiStore((s) => s.activeIdeTab);
  const setActiveIdeTab = useUiStore((s) => s.setActiveIdeTab);

  const setActiveBackend = useTerminalStore((s) => s.setActiveBackend);
  const sendTerminalInput = useTerminalStore((s) => s.sendTerminalInput);
  const subscribeLines = useTerminalStore((s) => s.subscribeLines);

  const sendUserMessage = useChatStore((s) => s.sendUserMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const isAgentRunning = useAgentStore((s) => s.isRunning);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const backendRef = useRef<TerminalBackend | null>(null);
  const [xtermReady, setXtermReady] = useState(false);
  const [lastTerminalError, setLastTerminalError] = useState<string | null>(null);

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
      setXtermReady(true);

      const safeFit = () => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 20 && rect.height > 20) {
          try {
            fitAddon.fit();
            backendRef.current?.resize(term.cols, term.rows);
          } catch {
            // ignore transient zero-dimension fit errors
          }
        }
      };

      requestAnimationFrame(safeFit);
      observer = new ResizeObserver(safeFit);
      observer.observe(containerRef.current);

      term.onData((data) => {
        sendTerminalInput(data);
      });

      unsubLines = subscribeLines((text, kind) => {
        if (kind === 'stderr') {
          setLastTerminalError(text.slice(0, 1200));
          term.writeln(`\r\n\x1b[38;2;255;92;108m${text}\x1b[0m`);
        } else if (kind === 'system') {
          term.writeln(`\r\n\x1b[2m${text}\x1b[0m`);
        } else {
          term.writeln(`\r\n\x1b[2m[out] ${text}\x1b[0m`);
        }
      });
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      unsubLines?.();
      backendRef.current?.dispose();
      backendRef.current = null;
      setActiveBackend(null);
      xtermRef.current?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap between VirtualShellBackend (Instant) and PtyTerminalBackend (Cloud E2B) seamlessly
  useEffect(() => {
    const term = xtermRef.current;
    if (!xtermReady || !term) return;

    const pid = currentProject?.id ?? '';

    if (engine === 'cloud' && cloudSession) {
      backendRef.current?.dispose();
      const pty = new PtyTerminalBackend(cloudSession);
      backendRef.current = pty;
      setActiveBackend(pty);
      pty.resize(term.cols || 80, term.rows || 24);
      pty.attach({
        write: (d) => term.write(d),
        writeln: (d) => term.writeln(d),
        clear: () => term.clear(),
      });
      return;
    }

    if (backendRef.current instanceof VirtualShellBackend) {
      backendRef.current.setProjectId(pid);
      return;
    }

    backendRef.current?.dispose();
    const vShell = new VirtualShellBackend(pid);
    backendRef.current = vShell;
    setActiveBackend(vShell);
    vShell.attach({
      write: (d) => term.write(d),
      writeln: (d) => term.writeln(d),
      clear: () => term.clear(),
    });
  }, [xtermReady, engine, cloudSession, currentProject?.id, setActiveBackend]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(isLight);
    }
  }, [isLight]);

  useEffect(() => {
    if (!fitAddonRef.current || !containerRef.current) return;
    const t = setTimeout(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && rect.width > 20 && rect.height > 20) {
        try {
          fitAddonRef.current.fit();
          if (xtermRef.current) {
            backendRef.current?.resize(xtermRef.current.cols, xtermRef.current.rows);
          }
        } catch {
          // ignore
        }
      }
    }, 60);
    return () => clearTimeout(t);
  }, [activeIdeTab, terminalCollapsed, breakpoint]);

  const isCloudPty = engine === 'cloud' && Boolean(cloudSession);

  return (
    <div className="h-full flex flex-col bg-kalpa-bg">
      <div className="h-9 px-3 border-b border-kalpa-border bg-kalpa-bg-2 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 text-xs min-w-0">
          <span className="font-semibold text-kalpa-text">Terminal</span>
          <span className="text-kalpa-muted truncate">
            {isCloudPty ? '· Cloud Linux PTY' : '· Instant Shell'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {lastTerminalError && currentProject ? (
            <button
              type="button"
              onClick={() => {
                const prompt = `A command in the terminal produced an error. Please diagnose and fix it:\n\n\`\`\`\n${lastTerminalError}\n\`\`\``;
                setLastTerminalError(null);
                if (breakpoint === 'phone') setActiveIdeTab('chat');
                if (isAgentRunning) setComposerDraft(prompt);
                else void sendUserMessage(currentProject.id, prompt);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-kalpa-danger/15 text-kalpa-danger hover:bg-kalpa-danger/25 text-[11px] font-medium cursor-pointer"
            >
              <MessageSquarePlus className="w-3 h-3" />
              Ask AI to fix
            </button>
          ) : null}

          <IconButton
            label="Clear terminal"
            size="sm"
            onClick={() => {
              setLastTerminalError(null);
              xtermRef.current?.clear();
            }}
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
