import {
  applyMemoryAction,
  markMilestoneCompleted,
} from '@/lib/brain/files';
import { runVirtualShellProgrammatic } from '@/lib/runtime/programmaticShell';
import { prepareShellMarker, syncSandboxChangesBackToVfs } from '@/lib/sandbox/sync';
import { MAX_PROJECT_FILES, MAX_TEXT_FILE_BYTES } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import {
  useAgentStore,
  type AgentStepId,
  type ExecutableAction,
  type LiveStreamItem,
} from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { useTerminalStore } from '@/stores/terminal';
import { applyEdits } from './actions';
import type { AgentMode } from './prompts/system';
import {
  formatAppNoticeResult,
  formatEditResult,
  formatFileResult,
  formatMemoryResult,
  formatPathOpResult,
  formatShellResult,
} from './results';
import {
  runImpactTool,
  runListTool,
  runReadTool,
  runSearchTool,
  validateAgentPath,
} from './tools';

const MAX_FILE_OPS_PER_ITERATION = 40;
const VALID_STEPS = new Set(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);

export interface ExecuteActionsContext {
  projectId: string;
  mode: AgentMode;
  signal: AbortSignal;
  touchedPathsInTurn: Set<string>;
  openedFirstCodeFile: boolean;
  scheduleLiveFlush: () => void;
}

export interface ExecuteActionsResult {
  iterResults: string[];
  modifiedCode: boolean;
  ranShell: boolean;
  openedFirstCodeFile: boolean;
  completedMilestone: string | null;
  nextMilestone: string | null;
  sawFinished: boolean;
}

export async function executeIterationActions(
  iterActions: { item: Extract<LiveStreamItem, { kind: 'action' }>; action: ExecutableAction }[],
  ctx: ExecuteActionsContext
): Promise<ExecuteActionsResult> {
  const { projectId, mode, signal, touchedPathsInTurn, scheduleLiveFlush } = ctx;
  const iterResults: string[] = [];
  let fileOpsCount = 0;
  let ignoreRemaining = false;
  let modifiedCode = false;
  let ranShell = false;
  let openedFirst = ctx.openedFirstCodeFile;
  let completedMilestone: string | null = null;
  let nextMilestone: string | null = null;
  let sawFinished = false;

  for (const { item, action } of iterActions) {
    if (signal.aborted || ignoreRemaining) break;

    if (action.type === 'status') {
      const nextStep = action.step && VALID_STEPS.has(action.step) ? (action.step as AgentStepId) : undefined;
      useAgentStore.getState().updateTurnStatus({
        ...(nextStep ? { step: nextStep } : {}),
        ...(action.text ? { statusLabel: action.text } : {}),
      });
      item.outcome = { ok: true, summary: action.text };
      continue;
    }

    if (action.type === 'file') {
      if (mode === 'PLAN') {
        const msg = 'Plan mode (/plan) only updates Brain memory; source code writes are skipped.';
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatFileResult(action.path, 'rejected', msg));
        continue;
      }
      if (++fileOpsCount > MAX_FILE_OPS_PER_ITERATION) {
        const msg = `Exceeded ${MAX_FILE_OPS_PER_ITERATION} file operations in a single iteration.`;
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatFileResult(action.path, 'rejected', msg));
        continue;
      }
      const check = validateAgentPath(action.path);
      if (!check.ok) {
        item.outcome = { ok: false, summary: check.reason };
        iterResults.push(formatFileResult(action.path, 'rejected', check.reason));
        continue;
      }
      const byteLen = new TextEncoder().encode(action.content).byteLength;
      if (byteLen > MAX_TEXT_FILE_BYTES) {
        const msg = `File exceeds 2 MB limit (${byteLen} bytes).`;
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatFileResult(check.path, 'rejected', msg));
        continue;
      }
      const [currentList, prevRec] = await Promise.all([
        vfs.list(projectId),
        vfs.read(projectId, check.path),
      ]);
      if (!prevRec && currentList.length >= MAX_PROJECT_FILES) {
        const msg = `Project reached maximum ${MAX_PROJECT_FILES} files.`;
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatFileResult(check.path, 'rejected', msg));
        continue;
      }
      await vfs.write(projectId, check.path, action.content, 'utf8');
      touchedPathsInTurn.add(check.path);
      modifiedCode = true;
      ranShell = false;
      if (!openedFirst) {
        openedFirst = true;
        useProjectStore.getState().openFile(check.path);
      }
      item.outcome = {
        ok: true,
        summary: `${prevRec ? 'Replaced' : 'Created'} (${action.content.split('\n').length} lines)`,
        beforeContent: prevRec?.content ?? '',
        afterContent: action.content,
      };
      iterResults.push(formatFileResult(check.path, 'ok'));
    } else if (action.type === 'edit') {
      if (mode === 'PLAN') {
        const msg = 'Plan mode (/plan) only updates Brain memory; source code edits are skipped.';
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatEditResult(action.path, 'error', msg));
        continue;
      }
      if (++fileOpsCount > MAX_FILE_OPS_PER_ITERATION) {
        const msg = `Exceeded ${MAX_FILE_OPS_PER_ITERATION} file operations in a single iteration.`;
        item.outcome = { ok: false, summary: msg };
        iterResults.push(formatEditResult(action.path, 'error', msg));
        continue;
      }
      const check = validateAgentPath(action.path);
      if (!check.ok) {
        item.outcome = { ok: false, summary: check.reason };
        iterResults.push(formatEditResult(action.path, 'error', check.reason));
        continue;
      }
      const existing = await vfs.read(projectId, check.path);
      if (!existing) {
        const msg = `File "${check.path}" does not exist. Use <file path="${check.path}"> to create it or <list /> to check paths.`;
        item.outcome = { ok: false, summary: 'File not found' };
        iterResults.push(formatEditResult(check.path, 'error', msg));
        continue;
      }
      const res = applyEdits(existing.content, action.edits);
      if (!res.ok) {
        item.outcome = { ok: false, summary: res.error };
        iterResults.push(formatEditResult(check.path, 'error', res.error));
        continue;
      }
      await vfs.write(projectId, check.path, res.content, 'utf8');
      touchedPathsInTurn.add(check.path);
      modifiedCode = true;
      ranShell = false;
      if (!openedFirst) {
        openedFirst = true;
        useProjectStore.getState().openFile(check.path);
      }
      item.outcome = {
        ok: true,
        summary: `Applied ${action.edits.length} change${action.edits.length === 1 ? '' : 's'}`,
        beforeContent: existing.content,
        afterContent: res.content,
      };
      iterResults.push(formatEditResult(check.path, 'ok'));
    } else if (action.type === 'delete') {
      const check = validateAgentPath(action.path);
      if (!check.ok) {
        item.outcome = { ok: false, summary: check.reason };
        iterResults.push(formatPathOpResult('delete', action.path, 'rejected', check.reason));
        continue;
      }
      await vfs.remove(projectId, check.path);
      modifiedCode = true;
      item.outcome = { ok: true, summary: `Deleted ${check.path}` };
      iterResults.push(formatPathOpResult('delete', check.path, 'ok'));
    } else if (action.type === 'move') {
      const cFrom = validateAgentPath(action.from);
      const cTo = validateAgentPath(action.to);
      if (!cFrom.ok || !cTo.ok) {
        const reason = !cFrom.ok ? cFrom.reason : (!cTo.ok ? cTo.reason : 'Invalid path');
        item.outcome = { ok: false, summary: reason };
        iterResults.push(formatPathOpResult('move', `${action.from} -> ${action.to}`, 'rejected', reason));
        continue;
      }
      await vfs.move(projectId, cFrom.path, cTo.path);
      touchedPathsInTurn.add(cTo.path);
      modifiedCode = true;
      item.outcome = { ok: true, summary: `${cFrom.path} -> ${cTo.path}` };
      iterResults.push(formatPathOpResult('move', `${cFrom.path} -> ${cTo.path}`, 'ok'));
    } else if (action.type === 'memory') {
      const memRes = await applyMemoryAction(projectId, action.file, action.op, action.content);
      if (!memRes.ok) {
        item.outcome = { ok: false, summary: memRes.error };
        iterResults.push(formatMemoryResult(action.file, 'error', memRes.error));
      } else {
        await useBrainStore.getState().refreshBrainFromVfs(projectId);
        item.outcome = { ok: true, summary: `Updated ${memRes.file}.md (${action.op})` };
        iterResults.push(formatMemoryResult(memRes.file, 'ok'));
      }
    } else if (action.type === 'read') {
      const xml = await runReadTool(projectId, action.path, action.lines);
      item.outcome = { ok: !xml.includes('Error:'), detail: xml };
      iterResults.push(xml);
    } else if (action.type === 'search') {
      const xml = await runSearchTool(projectId, action.query);
      item.outcome = { ok: true, detail: xml };
      iterResults.push(xml);
    } else if (action.type === 'list') {
      const xml = await runListTool(projectId, action.path, action.depth);
      item.outcome = { ok: true, detail: xml };
      iterResults.push(xml);
    } else if (action.type === 'impact') {
      const xml = await runImpactTool(projectId, { target: action.target, symbol: action.symbol });
      item.outcome = { ok: true, detail: xml };
      iterResults.push(xml);
    } else if (action.type === 'shell') {
      const tShell = performance.now();
      useTerminalStore.getState().writeLine(`$ ${action.cmd}`, 'system');
      const sb = useSandboxStore.getState();

      if (sb.engine === 'cloud' && sb.session) {
        await prepareShellMarker(sb.session);
        const execRes = await sb.session.exec(action.cmd, {
          cwd: action.cwd,
          timeoutMs: (action.timeout ?? 120) * 1000,
          onStdout: (s) => useTerminalStore.getState().writeLine(s.trimEnd(), 'info'),
          onStderr: (s) => useTerminalStore.getState().writeLine(s.trimEnd(), 'stderr'),
        });
        const syncBack = await syncSandboxChangesBackToVfs(projectId, sb.session);
        syncBack.syncedPaths.forEach((p) => touchedPathsInTurn.add(p));
        const ms = performance.now() - tShell;
        const combined = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n');
        ranShell = true;
        item.outcome = {
          ok: execRes.exitCode === 0,
          exitCode: execRes.exitCode,
          durationMs: Math.round(ms),
          output: combined,
        };
        iterResults.push(formatShellResult(execRes.exitCode, ms, combined));
        if (syncBack.warning) iterResults.push(formatAppNoticeResult(syncBack.warning));
      } else {
        const vRes = await runVirtualShellProgrammatic(projectId, action.cmd, (line, isErr) => {
          useTerminalStore.getState().writeLine(line, isErr ? 'stderr' : 'info');
        });
        const ms = performance.now() - tShell;
        const combined = [vRes.stdout, vRes.stderr].filter(Boolean).join('\n');
        ranShell = true;
        item.outcome = {
          ok: vRes.exitCode === 0,
          exitCode: vRes.exitCode,
          durationMs: Math.round(ms),
          output: combined,
        };
        iterResults.push(formatShellResult(vRes.exitCode, ms, combined));
      }
    } else if (action.type === 'question') {
      scheduleLiveFlush();
      const answer = await useAgentStore
        .getState()
        .askUserQuestion({ question: action.text, options: action.options }, signal);
      item.outcome = { ok: true, summary: `Answered: ${answer}` };
      iterResults.push(`<result type="question" answer="${answer.replace(/"/g, '&quot;')}">${answer}</result>`);
    } else if (action.type === 'complete') {
      if ((mode === 'NEW_PROJECT' || mode === 'CONTINUE') && !modifiedCode && touchedPathsInTurn.size === 0) {
        item.outcome = { ok: false, summary: 'Skipped: 0 source files written yet' };
        continue;
      }
      const mId = action.milestone || 'milestone';
      if (action.milestone) await markMilestoneCompleted(projectId, action.milestone);
      await useBrainStore.getState().refreshBrainFromVfs(projectId);
      completedMilestone = mId;
      nextMilestone = action.next || null;
      item.outcome = { ok: true, summary: `Milestone ${mId} complete` };
      ignoreRemaining = true;
    } else if (action.type === 'finished') {
      if ((mode === 'NEW_PROJECT' || mode === 'CONTINUE') && !modifiedCode && touchedPathsInTurn.size === 0) {
        item.outcome = { ok: false, summary: 'Skipped: 0 source files written yet' };
        continue;
      }
      sawFinished = true;
      item.outcome = { ok: true, summary: 'Done' };
      ignoreRemaining = true;
    }
    scheduleLiveFlush();
  }

  return {
    iterResults,
    modifiedCode,
    ranShell,
    openedFirstCodeFile: openedFirst,
    completedMilestone,
    nextMilestone,
    sawFinished,
  };
}
