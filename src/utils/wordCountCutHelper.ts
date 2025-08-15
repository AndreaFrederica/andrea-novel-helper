// Helper to expose current cut clipboard paths to provider without circular import.
// activate.ts will set this module's internal set reference when cut occurs.

let cutSet: Set<string> | null = null;

export function setCutClipboard(paths: string[] | null) {
  if (!paths || paths.length === 0) {
    cutSet = null;
  } else {
    cutSet = new Set(paths.map(p=>p));
  }
}

export function getCutClipboard(): Set<string> | null {
  return cutSet;
}
