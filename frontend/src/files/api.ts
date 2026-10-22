import { invoke } from "@tauri-apps/api/core";
import type { FileListing, TransferProgress, TransferRequest } from "./types";
export const filesApi = {
  open: (hostId: string, password?: string) =>
    invoke<FileListing>("open_file_session", {
      hostId: hostId || null,
      password: password ?? null,
    }),
  list: (sessionId: string, path: string) =>
    invoke<FileListing>("list_files", { sessionId, path }),
  close: (sessionId: string) =>
    invoke<void>("close_file_session", { sessionId }),
  start: (request: TransferRequest) =>
    invoke<TransferProgress>("start_file_transfer", { request }),
  jobs: () => invoke<TransferProgress[]>("list_file_transfers"),
  cancel: (id: string) => invoke<void>("cancel_file_transfer", { id }),
  setupDirect: (
    sourceSession: string,
    targetSession: string,
    sourcePassword?: string,
    targetPassword?: string,
  ) =>
    invoke<{
      ready: boolean;
      passwordFor: "source" | "target" | null;
      alreadyReady: boolean;
    }>("setup_direct_access", {
      sourceSession,
      targetSession,
      sourcePassword: sourcePassword ?? null,
      targetPassword: targetPassword ?? null,
    }),
};
