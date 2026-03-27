# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- Install dependencies: `npm install`
- There are currently no npm scripts for build, lint, or tests in `package.json`.
- Syntax-check a changed file: `node --check "F:/Imgbatch/assets/app/main.js"`
- Syntax-check the main app surfaces together:
  - `node --check "F:/Imgbatch/preload.js"`
  - `node --check "F:/Imgbatch/assets/app/main.js"`
  - `node --check "F:/Imgbatch/assets/app/state/store.js"`
  - `node --check "F:/Imgbatch/assets/app/components/AppShell.js"`
  - `node --check "F:/Imgbatch/assets/app/components/TopBar.js"`
  - `node --check "F:/Imgbatch/assets/app/components/ImageQueueList.js"`
  - `node --check "F:/Imgbatch/assets/app/pages/tool-pages.js"`
  - `node --check "F:/Imgbatch/assets/app/services/ztools-bridge.js"`
- Plugin entry metadata lives in `plugin.json`; the plugin is loaded by the host app rather than a repo-local dev server.

## Architecture

This repo is a ZTools/Electron-style image batch-processing plugin.

### Runtime entrypoints

- `plugin.json` declares the plugin entrypoints:
  - `main: index.html`
  - `preload: preload.js`
- `index.html` loads the browser UI from `assets/app/main.js` and styles from `assets/styles/theme.css` and `assets/styles/app.css`.

### Frontend structure

The frontend is plain JS + string-template rendering, not React/Vue.

- `assets/app/main.js`
  - Main controller for the app.
  - Boots settings and launch inputs.
  - Owns event delegation for clicks / input / change / drag / drop.
  - Calls bridge methods in `assets/app/services/ztools-bridge.js`.
  - Re-renders via `subscribe(render)` and `app.innerHTML = renderAppShell(...) + renderNotifications(...)`.
- `assets/app/state/store.js`
  - Global mutable store.
  - Holds active tool, configs, imported assets, notifications, settings, and preview modal state.
  - `applyRunResult(...)` is the key reducer for syncing preload results back into per-asset UI state.
- `assets/app/components/AppShell.js`
  - Top-level shell composition.
  - Renders side nav, top bar, left config page, right queue, and the preview modal overlay.
- `assets/app/components/ImageQueueList.js`
  - Queue row UI and row-level actions.
  - Important detail: queue button state is tool-scoped using `asset.stagedToolId === tool.id`, so results from one tool should not leak into another tool page.
- `assets/app/pages/tool-pages.js`
  - Left-side configuration UI for almost all tools.
  - Uses compact settings-list rendering rather than framework components.
- `assets/app/pages/manual-crop-page.js`
  - Separate flow for manual crop.

### Tool model

`assets/app/config/tools.js` is the source of truth for tool definitions.

Tool `mode` drives the UI shell and processing expectations:
- `preview`: single-image style tools such as compression / format / resize / rotate / crop.
- `sort`: merge-style tools where queue order matters (`merge-pdf`, `merge-image`, `merge-gif`).
- `manual`: dedicated manual crop flow.

### Bridge and host boundary

- `assets/app/services/ztools-bridge.js` is the browser-facing bridge.
- It calls `window.imgbatch`, which is exposed from `preload.js`.
- If the bridge is unavailable, browser fallbacks are minimal and mostly placeholders; real image processing lives in `preload.js`.

### Preload / processing pipeline

`preload.js` is the core processing backend.

It handles:
- Host integration (`window.imgbatch` API)
- Input normalization and launch-file ingestion
- Settings persistence (`imgbatch:settings` in host `dbStorage`)
- Output directory resolution
- Per-run folder creation
- Actual image processing using `sharp`
- PDF generation with `pdf-lib`
- GIF generation with `gifenc`

Important processing helpers:
- `prepareRunPayload(...)`: normalizes assets/config and computes destination/run metadata.
- `normalizeRunConfig(...)`: canonicalizes per-tool config before execution.
- `executeLocalTool(...)`: routes to single-asset or merge processing.
- `executeSingleAssetTool(...)`: applies per-asset transforms for non-merge tools.
- `executeSaveFlow(...)`: copies staged batch results into the final save location.

### Output model

There are two distinct concepts in the current code:

1. **Preview-only**
- Triggered from the queue’s `预览效果` action for preview-save tools.
- Intended to process only the selected asset.
- Intended to generate a preview image and open the preview modal.
- Should not create a saveable batch result.

2. **Preview-save (batch processing)**
- Triggered from the top-bar `开始处理` action for preview-save tools.
- Generates staged results for the whole queue.
- After this, queue actions can switch to `保存` and the top bar can show `全部保存`.

Merge tools still use direct output instead of preview/save staging.

### Asset state shape

Per-asset UI state in `store.js` includes:
- `previewStatus`
- `previewUrl`
- `stagedOutputPath`
- `stagedOutputName`
- `stagedSizeBytes`
- `stagedWidth` / `stagedHeight`
- `savedOutputPath`
- `runId`
- `runFolderName`
- `stagedToolId`
- `saveSignature`

When changing preview/save behavior, verify both:
- how preload returns processed items
- how `applyRunResult(...)` maps them into asset state

### Current UX-sensitive areas

These flows are tightly coupled and should be changed together:
- `preload.js` preview/save modes
- `assets/app/main.js` action routing for `preview-asset`, `process-current`, `save-asset-result`, `save-all-results`
- `assets/app/state/store.js` result-state transitions
- `assets/app/components/ImageQueueList.js` button labels and result metadata
- `assets/app/components/AppShell.js` preview modal rendering

### Styling

- `assets/styles/theme.css` defines design tokens.
- `assets/styles/app.css` contains almost all layout/component styling, including the compact settings layout and preview modal.

## Repository-specific notes

- There is no README, no Cursor rules, and no Copilot instructions file in the repository root at the time this file was created.
- The repo currently relies on direct file edits plus `node --check` for validation; future instances should not assume a test or build pipeline exists.
