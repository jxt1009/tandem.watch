# Architecture Overview (Refactor 2025-11)

This extension is organized under `chrome-extension/src` for maintainability and testability. Legacy files remain temporarily and are imported via thin wrappers to preserve behavior while migrating.

## Structure

- `src/background/`: Background script entry and services wiring.
- `src/content/`: Content script entry and page-specific logic.
- `src/ui/`: Popup and any injected UI.
- `src/managers/`
  - `state/StateManager.js`: Party/session state and safe messaging.
  - `sync/SyncManager.js`: Playback sync orchestration composed from:
    - `sync/lock.js`: local-event suppression lock
    - `sync/debounce.js`: event coalescing
    - `sync/eventListeners.js`: DOM wiring & passive sync timing
    - `sync/remoteHandlers.js`: REQUEST_SYNC / SYNC_RESPONSE / SEEK / PLAY_PAUSE / SYNC_TIME
  - `url/URLSync.js`: URL monitoring and restoration state.
- `src/services/`
  - `content/netflix/NetflixController.js`: Netflix player bridge and controls.
  - `webrtc/WebRTCManager.js`: Adapter to legacy WebRTC manager (to be modularized).
- `src/utils/`: Common helpers (placeholder).
- `src/types/`: Message and event type declarations (placeholder).

## Build

Webpack entries point to `src/*/main.js` adapters which import legacy files while migration proceeds. Outputs are written to `dist/` and assets are copied by `copy-webpack-plugin`.

## Migration Plan

1. Split long modules into focused files (done for SyncManager).
2. Move managers/services into `src`, keep legacy imports working.
3. Modularize WebRTCManager into signaling, reconnection, and UI helpers.
4. Update docs and clean up legacy modules when all consumers are migrated.
