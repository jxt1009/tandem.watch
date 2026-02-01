export function createRemoteHandlers({ state, netflix, lock, isInitializedRef }) {
  async function applyRemote(actionName, durationMs, actionFn) {
    lock.set(durationMs);
    try { await actionFn(); } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  return {
    async handleRequestSync(fromUserId, respectAutoPlay = false) {
      const currentUrl = window.location.href;
      const isOnWatchPage = window.location.pathname.startsWith('/watch');

      // If we're on browse page, don't send sync response
      if (!isOnWatchPage) {
        console.log('[SyncManager] On browse page, not sending sync response');
        return;
      }

      const maxAttempts = 6;
      const retryDelayMs = 500;

      const attemptSyncResponse = async (attempt) => {
        try {
          const currentTime = await netflix.getCurrentTime();
          const isPaused = await netflix.isPaused();

          if (currentTime == null) {
            if (attempt < maxAttempts) {
              console.log('[SyncManager] Playback state not ready, retrying sync response (attempt', attempt + 1, ')');
              setTimeout(() => attemptSyncResponse(attempt + 1), retryDelayMs);
            } else {
              console.log('[SyncManager] Playback state still not ready, giving up on sync response');
            }
            return;
          }

          const currentTimeSeconds = currentTime / 1000;
          console.log('[SyncManager] Sending SYNC_RESPONSE to', fromUserId, 'at', currentTimeSeconds.toFixed(2) + 's', isPaused ? 'paused' : 'playing', 'URL:', currentUrl, respectAutoPlay ? '(will respect auto-play)' : '');

          state.safeSendMessage({
            type: 'SYNC_RESPONSE',
            targetUserId: fromUserId,
            currentTime: currentTimeSeconds,
            isPlaying: !isPaused,
            url: currentUrl,
            respectAutoPlay: respectAutoPlay
          });
        } catch (e) {
          console.error('[SyncManager] Error handling sync request:', e);
        }
      };

      if (!isInitializedRef.get()) {
        console.log('[SyncManager] Not yet initialized, will still attempt to respond to sync request');
      }

      attemptSyncResponse(1);
    },
    async handleSyncResponse(currentTime, isPlaying, fromUserId, url, respectAutoPlay = false) {
      if (isInitializedRef.get()) {
        console.log('[SyncManager] Already initialized, ignoring late SYNC_RESPONSE');
        return;
      }
      
      if (currentTime == null || typeof currentTime !== 'number' || currentTime < 0) {
        console.warn('[SyncManager] Invalid SYNC_RESPONSE - bad currentTime:', currentTime);
        return;
      }
      
      if (respectAutoPlay) {
        console.log('[SyncManager] Initial sync from', fromUserId, 'seeking to', currentTime.toFixed(2) + 's (respecting auto-play)');
      } else {
        console.log('[SyncManager] Initial sync from', fromUserId, 'seeking to', currentTime.toFixed(2) + 's', isPlaying ? 'playing' : 'paused', 'URL:', url);
      }
      
      // Check if we need to navigate to a different URL
      const currentUrl = window.location.href;
      const currentPath = window.location.pathname;
      const isOnWatch = currentPath.startsWith('/watch');
      const isOnBrowse = currentPath.startsWith('/browse');
      const otherIsOnWatch = url && (new URL(url).pathname.startsWith('/watch'));
      
      // Only navigate if we're NOT on a /watch page and the other user IS on /watch
      // This allows initial sync to pull you to the watch page, but won't pull you back if you leave
      if (!isOnWatch && otherIsOnWatch && isOnBrowse) {
        console.log('[SyncManager] On browse page during initial join, other user on /watch - navigating to their show');
        sessionStorage.setItem('tandem_pending_sync', JSON.stringify({
          currentTime,
          isPlaying,
          timestamp: Date.now()
        }));
        window.location.href = url;
        return;
      }
      
      // If we're not on /watch at all, ignore this sync response
      if (!isOnWatch) {
        console.log('[SyncManager] Not on /watch page - ignoring sync response');
        isInitializedRef.set(true); // Mark as initialized so we don't keep processing these
        return;
      }
      
      // Regular URL mismatch handling
      if (url && url !== currentUrl) {
        console.log('[SyncManager] URL mismatch - navigating from', currentUrl, 'to', url);
        // Store the sync state to apply after navigation
        sessionStorage.setItem('tandem_pending_sync', JSON.stringify({
          currentTime,
          isPlaying,
          timestamp: Date.now()
        }));
        // Navigate to the correct URL
        window.location.href = url;
        return;
      }
      
      isInitializedRef.set(true);
      
      await applyRemote('initial-sync', 1500, async () => {
        await netflix.seek(currentTime * 1000);
        
        // If respecting auto-play, only sync timestamp, not play/pause state
        if (respectAutoPlay) {
          console.log('[SyncManager] Synced timestamp only, respecting Netflix auto-play');
          // Report position to server
          const finalPaused = await netflix.isPaused();
          state.safeSendMessage({
            type: 'POSITION_UPDATE',
            currentTime: currentTime,
            isPlaying: !finalPaused
          });
          return;
        }
        
        const localPaused = await netflix.isPaused();
        
        // Sync to the remote play/pause state
        if (isPlaying && localPaused) {
          console.log('[SyncManager] Remote is playing, starting playback');
          await netflix.play();
        } else if (!isPlaying && !localPaused) {
          console.log('[SyncManager] Remote is paused, pausing playback');
          await netflix.pause();
        }
        
        // Report final position to server after sync complete
        state.safeSendMessage({
          type: 'POSITION_UPDATE',
          currentTime: currentTime,
          isPlaying: isPlaying
        });
      });
    },
    async handlePlaybackControl(control, currentTime, fromUserId) {
      console.log('[SyncManager] Remote', control.toUpperCase(), 'at', currentTime, 'from', fromUserId);
      
      await applyRemote(control, 1000, async () => {
        // Seek to the exact position first
        if (currentTime != null) {
          const currentTimeMs = currentTime * 1000;
          await netflix.seek(currentTimeMs);
          console.log('[SyncManager] Seeked to', currentTime.toFixed(2) + 's before', control);
        }
        
        // Then apply play/pause
        if (control === 'play') {
          await netflix.play();
        } else {
          await netflix.pause();
        }
      });
    },
    async handleSeek(currentTime, isPlaying, fromUserId) {
      console.log('[SyncManager] Remote SEEK to', currentTime.toFixed(2) + 's', isPlaying ? 'playing' : 'paused', 'from', fromUserId);
      
      await applyRemote('seek', 1200, async () => {
        await netflix.seek(currentTime * 1000);
        const isPaused = await netflix.isPaused();
        
        if (isPlaying && isPaused) {
          await netflix.play();
        } else if (!isPlaying && !isPaused) {
          await netflix.pause();
        }
      });
    }
  };
}
