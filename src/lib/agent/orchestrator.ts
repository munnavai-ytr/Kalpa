import { isBrainPath } from '@/lib/brain/caps';
import { appendMachineChangelogLine, ensureBrainFiles, isBriefStillTemplate } from '@/lib/brain/files';
import { rebuildBrainIndex } from '@/lib/brain/index';
import { createCheckpoint } from '@/lib/checkpoints/checkpoints';
import type { ChatMessage } from '@/lib/providers/core';
import { isOpenRouterUrl } from '@/lib/providers/credits';
import { useProviderStore } from '@/lib/providers/store';
import { getKalpaDB, type ChatRecord } from '@/lib/vfs/db';
import { vfs } from '@/lib/vfs/vfs';
import { uid } from '@/lib/utils';
import { useAgentStore, type ExecutableAction, type LiveStreamItem } from '@/stores/agent';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useSandboxStore } from '@/stores/sandbox';
import { ActionStream, type Action, type PartialBlock } from './actions';
import { buildAgentMessages } from './context';
import { executeIterationActions } from './executor';
import {
  buildContinueMessage,
  buildInterruptedResumeMessage,
  buildTruncationMessage,
  type AgentMode,
} from './prompts/system';
import { StreamInterruptedError, streamWithRecovery, TerminalProviderError } from './recovery';
import { cleanFileAction, parseWithFallback } from './reliability';
import { bundleResultBlocks } from './results';
import {
  buildNoOpRetryPrompt,
  buildThinkingExtraBodyHint,
  computeTurnChanges,
  shouldRejectNoOpTurn,
  stepFromAction,
} from './turnHelpers';
import { verifyWorkspaceAfterWrites } from './verify';
import { acquireTurnWakeLock } from './wakeLock';

const MAX_ITERATIONS_PER_TURN = 14;

export interface RunTurnOptions {
  mode?: AgentMode;
  skipAddingUserMessage?: boolean;
  hiddenUserMessage?: boolean;
  autoMilestoneIndex?: number;
  onMessagesChanged?: (messages: ChatRecord[]) => void;
}

export async function runTurn(projectId: string, userText: string, opts: RunTurnOptions = {}): Promise<void> {
  const agentStore = useAgentStore.getState();
  if (agentStore.isRunning && !opts.autoMilestoneIndex) return;

  let activeProfile = useProviderStore.getState().getActiveProfile();
  const db = await getKalpaDB();
  const reloadHistory = async () => {
    const rows = await db.getAllFromIndex('chat', 'by-project', projectId);
    rows.sort((a, b) => a.createdAt - b.createdAt);
    opts.onMessagesChanged?.(rows);
    return rows;
  };

  if (!activeProfile || (!activeProfile.apiKey && !/localhost|127\.0\.0\.1/.test(activeProfile.baseUrl))) {
    if (!opts.skipAddingUserMessage && !opts.hiddenUserMessage) {
      await db.put('chat', { id: uid('msg'), projectId, role: 'user', content: userText, createdAt: Date.now() });
    }
    await db.put('chat', {
      id: uid('msg'), projectId, role: 'assistant', content: '', createdAt: Date.now() + 1,
      meta: {
        error: {
          kind: 'auth',
          message: 'No active AI provider API key configured.',
          hint: 'Tap the model chip or open Settings -> Providers to add your key.',
        },
      },
    });
    await reloadHistory();
    return;
  }

  await ensureBrainFiles(projectId);
  const beforeSnap = await vfs.snapshot(projectId);
  const codeCount = Object.keys(beforeSnap).filter((p) => !isBrainPath(p) && !p.endsWith('/.gitkeep')).length;
  const mode: AgentMode =
    opts.mode ?? ((await isBriefStillTemplate(projectId)) && codeCount <= 4 ? 'NEW_PROJECT' : 'CHANGE');
  const preferredStack = useProjectStore.getState().currentProject?.stack;

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

  const wakeGuard = await acquireTurnWakeLock(
    agentStore.prefs.keepScreenAwake,
    () => useAgentStore.getState().isRunning,
    (active) => useAgentStore.getState().setScreenAwakeActive(active)
  );

  // A8: Non-blocking OpenRouter credit check at turn start
  if (isOpenRouterUrl(activeProfile.baseUrl) && activeProfile.apiKey) {
    void useProviderStore.getState().refreshOpenRouterCredit(activeProfile.id).then((info) => {
      if (info && info.limitRemaining !== null && info.limitRemaining <= 0.02 && useAgentStore.getState().isRunning) {
        useAgentStore.getState().setActiveNotice({
          kind: 'warn',
          text: `Low OpenRouter credit ($${info.limitRemaining.toFixed(3)}) — automatic output token sizing active.`,
          persistent: true,
        });
      }
    });
  }

  const ephemeralTurnMessages: ChatMessage[] = [];
  const accumulatedTranscript: string[] = [];
  const liveItems: LiveStreamItem[] = [];
  const touchedPathsInTurn = new Set<string>();
  const errorSigCounts = new Map<string, number>();

  let totalUsageInput = 0, totalUsageOutput = 0, repairAttempts = 0;
  let noOpRetries = 0, emptyRetries = 0, interruptRetries = 0, outputTokenMultiplier = 1;
  let memoryWriteCount = 0, ranAnyTool = false;
  let modifiedCodeSinceVerify = false, hasRunVerifyShell = false, openedFirstCodeFile = false;
  let completedMilestone: string | null = null, nextMilestone: string | null = null, sawFinished = false;
  let terminalTurnError: NonNullable<ChatRecord['meta']>['error'] | undefined;
  let rafScheduled = false;
  let latestPartial: PartialBlock | null = null;

  const scheduleLiveFlush = () => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (!useAgentStore.getState().isRunning) return;
      useAgentStore.getState().setLiveSnapshot(
        [...liveItems],
        latestPartial
          ? {
              tag: latestPartial.name,
              pathHint: latestPartial.attrs.path || latestPartial.attrs.file,
              lineCount: latestPartial.body ? latestPartial.body.split('\n').length : 0,
            }
          : null
      );
    });
  };

  try {
    for (let iter = 1; iter <= MAX_ITERATIONS_PER_TURN; iter++) {
      if (controller.signal.aborted) break;
      useAgentStore.getState().updateTurnStatus({ iteration: iter });
      const { prefs } = useAgentStore.getState();

      const buildContext = (compacted = false) =>
        buildAgentMessages({
          projectId,
          engine: useSandboxStore.getState().engine,
          preferredStack,
          mode,
          latestUserText: userText,
          profile: activeProfile!,
          economyMode: prefs.economyMode,
          selectedFilesScale: compacted ? 0.45 : 1,
          forceDropOlderHistory: compacted,
          openEditorFiles: useProjectStore.getState().getOpenFiles(),
          recentTouchedPaths: [...touchedPathsInTurn, ...(useAgentStore.getState().recentTouchedByProject[projectId] ?? [])],
          chatHistory: baseChatHistory,
          ephemeralTurnMessages,
          summarisedUpToId: useAgentStore.getState().summarisedUpToByProject[projectId] ?? null,
          onSummarisedUpTo: (lastId) => useAgentStore.getState().setSummarisedUpTo(projectId, lastId),
          signal: controller.signal,
        });

      const apiMessages = await buildContext(false);
      const parser = new ActionStream();
      const iterStartLiveLen = liveItems.length;
      let iterRawText = '';
      let iterReasoningTokens = 0;
      let iterOutputTokens = 0;
      let iterActions: { item: Extract<LiveStreamItem, { kind: 'action' }>; action: ExecutableAction }[] = [];

      const consumeActions = (actions: Action[]) => {
        for (const rawAct of actions) {
          const a = cleanFileAction(rawAct);
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

      let streamInterrupted = false;
      try {
        for await (const chunk of streamWithRecovery(activeProfile, apiMessages, {
          signal: controller.signal,
          idleTimeoutMs: prefs.idleTimeoutMs,
          economyOverride: prefs.economyMode,
          outputTokenMultiplier,
          onNotice: (n) => useAgentStore.getState().setActiveNotice(n),
          onProfileSwitched: (nextProf) => { activeProfile = nextProf; },
          onCompactContext: () => buildContext(true),
        })) {
          if (chunk.delta) {
            iterRawText += chunk.delta;
            consumeActions(parser.push(chunk.delta));
            latestPartial = parser.partial();
            scheduleLiveFlush();
          }
          if (chunk.reasoningTokens) iterReasoningTokens += chunk.reasoningTokens;
          if (chunk.usage) {
            const inTok = chunk.usage.input ?? 0;
            const outTok = chunk.usage.output ?? 0;
            totalUsageInput += inTok;
            totalUsageOutput += outTok;
            iterOutputTokens += outTok;
            useAgentStore.getState().addSessionTokens(inTok, outTok);
          }
        }
      } catch (streamErr) {
        if (streamErr instanceof StreamInterruptedError && interruptRetries < 3) {
          interruptRetries++;
          streamInterrupted = true;
          useAgentStore.getState().setActiveNotice({
            kind: 'info',
            text: `Connection dropped mid-stream — keeping completed actions and resuming (${interruptRetries}/3)…`,
            persistent: true,
          });
        } else {
          throw streamErr;
        }
      }

      const ended = parser.end();
      latestPartial = null;
      consumeActions(ended.actions);

      // B4: Empty or thinking-exhausted reply recovery
      if (!streamInterrupted && iterRawText.trim() === '') {
        if (emptyRetries < 2) {
          emptyRetries++;
          if (iterReasoningTokens > 0 || iterOutputTokens > 0) outputTokenMultiplier = 2;
          useAgentStore.getState().setActiveNotice({
            kind: 'warn',
            text: `Empty model response — retrying (${emptyRetries}/2)…`,
            persistent: true,
          });
          ephemeralTurnMessages.push({
            role: 'user',
            content:
              'Your previous response emitted 0 visible characters. Keep internal thinking brief and immediately output the required <file> or <edit> XML action tags.',
          });
          continue;
        }
        terminalTurnError = {
          kind: 'empty_reply',
          message:
            iterReasoningTokens > 0 || iterOutputTokens > 0
              ? 'Model spent its entire output budget on hidden thinking tokens and emitted no code.'
              : 'Model returned an empty response after 2 retries.',
          hint: 'Lower reasoning effort via Extra JSON body in Settings -> Providers, or switch models.',
          extraBodyHint: buildThinkingExtraBodyHint(activeProfile.kind),
          providerKind: activeProfile.kind,
          baseUrl: activeProfile.baseUrl,
        };
        break;
      }

      // B1 & B3: Fallback parser escalation (normalized XML -> fenced Markdown)
      if (!streamInterrupted && iterActions.length === 0) {
        const fb = parseWithFallback(iterRawText);
        if (fb.usedFallback !== 'none' && fb.actions.some((a) => a.type !== 'text')) {
          liveItems.splice(iterStartLiveLen);
          iterActions = [];
          consumeActions(fb.actions);
          activeProfile = { ...activeProfile, strictFormat: true };
          void useProviderStore.getState().patchProfileMeta(activeProfile.id, { strictFormat: true });
          useAgentStore.getState().setActiveNotice({
            kind: 'info',
            text: `Recovered actions via ${fb.usedFallback} parser; enabled strict XML reminder.`,
            persistent: true,
          });
        }
      }

      scheduleLiveFlush();
      if (iterRawText.trim()) accumulatedTranscript.push(iterRawText);

      const execOut = await executeIterationActions(iterActions, {
        projectId, mode, signal: controller.signal, touchedPathsInTurn, openedFirstCodeFile, scheduleLiveFlush,
      });
      openedFirstCodeFile = execOut.openedFirstCodeFile;
      if (execOut.modifiedCode) { modifiedCodeSinceVerify = true; hasRunVerifyShell = false; }
      if (execOut.ranShell) { hasRunVerifyShell = true; ranAnyTool = true; }
      if (iterActions.some((x) => x.action.type === 'memory' && x.item.outcome?.ok)) memoryWriteCount++;
      if (iterActions.some((x) => ['read', 'search', 'list', 'impact', 'question'].includes(x.action.type))) {
        ranAnyTool = true;
      }
      if (execOut.completedMilestone) { completedMilestone = execOut.completedMilestone; nextMilestone = execOut.nextMilestone; }
      if (execOut.sawFinished) sawFinished = true;
      const iterResults = [...execOut.iterResults];

      // A4: Resume seamlessly after mid-stream disconnect without repeating executed actions
      if (streamInterrupted) {
        ephemeralTurnMessages.push({ role: 'assistant', content: iterRawText });
        ephemeralTurnMessages.push({ role: 'user', content: buildInterruptedResumeMessage() });
        continue;
      }

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
          if (repairAttempts <= prefs.maxRepairAttempts && sigCount < 3 && iter < MAX_ITERATIONS_PER_TURN) {
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

      const wantsExit = sawFinished || completedMilestone || iterActions.length === 0 || iterResults.length === 0;
      if (wantsExit) {
        // B2 & B3: Reject fake "Done" when 0 files were changed
        if (
          shouldRejectNoOpTurn({
            mode,
            userText,
            assistantRaw: iterRawText,
            touchedCodeCount: touchedPathsInTurn.size,
            memoryWriteCount,
            ranAnyTool,
          })
        ) {
          activeProfile = { ...activeProfile, strictFormat: true };
          void useProviderStore.getState().patchProfileMeta(activeProfile.id, { strictFormat: true });
          if (noOpRetries < 2 && iter < MAX_ITERATIONS_PER_TURN) {
            noOpRetries++;
            sawFinished = false;
            completedMilestone = null;
            useAgentStore.getState().setActiveNotice({
              kind: 'warn',
              text: `Model emitted 0 file changes — requesting concrete <file> tags (${noOpRetries}/2)…`,
              persistent: true,
            });
            ephemeralTurnMessages.push({ role: 'assistant', content: iterRawText });
            ephemeralTurnMessages.push({ role: 'user', content: buildNoOpRetryPrompt(mode) });
            continue;
          }
          terminalTurnError = {
            kind: 'no_actions',
            message: 'Model finished without creating or editing any files (0 files changed).',
            hint: 'Switch to a stronger coding model or tap Retry.',
            providerKind: activeProfile.kind,
            baseUrl: activeProfile.baseUrl,
          };
        }
        break;
      }

      if (iter < MAX_ITERATIONS_PER_TURN) {
        ephemeralTurnMessages.push({ role: 'assistant', content: iterRawText });
        ephemeralTurnMessages.push({ role: 'user', content: bundleResultBlocks(iterResults) });
      }
    }

    useAgentStore.getState().updateTurnStatus({ step: 'S6', statusLabel: 'Rebuilding Brain index & checkpoint…' });
    const filesChanged = computeTurnChanges(beforeSnap, await vfs.snapshot(projectId));
    if (touchedPathsInTurn.size > 0) useAgentStore.getState().recordTouchedPaths(projectId, [...touchedPathsInTurn]);
    if (filesChanged.length > 0) {
      await appendMachineChangelogLine(projectId, {
        added: filesChanged.filter((f) => f.status === 'added').length,
        modified: filesChanged.filter((f) => f.status === 'modified').length,
        deleted: filesChanged.filter((f) => f.status === 'deleted').length,
      });
    }
    await rebuildBrainIndex(projectId);
    await useBrainStore.getState().refreshBrainFromVfs(projectId);
    const afterCp = filesChanged.length > 0 ? await createCheckpoint(projectId, `after: ${userText.slice(0, 42)}`, turnId) : undefined;
    const rawJoined = accumulatedTranscript.join('\n\n').trim();
    // B5: Never invent '(Done)' when 0 files changed
    const finalContent =
      rawJoined ||
      (controller.signal.aborted
        ? '*(Stopped)*'
        : filesChanged.length > 0
          ? `Updated ${filesChanged.length} file${filesChanged.length === 1 ? '' : 's'}.`
          : '');
    const notices = useAgentStore.getState().turnNotices;

    await db.put('chat', {
      id: uid('msg'), projectId, role: 'assistant',
      content: controller.signal.aborted && rawJoined ? `${finalContent}\n\n*(Stopped)*` : finalContent,
      createdAt: Date.now(),
      meta: {
        turnId, beforeCheckpointId: beforeCp.id, afterCheckpointId: afterCp?.id,
        durationMs: Math.round(performance.now() - turnStart), filesChanged,
        milestoneNext: !terminalTurnError ? (nextMilestone ?? undefined) : undefined,
        stopped: controller.signal.aborted,
        model: activeProfile.model, providerLabel: activeProfile.label,
        notices: notices.length > 0 ? notices : undefined,
        error: terminalTurnError,
        usage: totalUsageInput || totalUsageOutput ? { input: totalUsageInput || undefined, output: totalUsageOutput || undefined } : undefined,
      },
    });
    await reloadHistory();

    const { prefs } = useAgentStore.getState();
    const currentAutoIdx = opts.autoMilestoneIndex ?? 0;
    if (
      !terminalTurnError &&
      filesChanged.length > 0 &&
      nextMilestone &&
      prefs.autoContinue &&
      !controller.signal.aborted &&
      currentAutoIdx + 1 < prefs.maxAutoMilestones
    ) {
      await runTurn(projectId, buildContinueMessage(nextMilestone), {
        mode: 'CONTINUE', hiddenUserMessage: true, autoMilestoneIndex: currentAutoIdx + 1, onMessagesChanged: opts.onMessagesChanged,
      });
      return;
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      const notices = useAgentStore.getState().turnNotices;
      const errMeta: NonNullable<ChatRecord['meta']>['error'] =
        err instanceof TerminalProviderError
          ? {
              message: err.classified.message,
              hint: err.classified.hint,
              kind: err.classified.kind,
              status: err.status,
              rawDetail: err.rawDetail,
              suggestProxy: err.suggestProxy,
              providerKind: err.profile.kind,
              baseUrl: err.profile.baseUrl,
            }
          : {
              message: err instanceof Error ? err.message : String(err),
              providerKind: activeProfile.kind,
              baseUrl: activeProfile.baseUrl,
            };
      await db.put('chat', {
        id: uid('msg'), projectId, role: 'assistant', content: accumulatedTranscript.join('\n\n'), createdAt: Date.now(),
        meta: {
          turnId, beforeCheckpointId: beforeCp.id,
          model: activeProfile.model, providerLabel: activeProfile.label,
          notices: notices.length > 0 ? notices : undefined,
          error: errMeta,
        },
      });
      await reloadHistory();
    }
  } finally {
    await wakeGuard.release();
    useAgentStore.getState().registerAbortController(null);
    useAgentStore.getState().endTurnUi();
  }
}
