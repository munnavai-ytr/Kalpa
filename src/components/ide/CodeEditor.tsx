'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { search, searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { markdown } from '@codemirror/lang-markdown';
import { FileCode2, Lock } from 'lucide-react';
import { vfs } from '@/lib/vfs/vfs';
import {
  isBinaryPath,
  isImagePath,
  languageFromPath,
  mimeFromPath,
} from '@/lib/vfs/paths';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { formatBytes } from '@/lib/utils';

export function CodeEditor() {
  const { breakpoint } = useBreakpoint();
  const currentProject = useProjectStore((s) => s.currentProject);
  const activeFilePath = useProjectStore((s) => s.activeFilePath);
  const snapshot = useProjectStore((s) => s.snapshot);
  const dirtyBuffers = useProjectStore((s) => s.dirtyBuffers);
  const targetLine = useProjectStore((s) => s.targetLine);
  const setDirtyBuffer = useProjectStore((s) => s.setDirtyBuffer);
  const flushBufferToVfs = useProjectStore((s) => s.flushBufferToVfs);
  const files = useProjectStore((s) => s.files);

  const themeChoice = useUiStore((s) => s.theme);
  const editorFontSize = useUiStore((s) => s.editorFontSize);
  const editorWordWrap = useUiStore((s) => s.editorWordWrap);

  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadedBinary, setLoadedBinary] = useState<{
    path: string;
    content: string;
    size: number;
  } | null>(null);

  const isLight =
    themeChoice === 'light' ||
    (themeChoice === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches);

  const effectiveFontSize = breakpoint === 'phone' ? Math.max(16, editorFontSize) : editorFontSize;

  const isBin = activeFilePath ? isBinaryPath(activeFilePath) : false;
  const isImg = activeFilePath ? isImagePath(activeFilePath) : false;
  const binaryData =
    isBin && activeFilePath && loadedBinary?.path === activeFilePath ? loadedBinary : null;

  useEffect(() => {
    if (!currentProject || !activeFilePath || !isBin) return;
    let cancelled = false;
    vfs.read(currentProject.id, activeFilePath).then((res) => {
      if (cancelled || !res) return;
      const meta = files.find((f) => f.path === activeFilePath);
      setLoadedBinary({ path: activeFilePath, content: res.content, size: meta?.size ?? 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [currentProject, activeFilePath, isBin, files]);

  // Jump to requested line when openFile(path, { line }) is called
  useEffect(() => {
    if (!targetLine || targetLine.path !== activeFilePath) return;
    const view = cmRef.current?.view;
    if (!view) return;
    const lineCount = view.state.doc.lines;
    const clampedLine = Math.max(1, Math.min(lineCount, targetLine.line));
    const lineInfo = view.state.doc.line(clampedLine);
    view.dispatch({
      selection: { anchor: lineInfo.from },
      effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
    });
  }, [targetLine, activeFilePath]);

  const extensions = useMemo(() => {
    const list = [
      search({ top: true }),
      keymap.of([
        ...searchKeymap,
        {
          key: 'Mod-s',
          run: () => {
            const path = useProjectStore.getState().activeFilePath;
            if (path) {
              void useProjectStore.getState().flushBufferToVfs(path);
            }
            return true;
          },
        },
      ]),
      EditorView.theme(
        {
          '&': {
            height: '100%',
            fontSize: `${effectiveFontSize}px`,
            backgroundColor: 'var(--bg) !important',
            color: 'var(--text)',
          },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.6',
          },
          '.cm-gutters': {
            backgroundColor: 'var(--bg-2) !important',
            color: 'var(--muted)',
            borderRight: '1px solid var(--border)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'var(--surface) !important',
            color: 'var(--text)',
          },
          '.cm-activeLine': {
            backgroundColor: 'var(--surface) !important',
          },
          '.cm-selectionBackground, ::selection': {
            backgroundColor: 'rgba(124, 92, 255, 0.28) !important',
          },
          '.cm-cursor': {
            borderLeftColor: 'var(--violet) !important',
          },
          '.cm-panels': {
            backgroundColor: 'var(--bg-2)',
            color: 'var(--text)',
            borderBottom: '1px solid var(--border)',
          },
        },
        { dark: !isLight }
      ),
    ];

    if (editorWordWrap) {
      list.push(EditorView.lineWrapping);
    }

    if (activeFilePath) {
      const lang = languageFromPath(activeFilePath);
      if (lang === 'typescript' || lang === 'tsx') {
        list.push(javascript({ typescript: true, jsx: lang === 'tsx' }));
      } else if (lang === 'javascript' || lang === 'jsx') {
        list.push(javascript({ jsx: lang === 'jsx' }));
      } else if (lang === 'html') {
        list.push(html());
      } else if (lang === 'css') {
        list.push(css());
      } else if (lang === 'json') {
        list.push(json());
      } else if (lang === 'python') {
        list.push(python());
      } else if (lang === 'markdown') {
        list.push(markdown());
      }
    }

    return list;
  }, [activeFilePath, editorWordWrap, effectiveFontSize, isLight]);

  const handleChange = (val: string) => {
    if (!activeFilePath) return;
    setDirtyBuffer(activeFilePath, val);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const pathSnapshot = activeFilePath;
    saveTimerRef.current = setTimeout(() => {
      flushBufferToVfs(pathSnapshot, val);
    }, 600);
  };

  if (!activeFilePath) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center text-kalpa-muted gap-2">
        <FileCode2 className="w-8 h-8 text-kalpa-border" />
        <p className="text-sm font-medium text-kalpa-text">No file open</p>
        <p className="text-xs max-w-xs">
          Select a file from the File Tree or create a new file to begin editing.
        </p>
      </div>
    );
  }

  if (isBin || (isImg && !activeFilePath.endsWith('.svg'))) {
    const mime = mimeFromPath(activeFilePath);
    return (
      <div className="h-full flex flex-col bg-kalpa-bg">
        <div className="px-4 py-2 border-b border-kalpa-border bg-kalpa-surface flex items-center gap-2 text-xs text-kalpa-muted">
          <Lock className="w-3.5 h-3.5" />
          <span>Binary file (read-only)</span>
          {binaryData ? (
            <>
              <span>·</span>
              <span className="font-mono tabular-nums">{formatBytes(binaryData.size)}</span>
            </>
          ) : null}
        </div>
        <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
          {isImg && binaryData ? (
            <img
              src={`data:${mime};base64,${binaryData.content}`}
              alt={activeFilePath}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-full object-contain rounded-[12px] border border-kalpa-border"
            />
          ) : (
            <p className="text-xs font-mono text-kalpa-muted">
              {activeFilePath} ({binaryData ? formatBytes(binaryData.size) : 'binary'})
            </p>
          )}
        </div>
      </div>
    );
  }

  const currentDoc = dirtyBuffers[activeFilePath] ?? snapshot[activeFilePath] ?? '';

  return (
    <div className="h-full w-full overflow-hidden bg-kalpa-bg">
      <CodeMirror
        ref={cmRef}
        value={currentDoc}
        theme={isLight ? 'light' : 'dark'}
        height="100%"
        className="h-full"
        basicSetup={{
          lineNumbers: true,
          bracketMatching: true,
          foldGutter: true,
          indentOnInput: true,
          highlightActiveLine: true,
          searchKeymap: false,
        }}
        extensions={extensions}
        onChange={handleChange}
      />
    </div>
  );
}
