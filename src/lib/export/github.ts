import { getKalpaDB, type FileRecord } from '@/lib/vfs/db';

const GITHUB_API = 'https://api.github.com';
const BLOB_CONCURRENCY = 6;

export interface GithubPushOptions {
  projectId: string;
  token: string;
  repoInput: string; // "repo-name" or "owner/repo"
  createNew: boolean;
  isPrivate: boolean;
  branch: string;
  commitMessage: string;
  includeBrain: boolean;
  mirrorDeletions: boolean;
  onProgress?: (status: string) => void;
}

export interface GithubPushResult {
  repoFullName: string;
  repoUrl: string;
  commitSha: string;
  commitUrl: string;
  filesPushed: number;
}

function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function explainGithubError(status: number, rawMessage: string, context: string): Error {
  if (status === 401) {
    return new Error('GitHub authentication failed (401). Check that your Personal Access Token is valid and unexpired.');
  }
  if (status === 403) {
    return new Error(
      `GitHub permission denied (403) during ${context}. Ensure your fine-grained PAT grants "Contents: Read and write" (and "Administration: Read and write" when creating new repos).`
    );
  }
  if (status === 404) {
    return new Error(
      `GitHub resource not found (404) during ${context}. Verify the owner/repo name and token repository access.`
    );
  }
  if (status === 409) {
    return new Error(`GitHub conflict (409) during ${context}: ${rawMessage}`);
  }
  if (status === 422) {
    return new Error(`GitHub validation error (422) during ${context}: ${rawMessage}`);
  }
  return new Error(`GitHub API error (${status}) during ${context}: ${rawMessage}`);
}

async function ghFetch<T>(
  token: string,
  path: string,
  init: RequestInit,
  context: string
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const json = (await res.json()) as { message?: string };
      if (json.message) msg = json.message;
    } catch {
      // ignore
    }
    throw explainGithubError(res.status, msg, context);
  }

  return (await res.json()) as T;
}

export async function pushProjectToGithub(opts: GithubPushOptions): Promise<GithubPushResult> {
  const token = opts.token.trim();
  if (!token) {
    throw new Error('Enter a GitHub Personal Access Token before pushing.');
  }

  const db = await getKalpaDB();
  const allRows: FileRecord[] = await db.getAllFromIndex('files', 'by-project', opts.projectId);
  const filesToPush = allRows.filter((f) => {
    if (f.path.endsWith('/.gitkeep')) return false;
    if (!opts.includeBrain && (f.path === '.kalpa' || f.path.startsWith('.kalpa/'))) return false;
    if (
      f.path.startsWith('node_modules/') ||
      f.path.startsWith('.next/') ||
      f.path.startsWith('.git/') ||
      f.path.startsWith('dist/')
    ) {
      return false;
    }
    return true;
  });

  if (filesToPush.length === 0) {
    throw new Error('This project has no exportable files to push.');
  }

  opts.onProgress?.('Authenticating with GitHub…');
  const me = await ghFetch<{ login: string }>(token, '/user', { method: 'GET' }, 'user lookup');

  const cleanRepoInput = opts.repoInput.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  let owner = me.login;
  let repo = cleanRepoInput;
  if (cleanRepoInput.includes('/')) {
    const [o, r] = cleanRepoInput.split('/');
    owner = o;
    repo = r;
  }
  if (!repo) {
    throw new Error('Enter a valid repository name (for example "my-app" or "owner/my-app").');
  }

  const branch = opts.branch.trim() || 'main';

  if (opts.createNew) {
    opts.onProgress?.(`Creating repository ${owner}/${repo}…`);
    const createEndpoint =
      owner.toLowerCase() === me.login.toLowerCase() ? '/user/repos' : `/orgs/${owner}/repos`;
    await ghFetch(
      token,
      createEndpoint,
      {
        method: 'POST',
        body: JSON.stringify({
          name: repo,
          private: opts.isPrivate,
          auto_init: true,
          description: 'Built with Kalpa',
        }),
      },
      'repository creation'
    );
  }

  opts.onProgress?.('Checking repository & branch state…');
  const repoInfo = await ghFetch<{ html_url: string; default_branch: string }>(
    token,
    `/repos/${owner}/${repo}`,
    { method: 'GET' },
    'repository lookup'
  );

  let parentCommitSha: string | null = null;
  let parentTreeSha: string | null = null;
  let targetRefExists = false;

  const tryReadBranch = async (bName: string) => {
    const ref = await ghFetch<{ object: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(bName)}`,
      { method: 'GET' },
      `branch lookup (${bName})`
    );
    const commit = await ghFetch<{ sha: string; tree: { sha: string } }>(
      token,
      `/repos/${owner}/${repo}/git/commits/${ref.object.sha}`,
      { method: 'GET' },
      'commit lookup'
    );
    return commit;
  };

  try {
    const commit = await tryReadBranch(branch);
    parentCommitSha = commit.sha;
    parentTreeSha = commit.tree.sha;
    targetRefExists = true;
  } catch {
    // Target branch may not exist yet; check default branch or initialize empty repo
    try {
      const defCommit = await tryReadBranch(repoInfo.default_branch || 'main');
      parentCommitSha = defCommit.sha;
      parentTreeSha = defCommit.tree.sha;
    } catch {
      // Completely empty repository (0 commits): seed initial README via Contents API so Git Data API unlocks
      opts.onProgress?.('Initializing empty Git repository…');
      await ghFetch(
        token,
        `/repos/${owner}/${repo}/contents/README.md`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: 'Initial commit',
            content: utf8ToBase64(`# ${repo}\n`),
            branch,
          }),
        },
        'empty repository initialization'
      );
      const seeded = await tryReadBranch(branch);
      parentCommitSha = seeded.sha;
      parentTreeSha = seeded.tree.sha;
      targetRefExists = true;
    }
  }

  // Upload blobs in parallel with concurrency = 6
  const treeItems: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
  let completedBlobs = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < filesToPush.length) {
      const idx = cursor++;
      const file = filesToPush[idx];
      const b64 = file.encoding === 'base64' ? file.content : utf8ToBase64(file.content);
      const blob = await ghFetch<{ sha: string }>(
        token,
        `/repos/${owner}/${repo}/git/blobs`,
        {
          method: 'POST',
          body: JSON.stringify({ content: b64, encoding: 'base64' }),
        },
        `uploading ${file.path}`
      );
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
      completedBlobs++;
      opts.onProgress?.(`Uploading blobs (${completedBlobs}/${filesToPush.length})…`);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(BLOB_CONCURRENCY, filesToPush.length) }, () => worker())
  );

  opts.onProgress?.('Creating Git tree & commit…');
  const treePayload: Record<string, unknown> = {
    tree: treeItems,
  };
  if (!opts.mirrorDeletions && parentTreeSha) {
    treePayload.base_tree = parentTreeSha;
  }

  const createdTree = await ghFetch<{ sha: string }>(
    token,
    `/repos/${owner}/${repo}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify(treePayload),
    },
    'tree creation'
  );

  const createdCommit = await ghFetch<{ sha: string; html_url?: string }>(
    token,
    `/repos/${owner}/${repo}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: opts.commitMessage.trim() || 'Update from Kalpa',
        tree: createdTree.sha,
        parents: parentCommitSha ? [parentCommitSha] : [],
      }),
    },
    'commit creation'
  );

  opts.onProgress?.(`Updating branch ${branch}…`);
  if (targetRefExists) {
    await ghFetch(
      token,
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ sha: createdCommit.sha, force: false }),
      },
      'branch update'
    );
  } else {
    await ghFetch(
      token,
      `/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: createdCommit.sha,
        }),
      },
      'branch creation'
    );
  }

  return {
    repoFullName: `${owner}/${repo}`,
    repoUrl: repoInfo.html_url || `https://github.com/${owner}/${repo}`,
    commitSha: createdCommit.sha,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${createdCommit.sha}`,
    filesPushed: filesToPush.length,
  };
}
