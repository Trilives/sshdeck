export interface FolderVisit {
  path: string;
  visitedAt: number;
}
const key = (hostId: string) => `sshdeck.file.recent.${hostId || "local"}`;

export function recentFolders(hostId: string): FolderVisit[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(key(hostId)) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is FolderVisit =>
          !!item &&
          typeof item.path === "string" &&
          typeof item.visitedAt === "number",
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

export function recordFolderVisit(hostId: string, path: string) {
  if (!path) return;
  try {
    const visits = [
      { path, visitedAt: Date.now() },
      ...recentFolders(hostId).filter((item) => item.path !== path),
    ].slice(0, 30);
    localStorage.setItem(key(hostId), JSON.stringify(visits));
  } catch {
    /* browsing still works when local storage is unavailable */
  }
}
