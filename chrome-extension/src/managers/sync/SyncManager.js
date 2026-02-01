import { SyncLock } from './lock.js';
import { attachPlaybackListeners } from './eventListeners.js';
import { createRemoteHandlers } from './remoteHandlers.js';

class MutableRef {
  constructor(value) { this.value = value; }
  get() { return this.value; }
  set(v) { this.value = v; }
}

export class SyncManager {
  constructor(stateManager, netflixController) {
    this.state = stateManager;
    this.netflix = netflixController;
    this.lock = new SyncLock();
    this.isInitializedRef = new MutableRef(false);
    this.listeners = null;
    this.initialSyncRequestAt = 0;
    this.initialSyncWindowMs = 8000;
    this.lastKnownTimeSeconds = 0;
    this.videoMonitorInterval = null;
    this.activeVideo = null;

    this.remote = createRemoteHandlers({
      state: this.state,
      netflix: this.netflix,
      lock: this.lock,
      isInitializedRef: this.isInitializedRef,
      shouldAcceptLateSync: () => {
        if (!this.initialSyncRequestAt) return false;
        return (Date.now() - this.initialSyncRequestAt) < this.initialSyncWindowMs;
      },
      onInitialSyncApplied: () => {
        this.initialSyncRequestAt = 0;
      }
    });
  }

  async setup() {
    try {
      // Only setup sync manager on /watch pages
      if (!window.location.pathname.startsWith('/watch')) {
        console.log('[SyncManager] Not on /watch page, skipping setup');
        return;
      }
      
      console.log('[SyncManager] Starting setup - waiting for video element...');
      const video = await this.waitForVideo();
      if (!video) { 
        console.warn('[SyncManager] Netflix video element not found'); 
        return; 
      }
      
      console.log('[SyncManager] Video element found, setting up event listeners');
      this.activeVideo = video;
      
      // Check for pending sync from URL navigation
      const pendingSyncStr = sessionStorage.getItem('tandem_pending_sync');
      if (pendingSyncStr) {
        try {
          const pendingSync = JSON.parse(pendingSyncStr);
          if (Date.now() - pendingSync.timestamp < 10000) {
            console.log('[SyncManager] Applying pending sync from URL navigation');
            sessionStorage.removeItem('tandem_pending_sync');
            this.isInitializedRef.set(true);
            this.initialSyncRequestAt = 0;
            
            // Apply the pending sync state
            this.lock.set(1500);
            await this.netflix.seek(pendingSync.currentTime * 1000);
            const isPaused = await this.netflix.isPaused();
            if (pendingSync.isPlaying && isPaused) {
              await this.netflix.play();
            } else if (!pendingSync.isPlaying && !isPaused) {
              await this.netflix.pause();
            }
            
            this.attachListeners(video);
            this.startVideoMonitor();
            console.log('[SyncManager] Setup complete with pending sync applied');
            return;
          } else {
            console.log('[SyncManager] Pending sync expired, ignoring');
            sessionStorage.removeItem('tandem_pending_sync');
          }
        } catch (e) {
          console.error('[SyncManager] Error applying pending sync:', e);
          sessionStorage.removeItem('tandem_pending_sync');
        }
      }
      
      this.isInitializedRef.set(false);
      
      // Check if we just navigated from browse - if so, respect Netflix's natural behavior
      // and become the leader that others sync to
      const fromBrowse = sessionStorage.getItem('tandem_from_browse');
      if (fromBrowse === 'true') {
        console.log('[SyncManager] Just navigated from browse - becoming leader, will broadcast state once video is ready');
        sessionStorage.removeItem('tandem_from_browse');
        // Mark as initialized immediately so we start broadcasting our state
        this.isInitializedRef.set(true);
        this.initialSyncRequestAt = 0;
        
        // Wait for Netflix resume event before broadcasting state
        const broadcastAfterResume = () => {
          let resumed = false;
          let timeoutId = null;
          
          const broadcast = async (source) => {
            if (resumed) return;
            resumed = true;
            
            // Clean up listeners
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('timeupdate', onTimeUpdate);
            if (timeoutId) clearTimeout(timeoutId);
            
            try {
              const currentTime = await this.netflix.getCurrentTime();
              const isPaused = await this.netflix.isPaused();
              const currentTimeSeconds = currentTime != null ? currentTime / 1000 : 0;
              console.log('[SyncManager] Broadcasting initial state as leader from', source + ':', currentTimeSeconds.toFixed(2) + 's', isPaused ? 'paused' : 'playing');
              
              this.state.safeSendMessage({ 
                type: 'PLAY_PAUSE', 
                control: isPaused ? 'pause' : 'play'
              });
            } catch (e) {
              console.error('[SyncManager] Error broadcasting leader state:', e);
            }
          };
          
          // Listen for seeked event (Netflix resuming to saved position)
          const onSeeked = async () => {
            const currentTime = await this.netflix.getCurrentTime();
            if (currentTime != null && currentTime > 5000) {
              console.log('[SyncManager] Detected resume via seeked event at', (currentTime / 1000).toFixed(2) + 's');
              broadcast('seeked');
            }
          };
          
          // Listen for timeupdate as fallback
          const onTimeUpdate = async () => {
            const currentTime = await this.netflix.getCurrentTime();
            if (currentTime != null && currentTime > 5000) {
              console.log('[SyncManager] Detected resume via timeupdate at', (currentTime / 1000).toFixed(2) + 's');
              broadcast('timeupdate');
            }
          };
          
          video.addEventListener('seeked', onSeeked);
          video.addEventListener('timeupdate', onTimeUpdate);
          
          // Fallback timeout (8 seconds)
          timeoutId = setTimeout(() => {
            console.log('[SyncManager] Resume timeout reached, broadcasting current state');
            broadcast('timeout');
          }, 8000);
          
          // Check immediately if already at resume position
          this.netflix.getCurrentTime().then(currentTime => {
            if (currentTime != null && currentTime > 5000) {
              console.log('[SyncManager] Already at resume position:', (currentTime / 1000).toFixed(2) + 's');
              broadcast('immediate');
            }
          });
        };
        
        // Start waiting for resume
        if (video.readyState >= 3) {
          console.log('[SyncManager] Video ready, waiting for Netflix resume event');
          broadcastAfterResume();
        } else {
          console.log('[SyncManager] Waiting for video ready before resume detection');
          const onVideoReady = () => {
            video.removeEventListener('canplay', onVideoReady);
            console.log('[SyncManager] Video ready, waiting for Netflix resume event');
            broadcastAfterResume();
          };
          video.addEventListener('canplay', onVideoReady);
          setTimeout(() => {
            video.removeEventListener('canplay', onVideoReady);
            console.log('[SyncManager] Video ready timeout, starting resume detection anyway');
            broadcastAfterResume();
          }, 3000);
        }
      } else {
        // Wait for video to be ready before requesting sync
        const requestSyncWhenReady = () => {
          console.log('[SyncManager] Video ready - requesting initial sync from other clients');
          this.initialSyncRequestAt = Date.now();
          this.state.safeSendMessage({ type: 'REQUEST_SYNC' });
          
          // If no response after 2 seconds, consider ourselves initialized
          setTimeout(() => {
            if (!this.isInitializedRef.get()) {
              console.log('[SyncManager] No sync response received after 2s, marking as initialized (will still accept late sync briefly)');
              this.isInitializedRef.set(true);
              console.log('[SyncManager] isInitialized is now:', this.isInitializedRef.get());
            } else {
              console.log('[SyncManager] Already initialized, skipping timeout initialization');
            }
          }, 2000);
        };
        
        const onVideoReady = () => {
          console.log('[SyncManager] Video canplay event fired');
          video.removeEventListener('canplay', onVideoReady);
          requestSyncWhenReady();
        };
        
        // If video is already ready, request sync immediately
        if (video.readyState >= 3) { // HAVE_FUTURE_DATA or better
          console.log('[SyncManager] Video already ready (readyState:', video.readyState + ')');
          requestSyncWhenReady();
        } else {
          console.log('[SyncManager] Waiting for video to be ready before requesting sync (readyState:', video.readyState + ')');
          video.addEventListener('canplay', onVideoReady);
          // Fallback timeout
          setTimeout(() => {
            video.removeEventListener('canplay', onVideoReady);
            console.log('[SyncManager] Timeout reached, requesting sync anyway');
            requestSyncWhenReady();
          }, 5000);
        }
      }
      
      this.attachListeners(video);
      this.startVideoMonitor();
      console.log('[SyncManager] Setup complete - ready to sync');
    } catch (err) { 
      console.error('[SyncManager] Error setting up playback sync:', err); 
    }
  }

  attachListeners(video) {
    // Clean up old listeners first (in case of re-setup)
    if (this.listeners && this.listeners.cleanup) {
      try {
        const { handlePlay, handlePause, handleSeeked } = this.listeners;
        if (this.listeners.video) {
          this.listeners.video.removeEventListener('play', handlePlay);
          this.listeners.video.removeEventListener('pause', handlePause);
          this.listeners.video.removeEventListener('seeked', handleSeeked);
        }
        this.listeners.cleanup();
        console.log('[SyncManager] Cleaned up old listeners before attaching new ones');
      } catch (e) {
        console.warn('[SyncManager] Error cleaning up old listeners:', e);
      }
    }

    const listeners = attachPlaybackListeners({
      video,
      state: this.state,
      isInitializedRef: this.isInitializedRef,
      lock: this.lock,
      onPlay: (vid) => this.broadcastPlay(vid),
      onPause: (vid) => this.broadcastPause(vid),
      onSeek: (vid) => this.broadcastSeek(vid),
      onPositionUpdate: (vid) => this.broadcastPosition(vid)
    });
    this.listeners = listeners;
  }

  startVideoMonitor() {
    if (this.videoMonitorInterval) return;
    this.videoMonitorInterval = setInterval(() => {
      if (!this.isOnWatchPage()) return;
      const currentVideo = this.netflix.getVideoElement();
      if (currentVideo && currentVideo !== this.activeVideo) {
        console.log('[SyncManager] Detected new Netflix video element, reattaching listeners');
        this.activeVideo = currentVideo;
        this.attachListeners(currentVideo);
      }
    }, 1000);
  }

  teardown() {
    console.log('[SyncManager] Tearing down sync manager');
    if (this.listeners) {
      const { video, handlePlay, handlePause, handleSeeked, cleanup } = this.listeners;
      try {
        video.removeEventListener('play', handlePlay);
        video.removeEventListener('pause', handlePause);
        video.removeEventListener('seeked', handleSeeked);
        if (cleanup) cleanup(); // Clear the position update interval
        console.log('[SyncManager] Event listeners removed');
      } catch (e) { console.warn('[SyncManager] Error removing listeners:', e); }
      this.listeners = null;
    }
    if (this.videoMonitorInterval) {
      clearInterval(this.videoMonitorInterval);
      this.videoMonitorInterval = null;
    }
    this.activeVideo = null;
    this.isInitializedRef.set(false);
  }

  waitForVideo() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Video element timeout')), 10000);
      const check = () => {
        const video = this.netflix.getVideoElement();
        if (video) { clearTimeout(timeout); resolve(video); }
        else { setTimeout(check, 100); }
      };
      check();
    });
  }

  isOnWatchPage() {
    return window.location.pathname.startsWith('/watch');
  }

  broadcastPlay(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring PLAY event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting PLAY event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'play'
    });
  }

  broadcastPause(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring PAUSE event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting PAUSE event');
    this.state.safeSendMessage({ 
      type: 'PLAY_PAUSE', 
      control: 'pause'
    });
  }

  broadcastSeek(video) {
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring SEEK event - not on /watch page');
      return;
    }
    console.log('[SyncManager] Broadcasting SEEK event at', video.currentTime);
    this.state.safeSendMessage({ 
      type: 'SEEK', 
      currentTime: video.currentTime, 
      isPlaying: !video.paused 
    });
  }

  broadcastPosition(video) {
    if (!this.isOnWatchPage()) {
      return;
    }
    // Send continuous position update for live timestamp tracking
    // Use Netflix controller for accurate time (video.currentTime can be 0 on Netflix)
    this.netflix.getCurrentTime().then((currentTimeMs) => {
      let currentTime = null;
      if (currentTimeMs != null) {
        currentTime = currentTimeMs / 1000;
      }

      // Fallback to video element time if Netflix API not ready
      if ((currentTime == null || currentTime === 0) && video?.currentTime > 0) {
        currentTime = video.currentTime;
      }

      // If still zero, keep last known time to avoid resetting to 0
      if (currentTime == null || currentTime === 0) {
        currentTime = this.lastKnownTimeSeconds || 0;
      } else {
        this.lastKnownTimeSeconds = currentTime;
      }

      if (currentTime === 0) return;
      this.state.safeSendMessage({ 
        type: 'POSITION_UPDATE', 
        currentTime, 
        isPlaying: !video.paused 
      });
    }).catch((err) => {
      console.warn('[SyncManager] Failed to read currentTime for POSITION_UPDATE:', err);
    });
  }

  // Remote event handlers
  handleRequestSync(fromUserId, respectAutoPlay) { return this.remote.handleRequestSync(fromUserId, respectAutoPlay); }
  handleSyncResponse(currentTime, isPlaying, fromUserId, url, respectAutoPlay) {
    // Only handle sync responses on /watch pages to avoid preview videos interfering
    if (!this.isOnWatchPage()) {
      console.log('[SyncManager] Ignoring sync response - not on /watch page');
      return;
    }
    return this.remote.handleSyncResponse(currentTime, isPlaying, fromUserId, url, respectAutoPlay);
  }
  handlePlaybackControl(control, currentTime, fromUserId) { return this.remote.handlePlaybackControl(control, currentTime, fromUserId); }
  handleSeek(currentTime, isPlaying, fromUserId) { return this.remote.handleSeek(currentTime, isPlaying, fromUserId); }
}
