/* Kalpa JavaScript Execution Web Worker with CommonJS require() */
function formatArg(val) {
  if (typeof val === 'string') return val;
  if (val instanceof Error) return val.stack || val.message;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function normaliseRel(baseDir, spec) {
  const raw = spec.replace(/\\/g, '/');
  const stack = raw.startsWith('/')
    ? []
    : baseDir
        .split('/')
        .filter(Boolean);
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function resolveFile(files, fromDir, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) {
    throw new Error(
      `Cannot require npm package "${spec}" in Instant worker. Use Cloud Sandbox (coming in the next step) for Node npm modules.`
    );
  }
  const base = normaliseRel(fromDir, spec);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    `${base}.json`,
    `${base}/index.js`,
  ];
  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(files, c)) {
      return c;
    }
  }
  throw new Error(`Cannot find module '${spec}'`);
}

self.onmessage = async (event) => {
  const { id, entryFile, code, files = {}, args = [] } = event.data || {};
  const cache = {};
  let pendingTimers = 0;
  let finished = false;

  const postOut = (kind, parts) => {
    self.postMessage({
      id,
      type: kind,
      line: parts.map(formatArg).join(' '),
    });
  };

  const customConsole = {
    log: (...a) => postOut('stdout', a),
    info: (...a) => postOut('stdout', a),
    warn: (...a) => postOut('stderr', a),
    error: (...a) => postOut('stderr', a),
  };

  const origSetTimeout = self.setTimeout.bind(self);
  const origClearTimeout = self.clearTimeout.bind(self);
  const activeTimerIds = new Set();

  let checkComplete = () => {};

  const trackedSetTimeout = (fn, ms, ...rest) => {
    pendingTimers += 1;
    const tid = origSetTimeout(async () => {
      activeTimerIds.delete(tid);
      try {
        await fn(...rest);
      } catch (err) {
        postOut('stderr', [err]);
      } finally {
        pendingTimers -= 1;
        checkComplete();
      }
    }, ms);
    activeTimerIds.add(tid);
    return tid;
  };

  const trackedClearTimeout = (tid) => {
    if (activeTimerIds.delete(tid)) {
      pendingTimers -= 1;
    }
    origClearTimeout(tid);
  };

  const processStub = {
    argv: ['node', entryFile || 'eval.js', ...args],
    env: { NODE_ENV: 'development' },
    cwd: () => '/',
  };

  function loadModule(filePath) {
    if (cache[filePath]) return cache[filePath].exports;
    const src = files[filePath];
    if (src === undefined) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (filePath.endsWith('.json')) {
      const parsed = JSON.parse(src);
      cache[filePath] = { exports: parsed };
      return parsed;
    }
    const mod = { exports: {} };
    cache[filePath] = mod;
    const dir = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
    const localRequire = (spec) => {
      const resolved = resolveFile(files, dir, spec);
      return loadModule(resolved);
    };
    const fn = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      'console',
      'process',
      'setTimeout',
      'clearTimeout',
      src
    );
    const maybePromise = fn(
      mod.exports,
      localRequire,
      mod,
      `/${filePath}`,
      `/${dir}`,
      customConsole,
      processStub,
      trackedSetTimeout,
      trackedClearTimeout
    );
    if (maybePromise && typeof maybePromise.then === 'function') {
      pendingTimers += 1;
      maybePromise
        .catch((e) => postOut('stderr', [e]))
        .finally(() => {
          pendingTimers -= 1;
          checkComplete();
        });
    }
    return mod.exports;
  }

  try {
    if (entryFile) {
      const clean = String(entryFile).replace(/^\/+/, '');
      loadModule(clean);
    } else if (typeof code === 'string') {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const fn = new AsyncFunction(
        'require',
        'console',
        'process',
        'setTimeout',
        'clearTimeout',
        code
      );
      await fn(
        (spec) => loadModule(resolveFile(files, '', spec)),
        customConsole,
        processStub,
        trackedSetTimeout,
        trackedClearTimeout
      );
    }

    await Promise.resolve();
    if (pendingTimers === 0) {
      finished = true;
      self.postMessage({ id, type: 'done' });
    } else {
      checkComplete = () => {
        if (!finished && pendingTimers <= 0) {
          finished = true;
          self.postMessage({ id, type: 'done' });
        }
      };
    }
  } catch (err) {
    finished = true;
    self.postMessage({
      id,
      type: 'error',
      error: err instanceof Error ? err.stack || err.message : String(err),
    });
  }
};
