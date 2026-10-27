export const MAX_PATH_LENGTH = 255;
export const MAX_PROJECT_FILES = 2000;
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif',
  'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov',
  'pdf', 'zip', 'gz', 'tar', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot',
]);

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'svg',
]);

export type EditorLanguage =
  | 'typescript'
  | 'tsx'
  | 'javascript'
  | 'jsx'
  | 'html'
  | 'css'
  | 'json'
  | 'python'
  | 'markdown'
  | 'text';

export function normalisePath(raw: string): string {
  const cleaned = raw
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .trim();

  if (!cleaned) return '';

  const parts = cleaned.split('/');
  for (const part of parts) {
    if (part === '..' || part === '.') {
      throw new Error(`Invalid path segment "${part}" in "${raw}"`);
    }
    if (/[\x00-\x1f]/.test(part)) {
      throw new Error('Path contains control characters');
    }
  }
  return parts.join('/');
}

export function validatePath(raw: string): string {
  const norm = normalisePath(raw);
  if (!norm) {
    throw new Error('File path cannot be empty');
  }
  if (norm.length > MAX_PATH_LENGTH) {
    throw new Error(`File path exceeds ${MAX_PATH_LENGTH} characters`);
  }
  return norm;
}

export function getExtension(path: string): string {
  const base = path.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(path));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(path));
}

export function mimeFromPath(path: string): string {
  const ext = getExtension(path);
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    avif: 'image/avif',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    json: 'application/json',
    md: 'text/markdown',
    py: 'text/x-python',
    txt: 'text/plain',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function languageFromPath(path: string): EditorLanguage {
  const ext = getExtension(path);
  switch (ext) {
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'tsx':
      return 'tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsx':
      return 'jsx';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
      return 'css';
    case 'json':
      return 'json';
    case 'py':
      return 'python';
    case 'md':
    case 'mdx':
      return 'markdown';
    default:
      return 'text';
  }
}

export function resolveRelativePath(cwd: string, target: string): string {
  const raw = target.replace(/\\/g, '/').trim();
  const stack = raw.startsWith('/')
    ? []
    : cwd
        .replace(/^\/+|\/+$/g, '')
        .split('/')
        .filter(Boolean);

  for (const seg of raw.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return stack.join('/');
}
