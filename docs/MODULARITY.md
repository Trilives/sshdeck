# Modularity Constraints

This document defines when and how to split code in this project into new module files, to avoid "the main program / a single module keeps getting longer and more bloated."
Read alongside [ARCHITECTURE.md](ARCHITECTURE.md) (current module layout). Check against this document before adding or changing code.

## 1. Layering Principles (clarify responsibility before splitting files)

Backend `src-tauri/src/`:
- **Orchestration/wiring layer**: `lib.rs` (Builder, command registration, AppState wiring), `main.rs` (entry point).
  Only does "wiring" — **no business logic**.
- **Thin command wrapper layer**: `#[tauri::command]` functions in `commands/<domain>.rs`. Only takes parameters, calls state,
  calls pure logic, logs, and shapes the return value. **Does not implement algorithms/parsing/IO details**.
- **Pure logic layer**: top-level modules (`ssh/`, `sshconfig.rs`, `vscode.rs`, `portcheck.rs`, `store.rs`,
  `validate.rs`, `terminal.rs`, …). Independently testable, decoupled from Tauri.

Frontend `frontend/src/`:
- **Orchestration layer**: `App.tsx`. Data loading/polling, all action and dialog state orchestration, theming. Allowed to be
  long, but **orchestration only**.
- **Presentation layer**: `pages/*`, `components/*` (including `dialogs.tsx`, `ui/*`). Receive data and callbacks via props,
  **stay purely presentational** — no direct IPC calls, no cross-page state.
  Keep local interaction and display preferences such as `AppSidebar` width in the component that owns the layout.
- **Shared layer**: `api.ts` (IPC calls), `types.ts` (types), `i18n.ts` (copy).

> Golden rule: once a `#[tauri::command]` file or a React component starts accumulating pure-logic concerns like
> "parsing/encoding/registry lookups/file reads/building SSH args," extract that logic into a pure-logic module and have the
> command/component just call it. `vscode.rs` (pure logic) ↔ `commands/vscode.rs` (thin wrapper) is the reference example.

## 2. When to Start a New Module File (trigger conditions)

Consider splitting when **any one** of these holds:

1. **Line count exceeds its limit.** Every file has a **soft limit** (review and plan a split now) and a
   **hard limit** (do not add more code — split first). Counts are physical lines including comments.

   | File type | Soft limit | Hard limit |
   | --- | --- | --- |
   | Backend pure-logic module (`src-tauri/src/*.rs`, `ssh/*.rs`) | 300 | 500 |
   | Backend command wrapper (`commands/*.rs`) | 150 | 250 |
   | Frontend component / page (`components/*.tsx`, `pages/*.tsx`) | 300 | 500 |
   | Dialog aggregation (`dialogs.tsx`) | 500 | 700 |
   | Shared module (`api.ts`, `types.ts`, `i18n.ts`) | 400 | 700 |
   | Orchestration (`App.tsx`, `lib.rs`) | 600 | 900 |

   - **No file may exceed 800 lines**, except the orchestration layer whose ceiling is **900** — past that it is doing
     more than wiring and must be decomposed.
   - Orchestration files get leeway on *size* only, never on *content*: the moment **business logic** (parsing, IO,
     algorithms, SSH-arg building) appears in `App.tsx` / `lib.rs`, extract it regardless of line count.
   - **Functions**: soft limit **50 lines**, hard limit **80**. A command-wrapper body carrying more than **40 lines**
     of real logic must push that logic into a pure-logic module (see item 5).
2. **A single file carries more than one clear responsibility**: you'd describe it as doing "X **and** Y," "…and also…".
3. **The new addition is a self-contained capability**: it has its own data source/external dependency/failure mode (e.g. "read
   VS Code history and open it" → its own `vscode.rs`, rather than folded into `terminal.rs` or `exec.rs`).
4. **Logic is reused across multiple commands/components**: extract it into a shared module to avoid copy-paste.
5. **The thin wrapper layer gets thick**: a command function body in `commands/<domain>.rs` exceeds ~40 lines of pure logic →
   push it down into a pure-logic module.
6. **A directory accumulates ≥3 similar submodules**: promote it to a directory + `mod.rs` (following `ssh/`).

## 3. How to Split (placement and naming conventions)

Backend:
- Pure logic: add a new **top-level** `src-tauri/src/<domain>.rs`; add `mod <domain>;` in `lib.rs`.
- Commands: add `src-tauri/src/commands/<domain>.rs`; add `pub mod <domain>;` in `commands/mod.rs`, and register it in
  `lib.rs`'s `generate_handler!`.
- Command file names match their pure-logic module (`vscode.rs` ↔ `commands/vscode.rs`) for an easy one-to-one mapping.
- More submodules: create a `<domain>/` directory and re-export via `mod.rs` (as in `ssh/{command,process,probe,keys,…}`).
- Small utilities shared across domains go in `util.rs`; data models go in `model.rs`.

Frontend:
- Keep orchestration logic **in** `App.tsx`; only split out **presentation** into `pages/`, `components/`.
- Dialogs are centralized in `components/dialogs.tsx`; once it gets too large (>500 lines), split it by domain into
  `components/dialogs/<domain>.tsx`.
- Add new IPC calls in `api.ts`, types in `types.ts`, and copy in `i18n.ts` (**add both Chinese and English**).
- Small local sub-components inside a component (e.g. the split button inside `HostCard`) can be defined in place — no need
  for a separate file until they're reused.

## 4. When **Not** to Split (avoid over-fragmentation)

- Used in only one place, < ~50 lines, and not a self-contained capability: leave it where it is.
- If splitting would force jumping between two or three files to follow one flow: that's a sign the boundary was wrong.
- Splitting just to "look tidy": don't. Readability comes before file count.
- Hard-splitting orchestration state out of `App.tsx` in a way that causes props to be threaded through many layers: better to
  leave it in the orchestration layer.

## 5. Pre-commit Checklist

- [ ] Does new logic live in the **pure-logic layer**, with commands/components doing only thin wrapping/presentation?
- [ ] No new business logic added to `lib.rs` / `App.tsx` (wiring/orchestration only)?
- [ ] Do command files and pure-logic modules **map to each other by name**, and are they registered in `commands/mod.rs` + `lib.rs`?
- [ ] No file over its **hard limit** in Section 2 (and none over 800 lines / 900 for orchestration)? No function over 80 lines? Split before adding more.
- [ ] Are new IPC calls/types/copy placed in `api.ts` / `types.ts` / `i18n.ts` respectively (both languages present)?
- [ ] Updated the module list/command table in [ARCHITECTURE.md](ARCHITECTURE.md) accordingly?
