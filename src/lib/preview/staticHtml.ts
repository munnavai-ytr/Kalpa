import { resolveRelativePath } from '@/lib/vfs/paths';

function buildStaticShim(expectedHash: string): string {
  const safeHash = JSON.stringify(expectedHash);
  return `<script>
(function(){
  function send(level, args, file, line) {
    try {
      var msg = Array.prototype.slice.call(args).map(function(x){
        if (typeof x === 'string') return x;
        if (x instanceof Error) return x.stack || x.message;
        try { return JSON.stringify(x); } catch (_) { return String(x); }
      }).join(' ');
      parent.postMessage({ source: 'kalpa-static-preview', level: level, message: msg, file: file, line: line }, '*');
    } catch (_) {}
  }
  ['log','info','warn','error'].forEach(function(lv){
    var orig = console[lv];
    console[lv] = function(){
      send(lv, arguments);
      if (orig) orig.apply(console, arguments);
    };
  });
  window.addEventListener('error', function(e){
    send('error', [e.message || 'Runtime error'], e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', function(e){
    send('error', ['Unhandled rejection: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)]);
  });
  function notifyReady(){
    try { parent.postMessage({ kalpa: 'preview-ready', filesHash: ${safeHash} }, '*'); } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', notifyReady, { once: true });
  } else {
    setTimeout(notifyReady, 0);
  }
})();
</script>`;
}

export function buildStaticHtmlDocument(
  files: Record<string, string>,
  expectedHash = '',
  entryHint?: string
): string {
  const entryPath =
    (entryHint && files[entryHint] !== undefined && entryHint.endsWith('.html') ? entryHint : null) ??
    (files['index.html'] !== undefined ? 'index.html' : null) ??
    (files['public/index.html'] !== undefined ? 'public/index.html' : null) ??
    Object.keys(files).find((p) => p.endsWith('.html') && !p.startsWith('.kalpa/')) ??
    'index.html';

  const entryDir = entryPath.includes('/') ? entryPath.split('/').slice(0, -1).join('/') : '';
  let html = files[entryPath] ?? '<!DOCTYPE html><html><body></body></html>';

  // Inline local <link rel="stylesheet" href="...">
  html = html.replace(
    /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (fullMatch, href: string) => {
      if (/^(https?:|\/\/|data:)/i.test(href)) return fullMatch;
      const cleanPath = resolveRelativePath(entryDir, href.split('?')[0]);
      const css = files[cleanPath];
      if (css === undefined) return fullMatch;
      return `<style data-kalpa-href="${cleanPath}">\n${css}\n</style>`;
    }
  );

  // Inline local <script src="..."></script>
  html = html.replace(
    /<script\b([^>]*)src=["']([^"']+)["']([^>]*)><\/script>/gi,
    (fullMatch, before: string, src: string, after: string) => {
      if (/^(https?:|\/\/|data:)/i.test(src)) return fullMatch;
      const cleanPath = resolveRelativePath(entryDir, src.split('?')[0]);
      const js = files[cleanPath];
      if (js === undefined) return fullMatch;
      return `<script${before}${after} data-kalpa-src="${cleanPath}">\n${js}\n</script>`;
    }
  );

  const shim = buildStaticShim(expectedHash);
  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b[^>]*>/i, (m) => `${m}\n${shim}`);
  } else {
    html = `${shim}\n${html}`;
  }

  return html;
}
