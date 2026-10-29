// ===== Kalpa cloud-sandbox helpers (pure, tested) =====
export type ShellKind = 'server' | 'install' | 'build' | 'test' | 'other';
export interface ShellClass { cmd: string; kind: ShellKind; port?: number; timeoutMs: number; background: boolean }

const DEFAULT_PORTS: [RegExp, number][] = [
  [/\bvite\b/, 5173], [/\bnext\b/, 3000], [/\bastro\b/, 4321], [/\bnuxt\b/, 3000], [/\bng\s+serve\b/, 4200],
  [/\bflask\b/, 5000], [/\b(uvicorn|gunicorn|fastapi|http\.server|php\s+-S)\b/, 8000], [/\bstreamlit\b/, 8501],
  [/\brails\b/, 3000], [/\b(serve|http-server|live-server)\b/, 3000],
];

/** Split a multi-line shell action into single commands (joins trailing-backslash lines, drops comments/blank lines). */
export function splitShellLines(script: string): string[] {
  const out: string[] = []; let acc = '';
  for (const raw of script.replace(/\r\n/g, '\n').split('\n')) {
    let line = raw.replace(/\s+$/, '');
    if (acc) line = line.trimStart();
    if (!acc && (line.trim() === '' || line.trim().startsWith('#'))) continue;
    if (line.endsWith('\\')) { acc += line.slice(0, -1).trimEnd() + ' '; continue; }
    out.push((acc + line).trim()); acc = '';
  }
  if (acc.trim()) out.push(acc.trim());
  return out;
}

export function classifyShellCommand(cmd: string): ShellClass {
  const c = cmd.trim();
  const portFlag = /(?:--port[ =]|-p\s+|PORT=|:\s*)(\d{2,5})\b/.exec(c);
  const isBuild = /\b(build|tsc|typecheck|lint|compile)\b/.test(c) && !/\b(dev|serve|start)\b/.test(c);
  const isInstall = /^(?:sudo\s+)?(?:(?:npm|yarn|pnpm|bun)\s+(?:i|install|add|ci)\b|pip3?\s+install|python3?\s+-m\s+pip\s+install|apt(?:-get)?\s+install|cargo\s+(?:build|fetch)|go\s+mod\s+download|composer\s+install|bundle\s+install)/.test(c);
  const isTest = /\b(test|pytest|jest|vitest|playwright)\b/.test(c) && !/\b(dev|serve|start)\b/.test(c);
  const isServer =
    /^(?:(?:npm|yarn|pnpm|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)\b)/.test(c) ||
    /^(?:npx\s+)?(?:vite|next|astro|nuxt|remix|svelte-kit|webpack-dev-server|parcel|nodemon|http-server|live-server|serve)(?:\s|$)/.test(c) && !isBuild && !/\b(build|export|lint)\b/.test(c) ||
    /^(?:python3?\s+-m\s+http\.server|flask\s+run|uvicorn|gunicorn|fastapi\s+(?:dev|run)|streamlit\s+run|php\s+-S|rails\s+s(?:erver)?|ng\s+serve)\b/.test(c) ||
    /^(?:[A-Z_]+=\S+\s+)+(?:npm|yarn|pnpm|npx|python3?|flask|uvicorn)\b.*\b(dev|start|serve|run|http\.server)\b/.test(c) && !isBuild;
  if (isServer && !isInstall) {
    let port = portFlag ? Number(portFlag[1]) : undefined;
    if (!port) for (const [re, p] of DEFAULT_PORTS) if (re.test(c)) { port = p; break; }
    return { cmd: c, kind: 'server', port: port ?? 3000, timeoutMs: 0, background: true };
  }
  if (isInstall) return { cmd: c, kind: 'install', timeoutMs: 600_000, background: false };
  if (isBuild) return { cmd: c, kind: 'build', timeoutMs: 300_000, background: false };
  if (isTest) return { cmd: c, kind: 'test', timeoutMs: 300_000, background: false };
  return { cmd: c, kind: 'other', timeoutMs: 180_000, background: false };
}

/** The sandbox returns this text when a Vite dev server refuses the public host name. */
export function detectBlockedHost(body: string): string | null {
  const m = /Blocked request\.\s*This host \("([^"]+)"\) is not allowed/i.exec(body);
  return m ? m[1] : null;
}

export const BEACON_JS = "(function(){var p=function(m){try{m.kalpa='cloud-beacon';parent.postMessage(m,'*')}catch(e){}};window.addEventListener('error',function(e){p({type:'error',message:String(e.message),source:e.filename||'',line:e.lineno||0})});window.addEventListener('unhandledrejection',function(e){p({type:'rejection',message:String((e.reason&&e.reason.message)||e.reason)})});window.addEventListener('load',function(){setTimeout(function(){var r=document.getElementById('root')||document.getElementById('app')||document.getElementById('__next');p({type:'probe',rootChildren:r?r.children.length:-1,textLen:(document.body&&document.body.innerText||'').length})},1500)})})();";

/** Written into the SANDBOX only (never into the user's project): wraps the user's vite config, allows the public host, fixes HMR behind the E2B proxy, injects the error beacon. */
export function viteWrapperConfig(): string {
  return `import { mergeConfig, loadConfigFromFile } from 'vite';
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, undefined, process.cwd());
const userConfig = loaded && loaded.config ? loaded.config : {};
const BEACON = ${JSON.stringify(BEACON_JS)};
export default mergeConfig(userConfig, {
  server: { host: true, allowedHosts: true, hmr: { clientPort: 443, protocol: 'wss' } },
  plugins: [{ name: 'kalpa-beacon', transformIndexHtml() { return [{ tag: 'script', injectTo: 'head-prepend', children: BEACON }]; } }],
});
`;
}
