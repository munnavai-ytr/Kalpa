export const MEMORY_MAX_CHARS = 12000;

export const BRAIN_DIR = '.kalpa';
export const BRAIN_INDEX_PATH = '.kalpa/index.json';

export const BRAIN_MEMORY_FILES = [
  'brief',
  'architecture',
  'conventions',
  'decisions',
  'tasks',
  'known-issues',
  'changelog',
  'summary',
] as const;

export type BrainMemoryFile = (typeof BRAIN_MEMORY_FILES)[number];

export function isValidMemoryFile(name: string): name is BrainMemoryFile {
  const clean = name.trim().replace(/\.md$/i, '');
  return (BRAIN_MEMORY_FILES as readonly string[]).includes(clean);
}

export function normalizeMemoryFileName(name: string): BrainMemoryFile | null {
  const clean = name.trim().replace(/^\.kalpa\//, '').replace(/\.md$/i, '');
  return isValidMemoryFile(clean) ? clean : null;
}

export function memoryFileToPath(file: BrainMemoryFile): string {
  return `${BRAIN_DIR}/${file}.md`;
}

export function isBrainPath(path: string): boolean {
  const norm = path.replace(/^\/+/, '');
  return norm === BRAIN_DIR || norm.startsWith(`${BRAIN_DIR}/`);
}

export function isReadOnlyBrainPath(path: string): boolean {
  const norm = path.replace(/^\/+/, '');
  return norm === BRAIN_INDEX_PATH;
}

export function filterOutBrainFiles<T extends Record<string, string>>(snapshot: T): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (!isBrainPath(k)) {
      out[k] = v;
    }
  }
  return out;
}
