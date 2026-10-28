'use client';

import React, { useMemo, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { runPythonInWorker, terminateActivePythonRun } from '@/lib/runtime/pyodideWorker';
import { runJsInWorker, terminateActiveJsRun } from '@/lib/runtime/jsWorker';
import { vfs } from '@/lib/vfs/vfs';
import { usePreviewStore } from '@/stores/preview';
import { useTerminalStore } from '@/stores/terminal';
import { Button } from '@/components/ui/Button';

export interface ScriptRunnerViewProps {
  projectId: string;
  projectType: 'python' | 'node-script' | 'js';
  snapshot: Record<string, string>;
  activeFilePath: string | null;
  entryFile?: string;
}

export function ScriptRunnerView({
  projectId,
  projectType,
  snapshot,
  activeFilePath,
  entryFile,
}: ScriptRunnerViewProps) {
  const setStatus = usePreviewStore((s) => s.setStatus);
  const writeTerminalLine = useTerminalStore((s) => s.writeLine);

  const scriptFiles = useMemo(() => {
    const keys = Object.keys(snapshot).filter((p) => !p.startsWith('.kalpa/'));
    if (projectType === 'python') {
      return keys.filter((p) => p.endsWith('.py'));
    }
    return keys.filter((p) => /\.(js|mjs|cjs|ts)$/.test(p));
  }, [projectType, snapshot]);

  const [runningScript, setRunningScript] = useState(false);
  const [scriptLines, setScriptLines] = useState<{ text: string; err?: boolean }[]>([]);
  const [scriptDuration, setScriptDuration] = useState<number | null>(null);

  const selectedScript =
    (activeFilePath && scriptFiles.includes(activeFilePath) ? activeFilePath : null) ??
    (entryFile && scriptFiles.includes(entryFile) ? entryFile : null) ??
    (scriptFiles.includes('main.py') ? 'main.py' : scriptFiles[0] ?? '');

  const handleRunScript = async () => {
    if (!selectedScript || runningScript) return;
    setRunningScript(true);
    setScriptLines([]);
    setScriptDuration(null);
    setStatus('building');

    const appendOut = (line: string, isErr = false) => {
      setScriptLines((prev) => [...prev, { text: line, err: isErr }]);
      writeTerminalLine(line, isErr ? 'stderr' : 'stdout');
    };

    if (projectType === 'python') {
      const res = await runPythonInWorker({
        file: selectedScript,
        files: snapshot,
        onStdout: (l) => appendOut(l, false),
        onStderr: (l) => appendOut(l, true),
        onStatus: (m) => appendOut(m, false),
      });
      setScriptDuration(res.durationMs);
      if (!res.ok && res.error) {
        appendOut(res.error, true);
        setStatus('error');
      } else {
        setStatus('ready');
        if (res.updatedFiles) {
          const diffs = Object.entries(res.updatedFiles).filter(([k, v]) => snapshot[k] !== v);
          if (diffs.length > 0) {
            await vfs.writeMany(
              projectId,
              diffs.map(([path, content]) => ({ path, content, encoding: 'utf8' }))
            );
          }
        }
      }
    } else {
      const res = await runJsInWorker({
        entryFile: selectedScript,
        files: snapshot,
        onStdout: (l) => appendOut(l, false),
        onStderr: (l) => appendOut(l, true),
      });
      setScriptDuration(res.durationMs);
      if (!res.ok && res.error) {
        appendOut(res.error, true);
        setStatus('error');
      } else {
        setStatus('ready');
      }
    }
    setRunningScript(false);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col p-4 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-kalpa-text">
            {projectType === 'python' ? 'Python WebAssembly Runner (Pyodide)' : 'JavaScript Worker Runner'}
          </p>
          <p className="text-[11px] font-mono text-kalpa-muted truncate">
            Entry: {selectedScript || '(none)'}
            {scriptDuration !== null ? ` · ${scriptDuration} ms` : ''}
          </p>
        </div>
        {runningScript ? (
          <Button
            size="sm"
            variant="danger"
            leftIcon={<Square className="w-3.5 h-3.5 fill-current" />}
            onClick={() => {
              terminateActivePythonRun();
              terminateActiveJsRun();
            }}
          >
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            leftIcon={<Play className="w-3.5 h-3.5 fill-current" />}
            onClick={handleRunScript}
          >
            Run {selectedScript}
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 rounded-[12px] bg-kalpa-bg-2 border border-kalpa-border p-3.5 overflow-y-auto font-mono text-xs space-y-1">
        {scriptLines.length === 0 ? (
          <p className="text-kalpa-muted">
            Click Run to execute <span className="text-kalpa-text">{selectedScript}</span>. Output also streams to the Terminal.
          </p>
        ) : (
          scriptLines.map((line, i) => (
            <div
              key={i}
              className={
                line.err
                  ? 'text-kalpa-danger whitespace-pre-wrap'
                  : 'text-kalpa-text whitespace-pre-wrap'
              }
            >
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
