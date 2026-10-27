export interface NextLiteRoute {
  pattern: string;
  regexSource: string;
  paramNames: { name: string; catchAll: boolean }[];
  pageFile: string;
  layoutFiles: string[];
  loadingFile?: string;
}

export interface UnsupportedNextFeature {
  file: string;
  reason: string;
}

export interface NextLiteAnalysis {
  appDir: string;
  routes: NextLiteRoute[];
  rootNotFoundFile?: string;
  unsupported: UnsupportedNextFeature[];
}

function findSegmentFile(
  paths: Set<string>,
  dir: string,
  stem: string
): string | undefined {
  const exts = ['tsx', 'ts', 'jsx', 'js'];
  for (const ext of exts) {
    const candidate = dir ? `${dir}/${stem}.${ext}` : `${stem}.${ext}`;
    if (paths.has(candidate)) return candidate;
  }
  return undefined;
}

function buildPatternAndRegex(segments: string[]): {
  pattern: string;
  regexSource: string;
  paramNames: { name: string; catchAll: boolean }[];
} {
  const visible = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')')));
  if (visible.length === 0) {
    return { pattern: '/', regexSource: '^\\/?$', paramNames: [] };
  }

  const paramNames: { name: string; catchAll: boolean }[] = [];
  const regexParts: string[] = [];

  for (const seg of visible) {
    const optCatch = seg.match(/^\[\[\.\.\.([a-zA-Z0-9_]+)\]\]$/);
    if (optCatch) {
      paramNames.push({ name: optCatch[1], catchAll: true });
      regexParts.push('(?:/(.*))?');
      continue;
    }
    const catchAll = seg.match(/^\[\.\.\.([a-zA-Z0-9_]+)\]$/);
    if (catchAll) {
      paramNames.push({ name: catchAll[1], catchAll: true });
      regexParts.push('/(.+)');
      continue;
    }
    const dyn = seg.match(/^\[([a-zA-Z0-9_]+)\]$/);
    if (dyn) {
      paramNames.push({ name: dyn[1], catchAll: false });
      regexParts.push('/([^/]+)');
      continue;
    }
    regexParts.push(`/${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  }

  return {
    pattern: `/${visible.join('/')}`,
    regexSource: `^${regexParts.join('')}\\/?$`,
    paramNames,
  };
}

export function analyzeNextLiteProject(files: Record<string, string>): NextLiteAnalysis {
  const allPaths = Object.keys(files);
  const pathSet = new Set(allPaths);
  const appDir = allPaths.some((p) => p.startsWith('src/app/')) ? 'src/app' : 'app';

  const unsupported: UnsupportedNextFeature[] = [];

  for (const [path, code] of Object.entries(files)) {
    if (/^(src\/)?app\/api\/.*\/route\.(ts|tsx|js|jsx)$/.test(path)) {
      unsupported.push({ file: path, reason: 'API Route Handler' });
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    if (/from\s+['"]next\/(headers|cookies)['"]/.test(code)) {
      unsupported.push({ file: path, reason: 'Uses next/headers or next/cookies' });
    } else if (/^\s*['"]use server['"]/m.test(code)) {
      unsupported.push({ file: path, reason: 'Uses Server Actions ("use server")' });
    } else if (
      new RegExp(`^${appDir}/.*(page|layout)\\.(tsx|ts|jsx|js)$`).test(path) &&
      /export\s+default\s+async\s+function\b/.test(code)
    ) {
      unsupported.push({ file: path, reason: 'Async Server Component' });
    }
  }

  const pageRegex = new RegExp(`^${appDir}/(?:(.*)/)?page\\.(tsx|ts|jsx|js)$`);
  const routes: NextLiteRoute[] = [];

  for (const path of allPaths) {
    const m = path.match(pageRegex);
    if (!m) continue;
    const subDir = m[1] ?? '';
    const rawSegments = subDir ? subDir.split('/').filter(Boolean) : [];

    const layoutFiles: string[] = [];
    const rootLayout = findSegmentFile(pathSet, appDir, 'layout');
    if (rootLayout) layoutFiles.push(rootLayout);

    let acc = appDir;
    for (const seg of rawSegments) {
      acc = `${acc}/${seg}`;
      const lay = findSegmentFile(pathSet, acc, 'layout');
      if (lay) layoutFiles.push(lay);
    }

    const loadingFile = findSegmentFile(pathSet, acc, 'loading');
    const { pattern, regexSource, paramNames } = buildPatternAndRegex(rawSegments);

    routes.push({
      pattern,
      regexSource,
      paramNames,
      pageFile: path,
      layoutFiles,
      loadingFile,
    });
  }

  // Sort static routes before dynamic/catch-all routes
  routes.sort((a, b) => a.paramNames.length - b.paramNames.length || b.pattern.length - a.pattern.length);

  const rootNotFoundFile = findSegmentFile(pathSet, appDir, 'not-found');

  return {
    appDir,
    routes,
    rootNotFoundFile,
    unsupported,
  };
}
