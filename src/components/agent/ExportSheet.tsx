'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, ExternalLink, Github, Rocket } from 'lucide-react';
import { exportProjectAsZip } from '@/lib/export/zip';
import { pushProjectToGithub, type GithubPushResult } from '@/lib/export/github';
import { useProviderStore } from '@/lib/providers/store';
import { useBrainStore } from '@/stores/brain';
import { useProjectStore } from '@/stores/project';
import { useUiStore } from '@/stores/ui';
import { Sheet } from '@/components/ui/Sheet';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';

export function ExportSheet() {
  const exportOpen = useBrainStore((s) => s.exportOpen);
  const setExportOpen = useBrainStore((s) => s.setExportOpen);
  const currentProject = useProjectStore((s) => s.currentProject);
  const githubToken = useProviderStore((s) => s.githubToken);
  const setGithubToken = useProviderStore((s) => s.setGithubToken);
  const addToast = useUiStore((s) => s.addToast);

  const [tab, setTab] = useState<'zip' | 'github'>('zip');
  const [includeBrain, setIncludeBrain] = useState(false);

  const [tokenDraft, setTokenDraft] = useState(githubToken);
  const [createNew, setCreateNew] = useState(true);
  const [isPrivate, setIsPrivate] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('Ship from Kalpa');
  const [mirrorDeletions, setMirrorDeletions] = useState(false);

  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<GithubPushResult | null>(null);

  useEffect(() => {
    setTokenDraft(githubToken);
  }, [githubToken]);

  useEffect(() => {
    if (exportOpen && currentProject && !repoInput) {
      const slug = currentProject.name
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
      setRepoInput(slug || 'kalpa-app');
    }
  }, [exportOpen, currentProject, repoInput]);

  const handleZipDownload = async () => {
    if (!currentProject) return;
    await exportProjectAsZip(currentProject.id, currentProject.name, { includeBrain });
    addToast({ title: 'Downloaded project ZIP', kind: 'success' });
  };

  const handleGithubPush = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject) return;
    setPushing(true);
    setErrorMsg(null);
    setResult(null);
    setProgress('Starting export…');

    try {
      if (tokenDraft.trim() !== githubToken) {
        await setGithubToken(tokenDraft.trim());
      }
      const res = await pushProjectToGithub({
        projectId: currentProject.id,
        token: tokenDraft.trim(),
        repoInput,
        createNew,
        isPrivate,
        branch,
        commitMessage,
        includeBrain,
        mirrorDeletions,
        onProgress: setProgress,
      });
      setResult(res);
      addToast({ title: `Pushed ${res.filesPushed} files to ${res.repoFullName}`, kind: 'success' });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  return (
    <Sheet
      open={exportOpen}
      onClose={() => setExportOpen(false)}
      title="Export & Deploy Project"
      side="right"
    >
      <div className="space-y-4">
        <Tabs
          tabs={[
            { id: 'zip', label: 'Download ZIP' },
            { id: 'github', label: 'Push to GitHub' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'zip' ? (
          <div className="space-y-4 pt-1">
            <p className="text-xs text-kalpa-muted leading-relaxed">
              Download all workspace source files as a clean <code className="font-mono">.zip</code> archive ready to run locally or deploy anywhere.
            </p>

            <label className="flex items-center gap-2.5 text-xs text-kalpa-text cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeBrain}
                onChange={(e) => setIncludeBrain(e.target.checked)}
                className="rounded accent-kalpa-violet w-4 h-4"
              />
              <span>Include Project Brain (<code className="font-mono">.kalpa/</code> memory files)</span>
            </label>

            <Button
              variant="primary"
              className="w-full"
              leftIcon={<Download className="w-4 h-4" />}
              onClick={handleZipDownload}
            >
              Download {currentProject?.name ?? 'Project'}.zip
            </Button>
          </div>
        ) : (
          <form onSubmit={handleGithubPush} className="space-y-3.5 pt-1 text-xs">
            <div className="space-y-1">
              <label className="block font-medium text-kalpa-muted">
                GitHub Fine-Grained Token (stored in local vault)
              </label>
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="github_pat_... or ghp_..."
                autoComplete="off"
                className="w-full min-h-[40px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border font-mono text-xs text-kalpa-text"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCreateNew(true)}
                className={`flex-1 py-2 rounded-[8px] border font-medium cursor-pointer ${
                  createNew
                    ? 'border-kalpa-violet bg-kalpa-violet/15 text-kalpa-text'
                    : 'border-kalpa-border text-kalpa-muted'
                }`}
              >
                Create new repo
              </button>
              <button
                type="button"
                onClick={() => setCreateNew(false)}
                className={`flex-1 py-2 rounded-[8px] border font-medium cursor-pointer ${
                  !createNew
                    ? 'border-kalpa-violet bg-kalpa-violet/15 text-kalpa-text'
                    : 'border-kalpa-border text-kalpa-muted'
                }`}
              >
                Existing repo
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-2 space-y-1">
                <label className="block font-medium text-kalpa-muted">
                  {createNew ? 'Repository name' : 'owner/repo'}
                </label>
                <input
                  type="text"
                  value={repoInput}
                  onChange={(e) => setRepoInput(e.target.value)}
                  placeholder={createNew ? 'my-kalpa-app' : 'octocat/my-kalpa-app'}
                  className="w-full min-h-[40px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border font-mono text-xs text-kalpa-text"
                />
              </div>

              <div className="space-y-1">
                <label className="block font-medium text-kalpa-muted">Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full min-h-[40px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border font-mono text-xs text-kalpa-text"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block font-medium text-kalpa-muted">Commit message</label>
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-xs text-kalpa-text"
              />
            </div>

            <div className="space-y-2 pt-0.5">
              {createNew ? (
                <label className="flex items-center gap-2 text-kalpa-text cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="rounded accent-kalpa-violet w-4 h-4"
                  />
                  <span>Private repository</span>
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-kalpa-text cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeBrain}
                  onChange={(e) => setIncludeBrain(e.target.checked)}
                  className="rounded accent-kalpa-violet w-4 h-4"
                />
                <span>Include Project Brain (<code className="font-mono">.kalpa/</code>)</span>
              </label>

              {!createNew ? (
                <label className="flex items-center gap-2 text-kalpa-text cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mirrorDeletions}
                    onChange={(e) => setMirrorDeletions(e.target.checked)}
                    className="rounded accent-kalpa-violet w-4 h-4"
                  />
                  <span>Mirror deletions (remove remote files not in VFS)</span>
                </label>
              ) : null}
            </div>

            {errorMsg ? (
              <div className="p-3 rounded-[10px] border border-kalpa-danger/45 bg-kalpa-danger/10 text-kalpa-danger leading-relaxed">
                {errorMsg}
              </div>
            ) : null}

            {pushing ? (
              <div className="p-2.5 rounded-[10px] bg-kalpa-surface text-kalpa-violet font-mono">
                {progress}
              </div>
            ) : null}

            {result ? (
              <div className="p-3.5 rounded-[12px] border border-kalpa-success/40 bg-kalpa-success/10 space-y-2.5">
                <div className="flex items-center gap-2 text-kalpa-success font-semibold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Committed {result.filesPushed} files to {result.repoFullName}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={result.commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-kalpa-bg-2 border border-kalpa-border text-kalpa-text hover:border-kalpa-violet"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View Commit ({result.commitSha.slice(0, 7)})
                  </a>
                  <a
                    href={`https://vercel.com/new/clone?repository-url=${encodeURIComponent(result.repoUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] kalpa-grad-bg text-white font-semibold"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Import in Vercel
                  </a>
                </div>
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={pushing}
              leftIcon={<Github className="w-4 h-4" />}
            >
              Push Single Commit to GitHub
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}
