export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isLink: boolean;
  isFile: boolean;
  size: number;
  modified: number;
}
export interface FileListing {
  sessionId: string;
  path: string;
  entries: FileEntry[];
  roots: string[];
}
export type ConflictPolicy = "skip" | "overwrite" | "rename";
export interface TransferRequest {
  sourceSession: string;
  targetSession: string;
  paths: string[];
  destination: string;
  direct: boolean;
  conflict: ConflictPolicy;
}
export interface TransferProgress {
  id: string;
  source: string;
  target: string;
  destination: string;
  status:
    "queued" | "scanning" | "running" | "completed" | "failed" | "cancelled";
  currentFile: string;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  skipped: number;
  speed: number;
  direct: boolean;
  error: string;
}
