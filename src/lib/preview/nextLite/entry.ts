import type { NextLiteAnalysis } from './routes';

export function buildNextLiteEntryCode(analysis: NextLiteAnalysis): string {
  const imports: string[] = [
    `import React, { Suspense, useEffect, useMemo, useState } from 'react';`,
    `import { createRoot } from 'react-dom/client';`,
    `import { KalpaRouteContext, parseHashUrl } from '/__kalpa/shims/navigation';`,
  ];

  const fileVarMap = new Map<string, string>();
  let counter = 0;

  const ensureImport = (filePath: string) => {
    let varName = fileVarMap.get(filePath);
    if (!varName) {
      counter += 1;
      varName = `Mod_${counter}`;
      fileVarMap.set(filePath, varName);
      imports.push(`import ${varName} from '/${filePath}';`);
    }
    return varName;
  };

  const routeConfigs = analysis.routes.map((r) => {
    const pageVar = ensureImport(r.pageFile);
    const layoutVars = r.layoutFiles.map(ensureImport);
    const loadingVar = r.loadingFile ? ensureImport(r.loadingFile) : null;
    return `{
      pattern: ${JSON.stringify(r.pattern)},
      regex: new RegExp(${JSON.stringify(r.regexSource)}),
      paramNames: ${JSON.stringify(r.paramNames)},
      Page: ${pageVar},
      layouts: [${layoutVars.join(', ')}],
      Loading: ${loadingVar ?? 'null'}
    }`;
  });

  const notFoundVar = analysis.rootNotFoundFile
    ? ensureImport(analysis.rootNotFoundFile)
    : null;

  return `${imports.join('\n')}

const ROUTES = [
  ${routeConfigs.join(',\n  ')}
];

function KalpaNextLiteRoot() {
  const [loc, setLoc] = useState(() => parseHashUrl());

  useEffect(() => {
    const onHash = () => setLoc(parseHashUrl());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const matched = useMemo(() => {
    for (const r of ROUTES) {
      const m = loc.pathname.match(r.regex);
      if (m) {
        const params: Record<string, any> = {};
        r.paramNames.forEach((p: { name: string; catchAll: boolean }, idx: number) => {
          const val = m[idx + 1];
          params[p.name] = p.catchAll ? (val ? val.split('/') : []) : val;
        });
        return { route: r, params };
      }
    }
    return null;
  }, [loc.pathname]);

  const ctxVal = useMemo(() => ({
    pathname: loc.pathname,
    search: loc.search,
    params: matched ? matched.params : {},
    navigate: (href: string, replace?: boolean) => {
      const clean = href.startsWith('#') ? href.slice(1) : href;
      if (replace) window.location.replace('#' + clean);
      else window.location.hash = clean;
    },
  }), [loc.pathname, loc.search, matched]);

  let content: React.ReactNode;
  if (!matched) {
    content = ${
      notFoundVar
        ? `React.createElement(${notFoundVar})`
        : `<div style={{ padding: 32, fontFamily: 'system-ui', color: '#9a9bb4' }}>404 — Route not found ({loc.pathname})</div>`
    };
  } else {
    const { route, params } = matched;
    const PageComp = route.Page;
    let node: React.ReactNode = <PageComp params={params} />;
    if (route.Loading) {
      const LoadComp = route.Loading;
      node = <Suspense fallback={<LoadComp />}>{node}</Suspense>;
    }
    for (let i = route.layouts.length - 1; i >= 0; i--) {
      const LayoutComp = route.layouts[i];
      node = <LayoutComp params={params}>{node}</LayoutComp>;
    }
    content = node;
  }

  return (
    <KalpaRouteContext.Provider value={ctxVal}>
      {content}
    </KalpaRouteContext.Provider>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<KalpaNextLiteRoot />);
}
`;
}
