export function bytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
export function parentPath(path: string): string {
  if (/^[A-Za-z]:[\\/]?$/.test(path)) return path;
  if (path.startsWith("\\\\")) {
    const parts = path.split("\\").filter(Boolean);
    return parts.length <= 2 ? path : `\\\\${parts.slice(0, -1).join("\\")}`;
  }
  const separator = path.includes("\\") ? "\\" : "/";
  const index = path.replace(/[\\/]+$/, "").lastIndexOf(separator);
  if (index < 0) return path;
  const result = path.slice(0, index);
  return /^[A-Za-z]:$/.test(result) ? `${result}\\` : result || "/";
}
export function pathCrumbs(path: string): { label: string; path: string }[] {
  if (path.startsWith("\\\\")) {
    const parts = path.split("\\").filter(Boolean);
    return parts
      .map((p, i) => ({
        label: p,
        path: `\\\\${parts.slice(0, i + 1).join("\\")}`,
      }))
      .filter((_, i) => i > 0);
  }
  const local = /^[A-Za-z]:/.test(path);
  const parts = path.split(/[\\/]/).filter(Boolean);
  return [
    ...(local ? [] : [{ label: "/", path: "/" }]),
    ...parts.map((label, i) => ({
      label,
      path: local
        ? `${parts.slice(0, i + 1).join("\\")}${i === 0 ? "\\" : ""}`
        : `/${parts.slice(0, i + 1).join("/")}`,
    })),
  ];
}
