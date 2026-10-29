import type { SandboxSession } from './provider';
import { viteWrapperConfig } from './shellClass';
import { SANDBOX_ONLY_MARKER } from './sync';

export interface PreparedHostLaunch {
  command: string;
  fallbackCommand?: string;
  hostNote?: string;
}

async function readInstalledMajorVersion(
  session: SandboxSession,
  pkgName: string
): Promise<number | null> {
  try {
    const raw = await session.readFile(`node_modules/${pkgName}/package.json`);
    const parsed = JSON.parse(raw) as { version?: string };
    const m = /^(\d+)/.exec((parsed.version || '').trim());
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function parseDepsAndScripts(snapshot: Record<string, string>): {
  deps: Record<string, string>;
  scripts: Record<string, string>;
} {
  if (!snapshot['package.json']) return { deps: {}, scripts: {} };
  try {
    const pkg = JSON.parse(snapshot['package.json']) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    return {
      deps: { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) },
      scripts: { ...(pkg.scripts ?? {}) },
    };
  } catch {
    return { deps: {}, scripts: {} };
  }
}

async function patchNext15ConfigInSandbox(
  session: SandboxSession,
  snapshot: Record<string, string>,
  publicHost: string
): Promise<void> {
  const candidates = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
  const found = candidates.find((c) => c in snapshot);
  const originsLiteral = JSON.stringify(['*.e2b.app', publicHost]);

  if (!found) {
    await session.writeFiles([
      {
        path: 'next.config.mjs',
        content: `${SANDBOX_ONLY_MARKER}\nconst nextConfig = { allowedDevOrigins: ${originsLiteral} };\nexport default nextConfig;\n`,
      },
    ]);
    return;
  }

  const orig = snapshot[found];
  if (orig.includes('allowedDevOrigins')) return;

  if (found.endsWith('.cjs') || /module\.exports\s*=/.test(orig)) {
    await session.writeFiles([
      {
        path: '.kalpa-next-user.cjs',
        content: orig,
      },
      {
        path: found,
        content: `${SANDBOX_ONLY_MARKER}\nconst u = require('./.kalpa-next-user.cjs');\nmodule.exports = Object.assign({}, u, { allowedDevOrigins: ${originsLiteral} });\n`,
      },
    ]);
    return;
  }

  const ext = found.endsWith('.ts') ? 'ts' : 'mjs';
  await session.writeFiles([
    {
      path: `.kalpa-next-user.${ext}`,
      content: orig,
    },
    {
      path: found,
      content: `${SANDBOX_ONLY_MARKER}\nimport u from './.kalpa-next-user.${ext}';\nexport default { ...(u || {}), allowedDevOrigins: ${originsLiteral} };\n`,
    },
  ]);
}

export async function prepareSandboxHostLaunch(opts: {
  session: SandboxSession;
  snapshot: Record<string, string>;
  baseCommand: string;
  port: number;
  publicHost: string;
}): Promise<PreparedHostLaunch> {
  const { session, snapshot, baseCommand, port, publicHost } = opts;
  const { deps, scripts } = parseDepsAndScripts(snapshot);
  const paths = Object.keys(snapshot);
  const devScript = scripts.dev || '';
  const combinedHint = `${baseCommand} ${devScript}`;

  // 1. Next.js: inspect installed major version inside sandbox
  if ('next' in deps || /\bnext\b/.test(combinedHint) || paths.some((p) => /^next\.config\./.test(p))) {
    const nextMajor = await readInstalledMajorVersion(session, 'next');
    if (nextMajor !== null && nextMajor >= 15) {
      await patchNext15ConfigInSandbox(session, snapshot, publicHost);
    }
    const cmd = /\bnext\b/.test(baseCommand)
      ? baseCommand
      : `npx next dev --hostname 0.0.0.0 --port ${port}`;
    return {
      command: cmd.includes('0.0.0.0') ? cmd : `npx next dev --hostname 0.0.0.0 --port ${port}`,
    };
  }

  // 2. Astro: sandbox-only wrapper merging vite.server.allowedHosts = true
  if ('astro' in deps || /\bastro\b/.test(combinedHint)) {
    const astroMajor = await readInstalledMajorVersion(session, 'astro');
    if (astroMajor !== null) {
      const userCfg = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'].find((c) => c in snapshot);
      const wrapper = userCfg
        ? `import u from './${userCfg}';\nexport default { ...(u || {}), server: { ...(u?.server || {}), host: true, port: ${port} }, vite: { ...(u?.vite || {}), server: { ...(u?.vite?.server || {}), host: true, allowedHosts: true } } };\n`
        : `export default { server: { host: true, port: ${port} }, vite: { server: { host: true, allowedHosts: true } } };\n`;
      await session.writeFiles([{ path: '.kalpa-astro.config.mjs', content: wrapper }]);
      return {
        command: `npx astro dev --config .kalpa-astro.config.mjs --host 0.0.0.0 --port ${port}`,
        fallbackCommand: `npx astro dev --host 0.0.0.0 --port ${port}`,
      };
    }
  }

  // 3. Nuxt: sandbox-only config copy with vite.server.allowedHosts = true
  if ('nuxt' in deps || /\bnuxt|nuxi\b/.test(combinedHint)) {
    const nuxtMajor = await readInstalledMajorVersion(session, 'nuxt');
    if (nuxtMajor !== null) {
      const userNuxt = ['nuxt.config.ts', 'nuxt.config.mjs', 'nuxt.config.js'].find((c) => c in snapshot);
      if (userNuxt && !snapshot[userNuxt].includes('allowedHosts')) {
        await session.writeFiles([
          { path: `.kalpa-${userNuxt}`, content: snapshot[userNuxt] },
          {
            path: userNuxt,
            content: `${SANDBOX_ONLY_MARKER}\nimport u from './.kalpa-${userNuxt}';\nexport default { ...(u || {}), vite: { ...(u?.vite || {}), server: { ...(u?.vite?.server || {}), allowedHosts: true } } };\n`,
          },
        ]);
      }
      return { command: `npx nuxi dev --host 0.0.0.0 --port ${port}` };
    }
  }

  // 4. SvelteKit or Vite: write .kalpa-vite.config.mjs into SANDBOX ONLY
  const hasVite =
    'vite' in deps ||
    '@sveltejs/kit' in deps ||
    /\bvite\b/.test(combinedHint) ||
    paths.some((p) => /^vite\.config\./.test(p));
  if (hasVite) {
    await session.writeFiles([{ path: '.kalpa-vite.config.mjs', content: viteWrapperConfig() }]);
    return {
      command: `npx vite --config .kalpa-vite.config.mjs --host 0.0.0.0 --port ${port} --strictPort`,
      fallbackCommand: `npx vite --host 0.0.0.0 --port ${port}`,
    };
  }

  // 5. CRA / webpack-dev-server
  const craMajor = await readInstalledMajorVersion(session, 'react-scripts');
  const wdsMajor = await readInstalledMajorVersion(session, 'webpack-dev-server');
  if (
    craMajor !== null ||
    wdsMajor !== null ||
    /\b(react-scripts|webpack-dev-server)\b/.test(combinedHint)
  ) {
    const cleanCmd = baseCommand.replace(/^(?:[A-Z_]+=\S+\s+)+/, '');
    return {
      command: `DANGEROUSLY_DISABLE_HOST_CHECK=true WDS_SOCKET_PORT=443 HOST=0.0.0.0 PORT=${port} ${cleanCmd}`,
    };
  }

  // 6. Angular CLI: inspect installed @angular/cli major version inside sandbox
  if ('@angular/cli' in deps || '@angular/core' in deps || /\bng\s+serve\b/.test(combinedHint)) {
    const ngMajor = await readInstalledMajorVersion(session, '@angular/cli');
    const hostFlag = ngMajor !== null && ngMajor >= 17 ? '--allowed-hosts all' : '--disable-host-check';
    return {
      command: `npx ng serve --host 0.0.0.0 --port ${port} ${hostFlag}`,
    };
  }

  // 7. Python Django / Flask / FastAPI / http.server
  if (/\bmanage\.py\s+runserver\b/.test(baseCommand) || paths.some((p) => p.endsWith('settings.py'))) {
    const settingsPath = paths.find((p) => p.endsWith('settings.py'));
    const settingsText = settingsPath ? snapshot[settingsPath] || '' : '';
    if (/DJANGO_ALLOWED_HOSTS/.test(settingsText)) {
      const bound = /\d+\.\d+\.\d+\.\d+:\d+/.test(baseCommand)
        ? baseCommand
        : `${baseCommand} 0.0.0.0:${port}`;
      return { command: `DJANGO_ALLOWED_HOSTS=* ${bound}` };
    }
    if (/\bmanage\.py\s+runserver\b/.test(baseCommand)) {
      const bound = /\d+\.\d+\.\d+\.\d+:\d+/.test(baseCommand)
        ? baseCommand
        : `${baseCommand} 0.0.0.0:${port}`;
      return {
        command: bound,
        hostNote: `Django note: ensure ALLOWED_HOSTS = ['*'] or '*.e2b.app' in ${settingsPath || 'settings.py'} for public preview host ${publicHost}.`,
      };
    }
  }

  if (/^python3?\s+-m\s+http\.server\b/.test(baseCommand) && !baseCommand.includes('--bind')) {
    return { command: `${baseCommand} --bind 0.0.0.0` };
  }
  if (/^uvicorn\b/.test(baseCommand) && !baseCommand.includes('--host')) {
    return { command: `${baseCommand} --host 0.0.0.0 --port ${port}` };
  }
  if (/^flask\s+run\b/.test(baseCommand) && !baseCommand.includes('--host')) {
    return { command: `${baseCommand} --host=0.0.0.0 --port=${port}` };
  }

  return { command: baseCommand };
}

export async function applyEmergencyBlockedHostFix(opts: {
  session: SandboxSession;
  snapshot: Record<string, string>;
  currentCommand: string;
  port: number;
  publicHost: string;
}): Promise<string> {
  const { session, snapshot, currentCommand, port, publicHost } = opts;
  const viteMajor = await readInstalledMajorVersion(session, 'vite');
  if (viteMajor !== null) {
    await session.writeFiles([{ path: '.kalpa-vite.config.mjs', content: viteWrapperConfig() }]);
    return `npx vite --config .kalpa-vite.config.mjs --host 0.0.0.0 --port ${port} --strictPort`;
  }
  const nextMajor = await readInstalledMajorVersion(session, 'next');
  if (nextMajor !== null && nextMajor >= 15) {
    await patchNext15ConfigInSandbox(session, snapshot, publicHost);
    return currentCommand;
  }
  const clean = currentCommand.replace(/^(?:[A-Z_]+=\S+\s+)+/, '');
  return `DANGEROUSLY_DISABLE_HOST_CHECK=true HOST=0.0.0.0 PORT=${port} ${clean}`;
}
