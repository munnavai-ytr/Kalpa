'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Github, ShieldCheck } from 'lucide-react';
import { useProviderStore } from '@/lib/providers/store';
import { useUiStore } from '@/stores/ui';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function ExportTab() {
  const githubToken = useProviderStore((s) => s.githubToken);
  const setGithubToken = useProviderStore((s) => s.setGithubToken);
  const addToast = useUiStore((s) => s.addToast);

  const [draft, setDraft] = useState(githubToken);
  const [reveal, setReveal] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifiedLogin, setVerifiedLogin] = useState<string | null>(null);

  useEffect(() => {
    setDraft(githubToken);
  }, [githubToken]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await setGithubToken(draft.trim());
    setVerifiedLogin(null);
    addToast({
      title: draft.trim() ? 'GitHub token saved in local vault' : 'GitHub token cleared',
      kind: 'success',
    });
  };

  const handleVerify = async () => {
    const clean = draft.trim();
    if (!clean) {
      addToast({ title: 'Paste a GitHub Personal Access Token first', kind: 'warn' });
      return;
    }
    setVerifying(true);
    setVerifiedLogin(null);
    try {
      if (clean !== githubToken) {
        await setGithubToken(clean);
      }
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${clean}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      const json = (await res.json()) as { login?: string; message?: string };
      if (!res.ok || !json.login) {
        throw new Error(json.message || `GitHub HTTP ${res.status}`);
      }
      setVerifiedLogin(json.login);
      addToast({ title: `Authenticated as @${json.login}`, kind: 'success' });
    } catch (err) {
      addToast({
        title: 'GitHub token check failed',
        description: err instanceof Error ? err.message : String(err),
        kind: 'error',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Github className="w-4 h-4 text-kalpa-text shrink-0" />
            <h3 className="text-sm font-semibold text-kalpa-text">
              GitHub Export &amp; One-Commit Push
            </h3>
          </div>
          {verifiedLogin ? (
            <span className="inline-flex items-center gap-1 text-xs font-mono text-kalpa-success">
              <CheckCircle2 className="w-3.5 h-3.5" /> @{verifiedLogin}
            </span>
          ) : null}
        </div>

        <p className="text-sm text-kalpa-muted leading-relaxed">
          Kalpa pushes your workspace directly from the browser to GitHub using the Git Data REST
          API in a single atomic commit — ready to deploy to Vercel or Cloudflare Pages in one click.
        </p>

        <form onSubmit={handleSave} className="space-y-3">
          <label className="block text-xs font-medium text-kalpa-muted">
            GitHub Fine-Grained Personal Access Token
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                type={reveal ? 'text' : 'password'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="github_pat_... or ghp_..."
                autoComplete="off"
                className="w-full min-h-[44px] pl-3.5 pr-11 rounded-[10px] bg-kalpa-surface border border-kalpa-border text-sm font-mono text-kalpa-text"
              />
              <button
                type="button"
                aria-label={reveal ? 'Hide GitHub token' : 'Reveal GitHub token'}
                onClick={() => setReveal((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-kalpa-muted hover:text-kalpa-text cursor-pointer"
              >
                {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button type="submit" variant="secondary">
              Save Token
            </Button>
            <Button
              type="button"
              variant="primary"
              loading={verifying}
              leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}
              onClick={handleVerify}
            >
              Verify Token
            </Button>
          </div>
        </form>

        <div className="rounded-[10px] bg-kalpa-bg p-3 border border-kalpa-border text-xs text-kalpa-muted space-y-1">
          <p className="font-semibold text-kalpa-text">Required Fine-Grained Token Permissions:</p>
          <p>· <span className="text-kalpa-text font-mono">Contents: Read and write</span> (required to upload blobs, trees, and commits).</p>
          <p>· <span className="text-kalpa-text font-mono">Administration: Read and write</span> (only needed if creating brand-new repositories from Kalpa).</p>
        </div>
      </Card>
    </div>
  );
}
