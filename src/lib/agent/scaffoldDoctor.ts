// ===== Kalpa Scaffold Doctor: deterministic, zero-token project completeness check + auto-fix (pure, tested) =====
import { extractImports } from './actions';

export interface DoctorIssue { id: string; status: 'fixed' | 'warn' | 'error'; message: string }
export interface DoctorResult { issues: DoctorIssue[]; changes: Record<string, string | null> } // null = delete file

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'url', 'util', 'crypto', 'stream', 'http', 'https', 'zlib', 'events', 'buffer', 'child_process', 'assert', 'net', 'tls', 'readline', 'process', 'module', 'worker_threads']);

function major(v?: string): number | null { const m = /(\d+)\./.exec((v ?? '').replace(/^[^\d]*/, '') + '.'); return m ? Number(m[1]) : null; }
function pkgName(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~') || spec.startsWith('#') || spec.includes(':')) return null;
  const parts = spec.split('/'); const n = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return NODE_BUILTINS.has(n) ? null : n;
}

export function runScaffoldDoctor(input: Record<string, string>): DoctorResult {
  const files: Record<string, string> = {};
  for (const [p, c] of Object.entries(input)) if (!p.startsWith('.kalpa/')) files[p] = c;
  const changes: Record<string, string | null> = {};
  const issues: DoctorIssue[] = [];
  const write = (p: string, c: string) => { files[p] = c; changes[p] = c; };
  const remove = (p: string) => { delete files[p]; changes[p] = null; };
  const has = (re: RegExp) => Object.keys(files).some(p => re.test(p));
  const find = (base: string) => ['.js', '.cjs', '.mjs', '.ts'].map(e => base + e).find(p => files[p] !== undefined);

  if (files['package.json'] === undefined) return { issues: [{ id: 'no-package-json', status: 'warn', message: 'No package.json (not a Node project).' }], changes };
  let pkg: any;
  try { pkg = JSON.parse(files['package.json']); } catch { return { issues: [{ id: 'package-json-invalid', status: 'error', message: 'package.json is not valid JSON.' }], changes }; }
  const savePkg = () => write('package.json', JSON.stringify(pkg, null, 2) + '\n');
  pkg.dependencies ||= {}; pkg.devDependencies ||= {};
  const allDeps = () => ({ ...pkg.dependencies, ...pkg.devDependencies }) as Record<string, string>;
  const isModule = pkg.type === 'module';
  let pkgDirty = false;
  const addDev = (n: string, v: string) => { if (!allDeps()[n]) { pkg.devDependencies[n] = v; pkgDirty = true; } };
  const addDep = (n: string, v: string) => { if (!allDeps()[n]) { pkg.dependencies[n] = v; pkgDirty = true; } };

  // R1: CommonJS/ESM mismatch in config files
  for (const base of ['tailwind.config', 'postcss.config', 'vite.config']) {
    const p = base + '.js'; const src = files[p]; if (src === undefined) continue;
    const usesCjs = /\bmodule\.exports\b/.test(src); const usesEsm = /^\s*export\s+default\b/m.test(src) || /^\s*import\s/m.test(src);
    if (isModule && usesCjs && !usesEsm) {
      if (/\brequire\s*\(/.test(src)) { remove(p); write(base + '.cjs', src); issues.push({ id: 'cjs-in-esm', status: 'fixed', message: `${p} uses CommonJS but package.json has "type":"module"; renamed to ${base}.cjs.` }); }
      else { write(p, src.replace(/\bmodule\.exports\s*=\s*/, 'export default ')); issues.push({ id: 'cjs-in-esm', status: 'fixed', message: `${p} used module.exports in an ES-module project; converted to export default.` }); }
    } else if (!isModule && usesEsm && !usesCjs) {
      if (/^\s*import\s/m.test(src)) { remove(p); write(base + '.mjs', src); issues.push({ id: 'esm-in-cjs', status: 'fixed', message: `${p} uses ES modules in a CommonJS project; renamed to ${base}.mjs.` }); }
      else { write(p, src.replace(/^\s*export\s+default\s+/m, 'module.exports = ')); issues.push({ id: 'esm-in-cjs', status: 'fixed', message: `${p} used export default in a CommonJS project; converted to module.exports.` }); }
    }
  }

  const css = Object.keys(files).filter(p => /\.css$/.test(p)).map(p => files[p]).join('\n');
  const usesTwDirectives = /@tailwind\s+(base|components|utilities)/.test(css);
  const twVersion = allDeps().tailwindcss; let twMajor = major(twVersion);
  const isNext = !!allDeps().next;
  const isVite = !!allDeps().vite;

  // R4: Tailwind v4 package with v3 directives -> pin v3 (deterministic path)
  if (twVersion && twMajor !== null && twMajor >= 4 && usesTwDirectives && !allDeps()['@tailwindcss/vite'] && !allDeps()['@tailwindcss/postcss']) {
    (pkg.dependencies.tailwindcss ? pkg.dependencies : pkg.devDependencies).tailwindcss = '^3.4.17'; pkgDirty = true; twMajor = 3;
    issues.push({ id: 'tw4-with-v3-syntax', status: 'fixed', message: 'tailwindcss v4 was installed but the CSS uses v3 "@tailwind" directives; pinned tailwindcss to ^3.4.17.' });
  }

  // R2: PostCSS config missing (Tailwind v3 needs it)
  const hasPostcss = !!find('postcss.config') || !!pkg.postcss;
  if (twVersion && (twMajor ?? 3) <= 3 && !hasPostcss) {
    const esm = isModule && !isNext;
    const body = `{\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}`;
    const name = isModule ? (isNext ? 'postcss.config.cjs' : 'postcss.config.js') : 'postcss.config.js';
    write(name, esm ? `export default ${body}\n` : `module.exports = ${body}\n`);
    addDev('postcss', '^8.4.47'); addDev('autoprefixer', '^10.4.20');
    issues.push({ id: 'postcss-missing', status: 'fixed', message: `Tailwind was installed but there was no PostCSS config, so Tailwind never ran (page would be unstyled). Added ${name}.` });
  } else if (twVersion && (twMajor ?? 3) <= 3 && hasPostcss) { addDev('postcss', '^8.4.47'); addDev('autoprefixer', '^10.4.20'); }

  // R3: tailwind config missing
  if (twVersion && (twMajor ?? 3) <= 3 && !find('tailwind.config') && usesTwDirectives) {
    const globs = isNext ? ['./app/**/*.{js,ts,jsx,tsx,mdx}', './pages/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}', './src/**/*.{js,ts,jsx,tsx,mdx}'] : ['./index.html', './src/**/*.{js,ts,jsx,tsx}'];
    const body = `{\n  content: ${JSON.stringify(globs)},\n  theme: { extend: {} },\n  plugins: [],\n}`;
    write(isModule ? 'tailwind.config.js' : 'tailwind.config.js', isModule ? `export default ${body}\n` : `module.exports = ${body}\n`);
    issues.push({ id: 'tailwind-config-missing', status: 'fixed', message: 'Added a minimal tailwind.config.js (content globs).' });
  }

  // R5: tailwind content globs that match nothing
  const twCfg = find('tailwind.config') ?? Object.keys(changes).find(p => /^tailwind\.config\./.test(p));
  if (twCfg && files[twCfg] && !/content\s*:/.test(files[twCfg])) issues.push({ id: 'tailwind-content-missing', status: 'warn', message: `${twCfg} has no "content" setting; Tailwind will generate no utility classes.` });

  // R6: Vite + React without vite config
  if (isVite && !find('vite.config') && (allDeps().react) && !allDeps().vue && !allDeps().svelte) {
    const ts = !!allDeps().typescript || has(/\.tsx?$/);
    write(ts ? 'vite.config.ts' : 'vite.config.js', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`);
    addDev('@vitejs/plugin-react', '^4.3.4');
    issues.push({ id: 'vite-config-missing', status: 'fixed', message: 'Vite project had no vite.config; added one with the React plugin.' });
  }

  // R7: TypeScript without tsconfig (not for Next, which creates it)
  if (!isNext && (allDeps().typescript || has(/\.tsx?$/)) && files['tsconfig.json'] === undefined) {
    write('tsconfig.json', JSON.stringify({ compilerOptions: { target: 'ES2020', useDefineForClassFields: true, lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', skipLibCheck: true, moduleResolution: 'bundler', allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true, noEmit: true, jsx: 'react-jsx', strict: true, noUnusedLocals: false, noUnusedParameters: false, noFallthroughCasesInSwitch: true }, include: ['src', 'vite.config.ts'] }, null, 2) + '\n');
    addDev('typescript', '^5.6.3');
    issues.push({ id: 'tsconfig-missing', status: 'fixed', message: 'TypeScript project had no tsconfig.json; added a Vite-compatible one.' });
  }

  // R8: index.html references a missing root asset
  const html = files['index.html'];
  if (html !== undefined) {
    for (const m of html.matchAll(/(?:href|src)="\/([^"#?]+)"/g)) {
      const a = m[1]; if (/^src\//.test(a)) continue;
      if (files[a] === undefined && files['public/' + a] === undefined) {
        if (a === 'vite.svg') { write('public/vite.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7C5CFF"/><path d="M9 16l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>\n'); issues.push({ id: 'asset-missing', status: 'fixed', message: 'index.html links /vite.svg which did not exist; added a small icon.' }); }
        else issues.push({ id: 'asset-missing', status: 'warn', message: `index.html references /${a} but no such file exists.` });
      }
    }
    // R10: entry script missing
    const entry = /<script[^>]+type="module"[^>]+src="\/?([^"]+)"/.exec(html)?.[1];
    if (entry && files[entry] === undefined) issues.push({ id: 'entry-missing', status: 'error', message: `index.html loads /${entry} but that file does not exist.` });
  }

  // R9: global CSS with tailwind directives that nobody imports
  const cssEntry = Object.keys(files).find(p => /^src\/(index|main|styles|globals?)\.css$/.test(p) && /@tailwind/.test(files[p]));
  if (cssEntry && isVite) {
    const base = cssEntry.split('/').pop()!;
    const imported = Object.keys(files).some(p => /^src\/.*\.(tsx?|jsx?)$/.test(p) && new RegExp(`['"]\\./?${base.replace('.', '\\.')}['"]|['"]\\.\\./${base.replace('.', '\\.')}['"]|['"]/src/${base.replace('.', '\\.')}['"]`).test(files[p]));
    const mainFile = ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx'].find(p => files[p] !== undefined);
    if (!imported && mainFile) { write(mainFile, `import './${base}'\n` + files[mainFile]); issues.push({ id: 'css-not-imported', status: 'fixed', message: `${cssEntry} was never imported; added the import to ${mainFile}.` }); }
  }

  // R11: scripts for Vite projects
  if (isVite) {
    pkg.scripts ||= {};
    for (const [k, v] of [['dev', 'vite'], ['build', 'vite build'], ['preview', 'vite preview']] as const) if (!pkg.scripts[k]) { pkg.scripts[k] = v; pkgDirty = true; issues.push({ id: 'script-missing', status: 'fixed', message: `Added missing npm script "${k}".` }); }
  }

  // R12: imported packages that are not declared
  const declared = new Set(Object.keys(allDeps()));
  const missing = new Set<string>();
  for (const [p, src] of Object.entries(files)) {
    if (!/^(src|app|pages|components|lib)\/.*\.(tsx?|jsx?|mjs)$|^[^/]+\.(tsx?|jsx?|mjs)$/.test(p) || /\.config\./.test(p)) continue;
    for (const s of extractImports(src)) { const n = pkgName(s); if (n && !declared.has(n) && !n.startsWith('virtual')) missing.add(n); }
  }
  for (const n of missing) { pkg.dependencies[n] = 'latest'; pkgDirty = true; }
  if (missing.size) issues.push({ id: 'deps-undeclared', status: 'fixed', message: `Imported but not declared in package.json: ${[...missing].join(', ')} (added with version "latest").` });

  if (pkgDirty || changes['package.json'] !== undefined) {
    for (const k of ['dependencies', 'devDependencies']) { const o = pkg[k]; pkg[k] = Object.fromEntries(Object.keys(o).sort().map(n => [n, o[n]])); }
    savePkg();
  }
  return { issues, changes };
}

export function applyDoctor(files: Record<string, string>, res: DoctorResult): Record<string, string> {
  const out = { ...files };
  for (const [p, c] of Object.entries(res.changes)) { if (c === null) delete out[p]; else out[p] = c; }
  return out;
}
