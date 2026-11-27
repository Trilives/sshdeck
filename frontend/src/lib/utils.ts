import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { HistoryEntry } from "../types";

export function isDirectoryHistory(entry: HistoryEntry) {
  return Boolean(entry.label) && (entry.kind === "vscode" || entry.kind === "terminal-path");
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Browser URL for a forward's listening endpoint; a wildcard bind address (0.0.0.0/::) is treated as 127.0.0.1. */
export function forwardWebUrl(forward: { bindHost?: string; bindPort: string }): string {
  let host = (forward.bindHost ?? "").trim();
  if (host === "" || host === "0.0.0.0" || host === "::" || host === "[::]") host = "127.0.0.1";
  return `http://${host}:${forward.bindPort.trim()}`;
}
