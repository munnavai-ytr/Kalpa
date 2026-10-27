/* Kalpa Pyodide Web Worker — Pinned Pyodide v0.26.4 via jsDelivr */
const PYODIDE_INDEX = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const PYODIDE_SCRIPT = `${PYODIDE_INDEX}pyodide.js`;

let pyodideReadyPromise = null;

async function ensurePyodide() {
  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      self.postMessage({ type: 'status', message: 'Loading Python runtime (Pyodide v0.26.4)…' });
      self.importScripts(PYODIDE_SCRIPT);
      const py = await self.loadPyodide({ indexURL: PYODIDE_INDEX });
      self.postMessage({ type: 'status', message: 'Python 3.12 runtime ready.' });
      return py;
    })();
  }
  return pyodideReadyPromise;
}

function syncWorkspace(py, files) {
  const FS = py.FS;
  try {
    FS.mkdirTree('/workspace');
  } catch {
    // already exists
  }

  for (const [relPath, content] of Object.entries(files || {})) {
    const clean = String(relPath).replace(/^\/+/, '');
    if (!clean || clean.endsWith('/.gitkeep')) continue;
    const fullPath = `/workspace/${clean}`;
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = fullPath.slice(0, lastSlash);
      try {
        FS.mkdirTree(dir);
      } catch {
        // ignore
      }
    }
    FS.writeFile(fullPath, String(content), { encoding: 'utf8' });
  }
}

function collectWorkspaceTextFiles(py) {
  const FS = py.FS;
  const out = {};
  function walk(dir, prefix) {
    let entries = [];
    try {
      entries = FS.readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === '.' || name === '..' || name === '__pycache__') continue;
      const full = `${dir}/${name}`;
      const rel = prefix ? `${prefix}/${name}` : name;
      let stat;
      try {
        stat = FS.stat(full);
      } catch {
        continue;
      }
      if (FS.isDir(stat.mode)) {
        walk(full, rel);
      } else if (stat.size <= 512 * 1024) {
        try {
          out[rel] = FS.readFile(full, { encoding: 'utf8' });
        } catch {
          // binary file, skip text sync
        }
      }
    }
  }
  walk('/workspace', '');
  return out;
}

self.onmessage = async (event) => {
  const { id, action, file, code, files, packages } = event.data || {};
  try {
    const py = await ensurePyodide();

    py.setStdout({
      batched: (line) => self.postMessage({ id, type: 'stdout', line }),
    });
    py.setStderr({
      batched: (line) => self.postMessage({ id, type: 'stderr', line }),
    });

    if (action === 'ping') {
      const ver = await py.runPythonAsync('import sys; sys.version.split()[0]');
      self.postMessage({ id, type: 'done', result: String(ver) });
      return;
    }

    if (action === 'pip') {
      self.postMessage({
        id,
        type: 'status',
        message: `Installing pure-Python wheel(s) via micropip: ${(packages || []).join(', ')}…`,
      });
      await py.loadPackage('micropip');
      const micropip = py.pyimport('micropip');
      await micropip.install(packages || []);
      micropip.destroy();
      self.postMessage({
        id,
        type: 'stdout',
        line: `Successfully installed ${(packages || []).join(', ')}`,
      });
      self.postMessage({ id, type: 'done' });
      return;
    }

    syncWorkspace(py, files);

    const bootstrap = `
import os, sys, builtins
os.chdir('/workspace')
if '/workspace' not in sys.path:
    sys.path.insert(0, '/workspace')
for _mname, _mod in list(sys.modules.items()):
    _mfile = getattr(_mod, '__file__', '') or ''
    if _mfile.startswith('/workspace'):
        del sys.modules[_mname]
_kalpa_input_warned = False
def _kalpa_input(prompt=''):
    global _kalpa_input_warned
    if prompt:
        print(prompt, end='')
    if not _kalpa_input_warned:
        _kalpa_input_warned = True
        print('[Note: input() is non-blocking in Instant mode; returning empty string]', file=sys.stderr)
    return ''
builtins.input = _kalpa_input
`;
    await py.runPythonAsync(bootstrap);

    if (file) {
      const cleanFile = String(file).replace(/^\/+/, '');
      const runFileSnippet = `
import runpy
runpy.run_path('/workspace/' + ${JSON.stringify(cleanFile)}, run_name='__main__')
`;
      await py.runPythonAsync(runFileSnippet);
    } else if (typeof code === 'string') {
      await py.runPythonAsync(code);
    }

    const updatedFiles = collectWorkspaceTextFiles(py);
    self.postMessage({ id, type: 'done', updatedFiles });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    self.postMessage({ id, type: 'error', error: message });
  }
};
