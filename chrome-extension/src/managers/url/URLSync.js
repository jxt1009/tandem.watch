export class URLSync {
  constructor(stateManager, onWatchPageChange, onNavigateToWatch, onLeaveWatch, netflixController) {
    this.stateManager = stateManager;
    this.netflixController = netflixController;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
    this.lastVideoEndedTime = 0;
    this.onWatchPageChange = onWatchPageChange || (() => {});
    this.onNavigateToWatch = onNavigateToWatch || (() => {});
    this.onLeaveWatch = onLeaveWatch || (() => {});
    this.handleUrlChange = this.handleUrlChange.bind(this);
  }
  
  handleUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== this.lastUrl) {
      console.log('[URLSync] URL changed from', this.lastUrl, 'to', currentUrl);
      const lastPath = this.lastUrl ? new URL(this.lastUrl).pathname : '';
      const currentPath = new URL(currentUrl).pathname;
      
      // Check if we navigated to a different /watch page or left /watch
      const wasOnWatch = lastPath.startsWith('/watch');
      const wasOnBrowse = lastPath.startsWith('/browse');
      const nowOnWatch = currentPath.startsWith('/watch');
      const watchPageChanged = wasOnWatch && nowOnWatch && lastPath !== currentPath;
      const navigatedToWatch = !wasOnWatch && nowOnWatch;
      const navigatedFromBrowseToWatch = wasOnBrowse && nowOnWatch;
      const leftWatch = wasOnWatch && !nowOnWatch;
      
      this.lastUrl = currentUrl;
      
      // If we navigated from browse to watch, set flag to respect Netflix auto-play
      if (navigatedFromBrowseToWatch) {
        console.log('[URLSync] Navigated from browse to /watch - setting auto-play flag');
        sessionStorage.setItem('tandem_from_browse', 'true');
      }
      
      // If we changed to a different /watch page, reinitialize sync
      if (watchPageChanged) {
        console.log('[URLSync] Watch page changed - triggering sync reinitialization');
        try {
          sessionStorage.setItem('tandem_watch_transition', JSON.stringify({
            from: this.lastUrl,
            to: currentUrl,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn('[URLSync] Failed to record watch transition:', e);
        }
        this.onWatchPageChange();
      }
      
      // If we navigated TO a /watch page from elsewhere, initialize sync
      if (navigatedToWatch) {
        console.log('[URLSync] Navigated to /watch page - triggering sync initialization');
        this.onNavigateToWatch();
      }
      
      // If we left a /watch page, teardown sync
      if (leftWatch) {
        console.log('[URLSync] Left /watch page - triggering sync teardown');
        this.onLeaveWatch();
      }
      
      const state = this.stateManager.getState();
      
      // For watch-to-watch transitions, check if previous video just ended (auto-advance)
      // vs user manually skipping (should broadcast)
      let shouldBroadcastUrl = !watchPageChanged;
      
      if (watchPageChanged && this.netflixController) {
        // Get player state to check if video just ended
        this.netflixController.getPlayerState().then(playerState => {
          const wasAutoAdvance = playerState && playerState.justEnded;
          if (wasAutoAdvance) {
            console.log('[URLSync] Video just ended - this is likely Netflix auto-advance, not broadcasting');
            this.lastVideoEndedTime = Date.now();
          } else {
            console.log('[URLSync] Manual watch-to-watch transition detected, allowing broadcast');
            // Send the URL change if party is active
            if (state.partyActive) {
              console.log('[URLSync] Broadcasting manual episode skip to party:', currentPath);
              this.stateManager.safeSendMessage({ 
                type: 'URL_CHANGE', 
                url: currentUrl 
              });
            }
          }
        }).catch(err => {
          console.warn('[URLSync] Failed to check player state:', err);
          // On error, assume it's safe to broadcast manual changes
          if (state.partyActive && Date.now() - this.lastVideoEndedTime > 5000) {
            console.log('[URLSync] Broadcasting watch-to-watch transition (player state check failed):', currentPath);
            this.stateManager.safeSendMessage({ 
              type: 'URL_CHANGE', 
              url: currentUrl 
            });
          }
        });
        shouldBroadcastUrl = false; // Don't broadcast here, we're checking async
      }
      
      if (state.partyActive && shouldBroadcastUrl) {
        console.log('[URLSync] Broadcasting URL change to party:', currentPath);
        this.stateManager.safeSendMessage({ 
          type: 'URL_CHANGE', 
          url: currentUrl 
        });
      }
      
      // If someone leaves /watch, pause the video for everyone
      if (state.partyActive && leftWatch) {
        console.log('[URLSync] Left /watch page - sending pause to all clients');
        this.stateManager.safeSendMessage({ 
          type: 'PLAY_PAUSE', 
          control: 'pause',
          timestamp: 0
        });
      }
    }
  }
  
  start() { 
    this.lastUrl = window.location.href;
    console.log('[URLSync] Starting URL monitoring, current URL:', this.lastUrl);
    
    // Clear any existing interval and listeners
    this.stop();
    
    // Listen for popstate events (back/forward button, pushState)
    window.addEventListener('popstate', this.handleUrlChange);
    
    // Listen for pushState/replaceState by monkey-patching
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.handleUrlChange();
    };
    
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.handleUrlChange();
    };
    
    // Also poll as a fallback (in case Netflix uses some other navigation method)
    this.urlMonitorInterval = setInterval(() => {
      this.handleUrlChange();
    }, 500);
  }
  
  stop() {
    console.log('[URLSync] Stopping URL monitoring');
    
    if (this.urlMonitorInterval) { 
      clearInterval(this.urlMonitorInterval); 
      this.urlMonitorInterval = null; 
    }
    
    window.removeEventListener('popstate', this.handleUrlChange);
    
    this.lastUrl = null;
  }
  saveState() {
    const state = this.stateManager.getState();
    if (!state.partyActive) return;
    const existing = this.getRestorationState() || {};
    const payload = {
      roomId: state.roomId,
      currentTime: existing.currentTime || null,
      isPlaying: typeof existing.isPlaying === 'boolean' ? existing.isPlaying : null,
      timestamp: Date.now()
    };
    sessionStorage.setItem('tandem_restore', JSON.stringify(payload));
  }
  clearState() { sessionStorage.removeItem('tandem_restore'); }
  getRestorationState() {
    const stored = sessionStorage.getItem('tandem_restore');
    if (!stored) return null;
    try {
      const state = JSON.parse(stored);
      if (Date.now() - state.timestamp < 30000) { return state; }
    } catch (e) { console.error('[tandem] Failed to parse restoration state:', e); }
    return null;
  }
}
