# Changelog

## v2.0.0 (December 2025)

### Major Features
- ✅ Full Netflix watch party synchronization with WebRTC video chat
- ✅ Draggable video feeds for local and remote participants
- ✅ Automatic volume control (15% on party start)
- ✅ Smart navigation with party state persistence
- ✅ Server-side state management with host migration
- ✅ Heartbeat monitoring with automatic reconnection

### Architecture Improvements
- Refactored to modular `src/` structure with clear separation of concerns
- Implemented proper WebSocket connection lifecycle management
- Added targeted vs broadcast message routing on server
- Fixed video element selection to exclude extension UI elements
- Enhanced error handling and logging throughout

### Bug Fixes
- Fixed duplicate remote video issues during reconnection
- Fixed "ignoring message not meant for me" errors after navigation
- Fixed sync manager not initializing after navigating to /watch pages
- Fixed ICE candidates being broadcast back to sender
- Fixed WebSocket disconnection after page navigation
- Fixed play/pause/seek events not reaching server after video changes

### Performance
- WebSocket connection now persists across page navigation
- Reduced unnecessary reconnections and JOIN messages
- Optimized sync manager setup/teardown cycle

### Developer Experience
- Comprehensive README with troubleshooting guide
- Clean project structure with no legacy files
- Enhanced logging with consistent prefixes
- Webpack build configuration for easy development
