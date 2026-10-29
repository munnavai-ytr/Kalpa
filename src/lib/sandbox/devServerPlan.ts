export interface DevServerPlan {
  command: string;
  port: number;
  needsNpmInstall: boolean;
}

export function extractPublicHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || 'localhost';
  }
}

export function hasNpmDependencies(pkgRaw: string | null): boolean {
  if (!pkgRaw) return false;
  try {
    const pkg = JSON.parse(pkgRaw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return (
      Object.keys(pkg.dependencies ?? {}).length > 0 ||
      Object.keys(pkg.devDependencies ?? {}).length > 0
    );
  } catch {
    return false;
  }
}

export function inferDevServerPlan(snapshot: Record<string, string>): DevServerPlan | null {
  const pkgRaw = snapshot['package.json'];
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const devScript = pkg.scripts?.dev || '';

      if (deps.next || devScript.includes('next')) {
        return {
          command: 'npx next dev --hostname 0.0.0.0 --port 3000',
          port: 3000,
          needsNpmInstall: true,
        };
      }
      if (deps.vite || devScript.includes('vite')) {
        return {
          command: 'npx vite --host 0.0.0.0 --port 5173',
          port: 5173,
          needsNpmInstall: true,
        };
      }
      if (deps.astro || devScript.includes('astro')) {
        return {
          command: 'npx astro dev --host 0.0.0.0 --port 4321',
          port: 4321,
          needsNpmInstall: true,
        };
      }
      if (devScript) {
        const portMatch = /--port[ =](\d+)|-p\s+(\d+)|PORT=(\d+)/.exec(devScript);
        const port = portMatch ? Number(portMatch[1] || portMatch[2] || portMatch[3]) : 3000;
        return {
          command: `HOST=0.0.0.0 PORT=${port} npm run dev`,
          port,
          needsNpmInstall: true,
        };
      }
      if (pkg.scripts?.start) {
        return {
          command: 'HOST=0.0.0.0 PORT=3000 npm start',
          port: 3000,
          needsNpmInstall: true,
        };
      }
    } catch {
      // ignore invalid package.json
    }
  }

  if (snapshot['index.html'] !== undefined || snapshot['public/index.html'] !== undefined) {
    const dir = snapshot['index.html'] !== undefined ? '.' : 'public';
    return {
      command: `python3 -m http.server 8000 --bind 0.0.0.0 --directory ${dir}`,
      port: 8000,
      needsNpmInstall: false,
    };
  }

  if (snapshot['app.py'] !== undefined || snapshot['main.py'] !== undefined) {
    const py = snapshot['app.py'] ?? snapshot['main.py'] ?? '';
    if (/fastapi|uvicorn/i.test(py)) {
      const mod = snapshot['app.py'] !== undefined ? 'app:app' : 'main:app';
      return {
        command: `uvicorn ${mod} --host 0.0.0.0 --port 8000`,
        port: 8000,
        needsNpmInstall: false,
      };
    }
    if (/flask/i.test(py)) {
      const entry = snapshot['app.py'] !== undefined ? 'app.py' : 'main.py';
      return {
        command: `FLASK_APP=${entry} flask run --host=0.0.0.0 --port=5000`,
        port: 5000,
        needsNpmInstall: false,
      };
    }
  }

  return null;
}
