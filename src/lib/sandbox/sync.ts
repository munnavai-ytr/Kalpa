import { vfs } from '@/lib/vfs/vfs';
import type { SandboxSession } from './provider';

const IGNORED_PREFIXES = ['.kalpa/', 'node_modules/', '.next/', '.git/', 'dist/'];
export const SANDBOX_ONLY_MARKER = '/* __KALPA_SANDBOX_ONLY__ */';

export function shouldSyncPathToSandbox(path: string): boolean {
  if (!path || path.endsWith('/.gitkeep')) return false;
  if (path.startsWith('.kalpa-') || path.includes('/.kalpa-')) return false;
  if (path === '.kalpa' || path === 'node_modules' || path === '.next' || path === '.git' || path === 'dist') {
    return false;
  }
  return !IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function syncFullVfsToSandbox(
  projectId: string,
  session: SandboxSession
): Promise<Map<string, string>> {
  const snap = await vfs.snapshot(projectId);
  const syncedMap = new Map<string, string>();
  const batch: { path: string; content: string }[] = [];

  for (const [path, content] of Object.entries(snap)) {
    if (!shouldSyncPathToSandbox(path)) continue;
    syncedMap.set(path, content);
    batch.push({ path, content });
  }

  if (batch.length > 0) {
    await session.writeFiles(batch);
  }
  return syncedMap;
}

export function createDebouncedVfsSync(opts: {
  projectId: string;
  initialMap: Map<string, string>;
  getSession: () => SandboxSession | null;
  onPackageJsonChanged?: () => void;
}): () => void {
  const lastSynced = new Map(opts.initialMap);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let suppressNext = false;

  const flush = async () => {
    timer = null;
    if (suppressNext) {
      suppressNext = false;
      return;
    }
    const session = opts.getSession();
    if (!session) return;

    const snap = await vfs.snapshot(opts.projectId);
    const toWrite: { path: string; content: string }[] = [];
    const toRemove: string[] = [];
    let pkgChanged = false;

    for (const [path, content] of Object.entries(snap)) {
      if (!shouldSyncPathToSandbox(path)) continue;
      if (lastSynced.get(path) !== content) {
        toWrite.push({ path, content });
        lastSynced.set(path, content);
        if (path === 'package.json') pkgChanged = true;
      }
    }

    for (const oldPath of Array.from(lastSynced.keys())) {
      if (!(oldPath in snap)) {
        toRemove.push(oldPath);
        lastSynced.delete(oldPath);
      }
    }

    try {
      if (toWrite.length > 0) await session.writeFiles(toWrite);
      for (const rem of toRemove) await session.remove(rem);
      if (pkgChanged) opts.onPackageJsonChanged?.();
    } catch {
      // session may have expired mid-sync
    }
  };

  const unsub = vfs.subscribe(opts.projectId, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void flush();
    }, 300);
  });

  return () => {
    if (timer) clearTimeout(timer);
    unsub();
  };
}

export async function prepareShellMarker(session: SandboxSession): Promise<void> {
  await session.exec('touch /tmp/kalpa.marker', { timeoutMs: 10_000 });
}

/**
 * Syncs newly created/edited text files (< 200KB, max 50) from the sandbox back to VFS
 * after a <shell> command finishes so VFS remains the single source of truth.
 */
export async function syncSandboxChangesBackToVfs(
  projectId: string,
  session: SandboxSession
): Promise<{ syncedPaths: string[]; warning?: string }> {
  const findCmd =
    "find . -maxdepth 5 -type f -newer /tmp/kalpa.marker " +
    "-not -path './.kalpa/*' -not -name '.kalpa-*' -not -path './node_modules/*' " +
    "-not -path './.next/*' -not -path './.git/*' -not -path './dist/*' " +
    "-size -200k | head -n 55";

  const res = await session.exec(findCmd, { timeoutMs: 15_000 });
  if (res.exitCode !== 0 || !res.stdout.trim()) {
    return { syncedPaths: [] };
  }

  const rawLines = res.stdout
    .split('\n')
    .map((l) => l.trim().replace(/^\.\//, ''))
    .filter((l) => l && shouldSyncPathToSandbox(l));

  const capped = rawLines.slice(0, 50);
  const warning =
    rawLines.length > 50
      ? `Shell command modified more than 50 files; synced the first 50 text files (<200KB) back into VFS.`
      : undefined;

  const currentSnap = await vfs.snapshot(projectId);
  const writes: { path: string; content: string; encoding: 'utf8' }[] = [];

  for (const relPath of capped) {
    try {
      const content = await session.readFile(relPath);
      // Skip binary files containing null bytes or sandbox-only host patches
      if (content.includes('\u0000') || content.includes(SANDBOX_ONLY_MARKER)) continue;
      if (currentSnap[relPath] !== content) {
        writes.push({ path: relPath, content, encoding: 'utf8' });
      }
    } catch {
      // ignore unreadable transient files
    }
  }

  if (writes.length > 0) {
    await vfs.writeMany(projectId, writes);
  }

  return {
    syncedPaths: writes.map((w) => w.path),
    warning,
  };
}
