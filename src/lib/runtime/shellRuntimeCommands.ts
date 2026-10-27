import { resolveRelativePath } from '@/lib/vfs/paths';
import { vfs } from '@/lib/vfs/vfs';
import { installPipPackagesInWorker, runPythonInWorker } from './pyodideWorker';
import { runJsInWorker } from './jsWorker';
import type { ShellContext } from './shellCommands';

export async function runRuntimeOrSearchCommand(
  cmd: string,
  args: string[],
  ctx: ShellContext
): Promise<{ output: string[]; ok: boolean } | null> {
  const out: string[] = [];
  const push = (l: string) => out.push(l);

  switch (cmd) {
    case 'grep': {
      const nonFlags = args.filter((a) => !a.startsWith('-'));
      const flags = args.filter((a) => a.startsWith('-')).join('');
      const showLine = flags.includes('n');
      const pattern = nonFlags[0];
      if (!pattern) {
        ctx.printErr('Usage: grep [-rn] <pattern> [path]');
        return { output: [], ok: false };
      }
      const scope = nonFlags[1] ? resolveRelativePath(ctx.cwd, nonFlags[1]) : ctx.cwd;
      const snap = await vfs.snapshot(ctx.projectId);
      const regex = new RegExp(pattern);
      for (const [path, text] of Object.entries(snap)) {
        if (path.endsWith('/.gitkeep')) continue;
        if (scope && path !== scope && !path.startsWith(`${scope}/`)) continue;
        const lines = text.split('\n');
        lines.forEach((l, i) => {
          if (regex.test(l)) {
            push(`${path}${showLine ? `:${i + 1}` : ''}: ${l}`);
          }
        });
      }
      return { output: out, ok: true };
    }

    case 'find': {
      const term = (args.find((a) => !a.startsWith('-')) ?? '').toLowerCase();
      const all = await vfs.list(ctx.projectId);
      for (const f of all) {
        if (f.path.endsWith('/.gitkeep')) continue;
        if (!term || f.path.toLowerCase().includes(term)) push(f.path);
      }
      return { output: out, ok: true };
    }

    case 'head':
    case 'tail': {
      const nIdx = args.indexOf('-n');
      const count = nIdx >= 0 && Number(args[nIdx + 1]) ? Number(args[nIdx + 1]) : 10;
      const fileArg = args.find((a, i) => !a.startsWith('-') && i !== nIdx + 1);
      if (!fileArg) {
        ctx.printErr(`Usage: ${cmd} [-n count] <file>`);
        return { output: [], ok: false };
      }
      const data = await vfs.read(ctx.projectId, resolveRelativePath(ctx.cwd, fileArg));
      if (!data) {
        ctx.printErr(`${cmd}: ${fileArg}: No such file`);
        return { output: [], ok: false };
      }
      const lines = data.content.split('\n');
      const sliced = cmd === 'head' ? lines.slice(0, count) : lines.slice(-count);
      sliced.forEach(push);
      return { output: out, ok: true };
    }

    case 'wc': {
      const fileArg = args.find((a) => !a.startsWith('-'));
      if (!fileArg) {
        ctx.printErr('Usage: wc <file>');
        return { output: [], ok: false };
      }
      const p = resolveRelativePath(ctx.cwd, fileArg);
      const data = await vfs.read(ctx.projectId, p);
      if (!data) {
        ctx.printErr(`wc: ${fileArg}: No such file`);
        return { output: [], ok: false };
      }
      const lines = data.content.split('\n').length;
      const words = data.content.trim() ? data.content.trim().split(/\s+/).length : 0;
      const bytes = new TextEncoder().encode(data.content).byteLength;
      push(`  ${lines}  ${words}  ${bytes} ${fileArg}`);
      return { output: out, ok: true };
    }

    case 'python':
    case 'python3': {
      const snap = await vfs.snapshot(ctx.projectId);
      const cIdx = args.indexOf('-c');
      let res;
      if (cIdx >= 0 && args[cIdx + 1] !== undefined) {
        res = await runPythonInWorker({
          code: args[cIdx + 1],
          files: snap,
          onStdout: ctx.println,
          onStderr: ctx.printErr,
          onStatus: (m) => ctx.println(`\x1b[90m${m}\x1b[0m`),
        });
      } else if (args[0]) {
        const target = resolveRelativePath(ctx.cwd, args[0]);
        if (!snap[target]) {
          ctx.printErr(`python: can't open file '${args[0]}': No such file`);
          return { output: [], ok: false };
        }
        res = await runPythonInWorker({
          file: target,
          files: snap,
          onStdout: ctx.println,
          onStderr: ctx.printErr,
          onStatus: (m) => ctx.println(`\x1b[90m${m}\x1b[0m`),
        });
      } else {
        ctx.printErr('Usage: python <file.py> or python -c "code"');
        return { output: [], ok: false };
      }
      if (!res.ok && res.error) {
        ctx.printErr(res.error);
        return { output: [], ok: false };
      }
      if (res.updatedFiles) {
        const changed = Object.entries(res.updatedFiles).filter(([k, v]) => snap[k] !== v);
        if (changed.length > 0) {
          await vfs.writeMany(
            ctx.projectId,
            changed.map(([path, content]) => ({ path, content, encoding: 'utf8' }))
          );
        }
      }
      return { output: [], ok: true };
    }

    case 'pip': {
      if (args[0] !== 'install' || args.length < 2) {
        ctx.printErr('Usage: pip install <pure-python-package>');
        return { output: [], ok: false };
      }
      const pkgs = args.slice(1).filter((a) => !a.startsWith('-'));
      const res = await installPipPackagesInWorker(pkgs, {
        onStdout: ctx.println,
        onStderr: ctx.printErr,
        onStatus: (m) => ctx.println(`\x1b[90m${m}\x1b[0m`),
      });
      if (!res.ok && res.error) {
        ctx.printErr(`pip install failed (micropip supports pure-Python wheels only): ${res.error}`);
        return { output: [], ok: false };
      }
      return { output: [], ok: true };
    }

    case 'node': {
      if (!args[0]) {
        ctx.printErr('Usage: node <file.js>');
        return { output: [], ok: false };
      }
      const snap = await vfs.snapshot(ctx.projectId);
      const entry = resolveRelativePath(ctx.cwd, args[0]);
      if (!snap[entry]) {
        ctx.printErr(`node: cannot find module '/${entry}'`);
        return { output: [], ok: false };
      }
      const res = await runJsInWorker({
        entryFile: entry,
        files: snap,
        args: args.slice(1),
        onStdout: ctx.println,
        onStderr: ctx.printErr,
      });
      if (!res.ok && res.error) {
        ctx.printErr(res.error);
        return { output: [], ok: false };
      }
      return { output: [], ok: true };
    }

    default:
      return null;
  }
}
