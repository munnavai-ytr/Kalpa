import { isBrainPath } from '@/lib/brain/caps';
import { appendMachineChangelogLine, ensureBrainFiles, isBriefStillTemplate } from '@/lib/brain/files';
import { rebuildBrainIndex } from '@/lib/brain/index';
import { createCheckpoint } from '@/lib/checkpoints/checkpoints';
import { streamChat, type ChatMessage } from '@/lib/providers/core';
import { useProviderStore } from '@/lib/providers/store';
import { getKalpaDB, type ChatRecord, type TurnFileChange } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import { uid } from '@/lib/utils';
import { useAgentStore, type AgentStepId, type ExecutableAction, type LiveStreamItem } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { ActionStream, type Action, type PartialBlock } from './actions';
import { buildAgentMessages } from './context';
import { executeIterationActions } from './executor';
import { buildContinueMessage, buildTruncationMessage, type AgentMode } from './prompts/system';
import { bundleResultBlocks } from './results';
import { verifyWorkspaceAfterWrites } from './verify';

const MAX_ITERATIONS_PER_TURN = 12;

export interface RunTurnOptions {
  mode?: AgentMode;
  skipAddingUserMessage?: boolean;
  hiddenUserMessage?: boolean;
  autoMilestoneIndex?: number;
  onMessagesChanged?: (messages: ChatRecord[]) => void;
}

function stepFromAction(a: ExecutableAction): { step: AgentStepId; label: string } {
  switch (a.type) {
    case 'status':
      return {
        step: (['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].includes(a.step || '') ? a.step : 'S0') as AgentStepId,
        label: a.text || 'Working…',
      };
    case 'read':
    case 'search':
    case 'list':
    case 'impact':
      return { step: 'S0', label: `Inspecting ${a.type}…` };
    case 'question':
      return { step: 'S0', label: 'Asking a quick question…' };
    case 'memory':
      if (a.file === 'brief') return { step: 'S1', label: 'Writing project brief…' };
      if (a.file === 'architecture' || a.file === 'conventions' || a.file === 'tasks') {
        return { step: 'S2', label: `Planning (${a.file}.md)…` };
      }
      return { step: 'S6', label: `Updating Brain (${a.file}.md)…` };
    case 'file':
      return { step: 'S3', label: `Writing ${a.path}…` };
    case 'edit':
      return { step: 'S3', label: `Editing ${a.path}…` };
    case 'delete':
    case 'move':
      return { step: 'S3', label: 'Updating workspace paths…' };
    case 'shell':
      return { step: 'S5', label: `Running: ${a.cmd.slice(0, 48)}…` };
    case 'complete':
      return { step: 'S7', label: `Completed ${a.milestone || 'milestone'}` };
    case 'finished':
      return { step: 'S7', label: 'Finishing up…' };
  }
}

function computeTurnChanges(beforeSnap: Record<string, string>, afterSnap: Record<string, string>): TurnFileChange[] {
  const changes: TurnFileChange[] = [];
  const allPaths = new Set([...Object.keys(beforeSnap), ...Object.keys(afterSnap)]);
  for (const path of Array.from(allPaths).sort()) {
    if (isBrainPath(path) || path.endsWith('/.gitkeep')) continue;
    const b = beforeSnap[path], a = afterSnap[path];
    if (b === undefined && a !== undefined) changes.push({ path, status: 'added', before: '', after: a });
    else if (b !== undefined && a === undefined) changes.push({ path, status: 'deleted', before: b, after: '' });
    else if (b !== undefined && a !== undefined && b !== a) changes.push({ path, status: 'modified', before: b, after: a });
  }
  return changes;
}

export async function runTurn(projectId: string, userText: string, opts: RunTurnOptions = {}): Promise<void> {
  const agentStore = useAgentStore.getState();
  if (agentStore.isRunning && !opts.autoMilestoneIndex) return;

  const profile = useProviderStore.getState().getActiveProfile();
  const db = await getKalpaDB();
  const reloadHistory = async () => {
    const rows = await db.getAllFromIndex('chat', 'by-project', projectId);
    rows.sort((a, b) => a.createdAt - b.createdAt);
    opts.onMessagesChanged?.(rows);
    return rows;
  };

  if (!profile || (!profile.apiKey && !/localhost|127\.0\.0\.1/.test(profile.baseUrl))) {
    if (!opts.skipAddingUserMessage && !opts.hiddenUserMessage) {
      await db.put('chat', { id: uid('msg'), projectId, role: 'user', content: userText, createdAt: Date.now() });
    }
    await db.put('chat', {
      id: uid('msg'), projectId, role: 'assistant', content: '', createdAt: Date.now() + 1,
      meta: { error: { message: 'No active AI provider API key configured. Tap the model chip or open Settings.' } },
    });
    await reloadHistory();
    return;
  }

  await ensureBrainFiles(projectId);
  const beforeSnap = await vfs.snapshot(projectId);
  const codeCount = Object.keys(beforeSnap).filter((p) => !isBrainPath(p) && !p.endsWith('/.gitkeep')).length;
  const mode: AgentMode = opts.mode ?? ((await isBriefStillTemplate(projectId)) && codeCount <= 4 ? 'NEW_PROJECT' : 'CHANGE');

  const turnId = uid('turn');
  const turnStart = performance.now();
  const controller = new AbortController();
  agentStore.registerAbortController(controller);
  const beforeCp = await createCheckpoint(projectId, `before: ${userText.slice(0, 42)}`, turnId);

  if (!opts.skipAddingUserMessage) {
    await db.put('chat', {
      id: uid('msg'), projectId, role: 'user', content: userText, createdAt: Date.now(),
      meta: opts.hiddenUserMessage ? { hiddenAutoContinue: true, turnId } : { turnId },
    });
  }
  const baseChatHistory = await reloadHistory();

  agentStore.beginTurnUi({
    projectId, turnId, mode,
    step: mode === 'NEW_PROJECT' ? 'S1' : 'S0',
    statusLabel: mode === 'NEW_PROJECT' ? 'Understanding & framing brief…' : 'Inspecting project…',
  });
  if (opts.autoMilestoneIndex) agentStore.updateTurnStatus({ autoMilestoneIndex: opts.autoMilestoneIndex });

  const ephemeralTurnMessages: ChatMessage[] = [];
  const accumulatedTranscript: string[] = [];
  const liveItems: LiveStreamItem[] = [];
  const touchedPathsInTurn = new Set<string>();
  const errorSigCounts = new Map<string, number>();

  let totalUsageInput = 0, totalUsageOutput = 0, repairAttempts = 0;
  let modifiedCodeSinceVerify = false, hasRunVerifyShell = false, openedFirstCodeFile = false;
  let completedMilestone: string | null = null, nextMilestone: string | null = null, sawFinished = false;
  let rafScheduled = false;
  let latestPartial: PartialBlock | null = null;

  const scheduleLiveFlush = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (!useAgentStore.getState().isRunning) return;
      const partialIndicator = latestPartial
        ? {
            tag: latestPartial.name,
            pathHint: latestPartial.attrs.path || latestPartial.attrs.file,
            lineCount: latestPartial.body ? latestPartial.body.split('\n').length : 0,
          }
        : null;
      useAgentStore.getState().setLiveSnapshot([...liveItems], partialIndicator);
    });
  };

  try {
    for (let iter = 1; iter <= MAX_ITERATIONS_PER_TURN; iter++) {
      if (controller.signal.aborted) break;
      useAgentStore.getState().updateTurnStatus({ iteration: iter });

      const apiMessages = await buildAgentMessages({
        projectId, engine: useSandboxStore.getState().engine, mode, latestUserText: userText, profile,
        openEditorFiles: useProjectStore.getState().getOpenFiles(),
        recentTouchedPaths: [...touchedPathsInTurn, ...(useAgentStore.getState().recentTouchedByProject[projectId] ?? [])],
        chatHistory: baseChatHistory, ephemeralTurnMessages,
        summarisedUpToId: useAgentStore.getState().summarisedUpToByProject[projectId] ?? null,
        onSummarisedUpTo: (lastId) => useAgentStore.getState().setSummarisedUpTo(projectId, lastId),
        signal: controller.signal,
      });

      const parser = new ActionStream();
      let iterRawText = '';
      const iterActions: { item: Extract<LiveStreamItem, { kind: 'action' }>; action: ExecutableAction }[] = [];

      const consumeActions = (actions: Action[]) => {
        for (const a of actions) {
          if (a.type === 'text') {
            const last = liveItems[liveItems.length - 1];
            if (last && last.kind === 'text') last.text += `\n\n${a.text}`;
            else liveItems.push({ id: uid('txt'), kind: 'text', text: a.text });
          } else {
            const stepInfo = stepFromAction(a);
            useAgentStore.getState().updateTurnStatus({ step: stepInfo.step, statusLabel: stepInfo.label });
            const actionItem: Extract<LiveStreamItem, { kind: 'action' }> = { id: uid('act'), kind: 'action', action: a };
            liveItems.push(actionItem);
            iterActions.push({ item: actionItem, action: a });
          }
        }
      };

      for await (const chunk of streamChat(profile, apiMessages, controller.signal)) {
        if (chunk.delta) {
          iterRawText += chunk.delta;
          consumeActions(parser.push(chunk.delta));
          latestPartial = parser.partial();
          scheduleLiveFlush();
        }
        if (chunk.usage?.input) totalUsageInput += chunk.usage.input;
        if (chunk.usage?.output) totalUsageOutput += chunk.usage.output;
      }

      const ended = parser.end();
      latestPartial = null;
      consumeActions(ended.actions);
      scheduleLiveFlush();
      if (iterRawText.trim()) accumulatedTranscript.push(iterRawText);

      const execOut = await executeIterationActions(iterActions, {
        projectId, mode, signal: controller.signal, touchedPathsInTurn, openedFirstCodeFile, scheduleLiveFlush,
      });
      openedFirstCodeFile = execOut.openedFirstCodeFile;
      if (execOut.modifiedCode) { modifiedCodeSinceVerify = true; hasRunVerifyShell = false; }
      if (execOut.ranShell) hasRunVerifyShell = true;
      if (execOut.completedMilestone) { completedMilestone = execOut.completedMilestone; nextMilestone = execOut.nextMilestone; }
      if (execOut.sawFinished) sawFinished = true;
      const iterResults = [...execOut.iterResults];

      if (ended.truncated) {
        ephemeralTurnMessages.push({ role: 'assistant', content: iterRawText });
        ephemeralTurnMessages.push({ role: 'user', content: buildTruncationMessage(`<${ended.truncated.name}>`) });
        continue;
      }

      const needsImmediateFollowup = iterActions.some(({ action, item }) =>
        action.type === 'read' || action.type === 'search' || action.type === 'list' ||
        action.type === 'impact' || action.type === 'question' ||
        ((action.type === 'edit' || action.type === 'memory') && !item.outcome?.ok)
      );

      if (modifiedCodeSinceVerify && (sawFinished || completedMilestone || !needsImmediateFollowup)) {
        useAgentStore.getState().updateTurnStatus({ step: 'S5', statusLabel: 'Verifying preview & runtime…' });
        const ver = await verifyWorkspaceAfterWrites(projectId, {
          engine: useSandboxStore.getState().engine, modifiedCodeFiles: modifiedCodeSinceVerify,
          hasRunVerificationShell: hasRunVerifyShell, signal: controller.signal,
        });
        if (ver.hasError) {
          repairAttempts++;
          const sigCount = (errorSigCounts.get(ver.errorSignature) ?? 0) + 1;
          errorSigCounts.set(ver.errorSignature, sigCount);
          if (repairAttempts <= useAgentStore.getState().prefs.maxRepairAttempts && sigCount < 3 && iter < MAX_ITERATIONS_PER_TURN) {
            sawFinished = false; completedMilestone = null; nextMilestone = null;
            useAgentStore.getState().updateTurnStatus({ step: 'S5', statusLabel: `Repairing issue (attempt ${repairAttempts})…` });
            iterResults.push(...ver.resultBlocks);
          } else {
            accumulatedTranscript.push(`\n\n> **Verification notice:** Stopped automatic repair after ${repairAttempts} attempts:\n\`\`\`\n${ver.errorSignature}\n\`\`\``);
            modifiedCodeSinceVerify = false;
          }
        } else {
          modifiedCodeSinceVerify = false;
          if (!sawFinished && !completedMilestone) iterResults.push(...ver.resultBlocks);
        }
      }

      if (sawFinished || completedMilestone || iterActions.length === 0) break;
      if (iterResults.length > 0 && iter < MAX_ITERATIONS_PER_TURN) {
        ephemeralTurnMessages.push({ role: 'assistant', content: iterRawText });
        ephemeralTurnMessages.push({ role: 'user', content: bundleResultBlocks(iterResults) });
      } else break;
    }

    useAgentStore.getState().updateTurnStatus({ step: 'S6', statusLabel: 'Rebuilding Brain index & checkpoint…' });
    const filesChanged = computeTurnChanges(beforeSnap, await vfs.snapshot(projectId));
    if (touchedPathsInTurn.size > 0) useAgentStore.getState().recordTouchedPaths(projectId, [...touchedPathsInTurn]);
    await appendMachineChangelogLine(projectId, {
      added: filesChanged.filter((f) => f.status === 'added').length,
      modified: filesChanged.filter((f) => f.status === 'modified').length,
      deleted: filesChanged.filter((f) => f.status === 'deleted').length,
    });
    await rebuildBrainIndex(projectId);
    await useBrainStore.getState().refreshBrainFromVfs(projectId);
    const afterCp = filesChanged.length > 0 ? await createCheckpoint(projectId, `after: ${userText.slice(0, 42)}`, turnId) : undefined;
    const finalContent = accumulatedTranscript.join('\n\n').trim() || (controller.signal.aborted ? '*(Stopped)*' : '(Done)');

    await db.put('chat', {
      id: uid('msg'), projectId, role: 'assistant',
      content: controller.signal.aborted ? `${finalContent}\n\n*(Stopped)*` : finalContent,
      createdAt: Date.now(),
      meta: {
        turnId, beforeCheckpointId: beforeCp.id, afterCheckpointId: afterCp?.id,
        durationMs: Math.round(performance.now() - turnStart), filesChanged,
        milestoneNext: nextMilestone ?? undefined, stopped: controller.signal.aborted,
        model: profile.model, providerLabel: profile.label,
        usage: totalUsageInput || totalUsageOutput ? { input: totalUsageInput || undefined, output: totalUsageOutput || undefined } : undefined,
      },
    });
    await reloadHistory();

    const { prefs } = useAgentStore.getState();
    const currentAutoIdx = opts.autoMilestoneIndex ?? 0;
    if (nextMilestone && prefs.autoContinue && !controller.signal.aborted && currentAutoIdx + 1 < prefs.maxAutoMilestones) {
      await runTurn(projectId, buildContinueMessage(nextMilestone), {
        mode: 'CONTINUE', hiddenUserMessage: true, autoMilestoneIndex: currentAutoIdx + 1, onMessagesChanged: opts.onMessagesChanged,
      });
      return;
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      const raw = err instanceof Error ? err.message : String(err);
      const suggestProxy = !profile.useProxy && !/localhost|127\.0\.0\.1/.test(profile.baseUrl) && /failed to fetch|networkerror|load failed|cors/i.test(raw);
      await db.put('chat', {
        id: uid('msg'), projectId, role: 'assistant', content: accumulatedTranscript.join('\n\n'), createdAt: Date.now(),
        meta: { turnId, beforeCheckpointId: beforeCp.id, model: profile.model, providerLabel: profile.label, error: { message: raw, suggestProxy } },
      });
      await reloadHistory();
    }
  } finally {
    useAgentStore.getState().registerAbortController(null);
    useAgentStore.getState().endTurnUi();
  }
}
