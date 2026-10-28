import { APP_NAME, APP_VERSION } from '@/lib/brand';
import { resolveRelativePath } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import { useProjectStore } from '@/stores/project';
import { usePreviewStore } from '@/stores/preview';
import { useUiStore } from '@/stores/ui';
import { formatBytes } from '@/lib/utils';
import { runRuntimeOrSearchCommand } from './shellRuntimeCommands';

export interface ShellContext {
  projectId: string;
  cwd: string;
  setCwd: (next: string) => void;
  history: string[];
  println: (line: string) => void;
  printErr: (line: string) => void;
  clearScreen: () => void;
}

const CLOUD_ONLY_COMMANDS = new Set([
  'npm', 'npx', 'yarn', 'pnpm', 'bun', 'git', 'docker',
  'apt', 'apt-get', 'apk', 'brew', 'cargo', 'rustc',
  'go', 'java', 'javac', 'gcc', 'g++', 'clang', 'make',
  'cmake', 'curl', 'wget', 'ssh', 'scp', 'systemctl', 'ps', 'top',
]);

export const BUILTIN_COMMANDS = [
  'help', 'ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch',
  'rm', 'mv', 'cp', 'tree', 'grep', 'find', 'head', 'tail',
  'wc', 'clear', 'history', 'date', 'env', 'whoami', 'kalpa',
  'preview', 'open', 'python', 'python3', 'pip', 'node',
];

export async function runSingleShellCommand(
  cmd: string,
  args: string[],
  ctx: ShellContext
): Promise<{ output: string[]; ok: boolean }> {
  const out: string[] = [];
  const push = (l: string) => out.push(l);

  if (CLOUD_ONLY_COMMANDS.has(cmd)) {
    ctx.printErr(
      `Command "${cmd}" needs the Cloud Sandbox (real Linux). Switch Engine to Cloud in the top bar or add an E2B key in Settings -> Engines.`
    );
    return { output: [], ok: false };
  }

  const delegated = await runRuntimeOrSearchCommand(cmd, args, ctx);
  if (delegated) return delegated;

  switch (cmd) {
    case 'help': {
      push(`${APP_NAME} Virtual Shell (Instant Engine)`);
      push('File commands : ls [-la], cd, pwd, cat, echo, mkdir [-p], touch, rm [-r], mv, cp, tree');
      push('Search & text : grep [-rn] <pat> [path], find <name>, head, tail, wc');
      push('Runtimes      : python <file> | python -c "code", pip install <pkg>, node <file>');
      push('IDE & system  : open <file>, preview, kalpa version, date, env, whoami, history, clear');
      return { output: out, ok: true };
    }

    case 'pwd':
      push(`/${ctx.cwd}`);
      return { output: out, ok: true };

    case 'whoami':
      push('maker');
      return { output: out, ok: true };

    case 'date':
      push(new Date().toString());
      return { output: out, ok: true };

    case 'env':
      push('SHELL=/bin/kalpa-sh');
      push('ENGINE=instant');
      push(`PWD=/${ctx.cwd}`);
      push('USER=maker');
      return { output: out, ok: true };

    case 'kalpa':
      push(`${APP_NAME} v${APP_VERSION} (Instant Browser Engine)`);
      return { output: out, ok: true };

    case 'clear':
      ctx.clearScreen();
      return { output: [], ok: true };

    case 'history':
      ctx.history.forEach((h, idx) => push(`  ${String(idx + 1).padStart(3, ' ')}  ${h}`));
      return { output: out, ok: true };

    case 'preview':
      usePreviewStore.getState().reloadPreview();
      push('Triggered Instant preview reload.');
      return { output: out, ok: true };

    case 'open': {
      if (!args[0]) {
        ctx.printErr('Usage: open <file>');
        return { output: [], ok: false };
      }
      const p = resolveRelativePath(ctx.cwd, args[0]);
      const item = await vfs.read(ctx.projectId, p);
      if (!item) {
        ctx.printErr(`open: ${p}: No such file`);
        return { output: [], ok: false };
      }
      useProjectStore.getState().openFile(p);
      useUiStore.getState().setActiveIdeTab('code');
      push(`Opened ${p}`);
      return { output: out, ok: true };
    }

    case 'cd': {
      const target = args[0] ? resolveRelativePath(ctx.cwd, args[0]) : '';
      if (!target) {
        ctx.setCwd('');
        return { output: [], ok: true };
      }
      const all = await vfs.list(ctx.projectId);
      const isDir = all.some((f) => f.path.startsWith(`${target}/`));
      if (!isDir) {
        ctx.printErr(`cd: ${args[0]}: No such directory`);
        return { output: [], ok: false };
      }
      ctx.setCwd(target);
      return { output: [], ok: true };
    }

    case 'ls': {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const showAll = flags.includes('a');
      const showLong = flags.includes('l');
      const pathArg = args.find((a) => !a.startsWith('-'));
      const dir = pathArg ? resolveRelativePath(ctx.cwd, pathArg) : ctx.cwd;
      const all = await vfs.list(ctx.projectId);
      const prefix = dir ? `${dir}/` : '';

      const entries = new Map<string, { isDir: boolean; size: number; updatedAt: number }>();
      for (const f of all) {
        if (dir && f.path === dir) {
          entries.set(f.path.split('/').pop()!, { isDir: false, size: f.size, updatedAt: f.updatedAt });
          continue;
        }
        if (!f.path.startsWith(prefix)) continue;
        const rest = f.path.slice(prefix.length);
        const seg = rest.split('/')[0];
        if (!seg || seg === '.gitkeep') continue;
        if (!showAll && seg.startsWith('.')) continue;
        const isSubDir = rest.includes('/');
        const prev = entries.get(seg);
        if (!prev || isSubDir) {
          entries.set(seg, { isDir: isSubDir, size: f.size, updatedAt: f.updatedAt });
        }
      }

      const sorted = Array.from(entries.entries()).sort(([a], [b]) => a.localeCompare(b));
      if (showLong) {
        for (const [name, info] of sorted) {
          const kind = info.isDir ? 'drwxr-xr-x' : '-rw-r--r--';
          const sz = info.isDir ? '-' : formatBytes(info.size);
          push(`${kind}  ${sz.padStart(8, ' ')}  ${info.isDir ? `${name}/` : name}`);
        }
      } else if (sorted.length > 0) {
        push(sorted.map(([name, info]) => (info.isDir ? `\x1b[34m${name}/\x1b[0m` : name)).join('  '));
      }
      return { output: out, ok: true };
    }

    case 'cat': {
      const targets = args.filter((a) => !a.startsWith('-'));
      if (targets.length === 0) {
        ctx.printErr('Usage: cat <file>');
        return { output: [], ok: false };
      }
      for (const t of targets) {
        const p = resolveRelativePath(ctx.cwd, t);
        const file = await vfs.read(ctx.projectId, p);
        if (!file) {
          ctx.printErr(`cat: ${t}: No such file`);
          return { output: out, ok: false };
        }
        file.content.split('\n').forEach(push);
      }
      return { output: out, ok: true };
    }

    case 'echo':
      push(args.join(' '));
      return { output: out, ok: true };

    case 'mkdir': {
      for (const d of args.filter((a) => !a.startsWith('-'))) {
        const p = resolveRelativePath(ctx.cwd, d);
        if (p) await vfs.write(ctx.projectId, `${p}/.gitkeep`, '');
      }
      return { output: [], ok: true };
    }

    case 'touch': {
      for (const t of args.filter((a) => !a.startsWith('-'))) {
        const p = resolveRelativePath(ctx.cwd, t);
        const existing = await vfs.read(ctx.projectId, p);
        await vfs.write(ctx.projectId, p, existing ? existing.content : '');
      }
      return { output: [], ok: true };
    }

    case 'rm': {
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const recursive = flags.includes('r') || flags.includes('R');
      for (const t of args.filter((a) => !a.startsWith('-'))) {
        const p = resolveRelativePath(ctx.cwd, t);
        const exact = await vfs.read(ctx.projectId, p);
        if (!exact && !recursive) {
          ctx.printErr(`rm: cannot remove '${t}': Is a directory or missing (use -r)`);
          return { output: [], ok: false };
        }
        const count = await vfs.remove(ctx.projectId, p);
        if (count === 0 && !flags.includes('f')) {
          ctx.printErr(`rm: ${t}: No such file or directory`);
          return { output: [], ok: false };
        }
      }
      return { output: [], ok: true };
    }

    case 'mv': {
      if (args.length < 2) {
        ctx.printErr('Usage: mv <src> <dest>');
        return { output: [], ok: false };
      }
      await vfs.move(ctx.projectId, resolveRelativePath(ctx.cwd, args[0]), resolveRelativePath(ctx.cwd, args[1]));
      return { output: [], ok: true };
    }

    case 'cp': {
      const targets = args.filter((a) => !a.startsWith('-'));
      if (targets.length < 2) {
        ctx.printErr('Usage: cp <src> <dest>');
        return { output: [], ok: false };
      }
      const data = await vfs.read(ctx.projectId, resolveRelativePath(ctx.cwd, targets[0]));
      if (!data) {
        ctx.printErr(`cp: ${targets[0]}: No such file`);
        return { output: [], ok: false };
      }
      await vfs.write(ctx.projectId, resolveRelativePath(ctx.cwd, targets[1]), data.content, data.encoding);
      return { output: [], ok: true };
    }

    case 'tree': {
      const all = await vfs.list(ctx.projectId);
      const prefix = ctx.cwd ? `${ctx.cwd}/` : '';
      const paths = all
        .map((f) => f.path)
        .filter((p) => !p.endsWith('/.gitkeep') && p.startsWith(prefix))
        .map((p) => p.slice(prefix.length));
      push('.');
      paths.forEach((p, idx) => {
        push(`${idx === paths.length - 1 ? '└── ' : '├── '}${p}`);
      });
      return { output: out, ok: true };
    }

    default:
      ctx.printErr(`kalpa-sh: command not found: ${cmd}. Type 'help' for supported commands.`);
      return { output: [], ok: false };
  }
}
