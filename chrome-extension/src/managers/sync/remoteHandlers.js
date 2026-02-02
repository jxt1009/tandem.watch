export function createRemoteHandlers({ state, netflix, lock, isInitializedRef, urlSync, shouldAcceptLateSync, onInitialSyncApplied }) {
  async function applyRemote(actionName, durationMs, actionFn) {
    lock.set(durationMs);
    try { await actionFn(); } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  function applyLatencyCompensation(currentTime, isPlaying, eventTimestamp) {
    if (!Number.isFinite(currentTime)) return currentTime;
    if (!eventTimestamp || !Number.isFinite(eventTimestamp)) return currentTime;
    if (!isPlaying) return currentTime;
    const elapsedMs = Math.max(0, Date.now() - eventTimestamp);
    return currentTime + (elapsedMs / 1000);
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
      // Check if this sync would revert a recent auto-advance
      const urlSyncInstance = urlSync?.();
      if (urlSyncInstance && urlSyncInstance.shouldSuppressSyncResponse(url)) {
        return;
      }
      
      if (isInitializedRef.get() && !shouldAcceptLateSync?.()) {
        console.log('[SyncManager] Already initialized, ignoring late SYNC_RESPONSE');
        return;
      }

      if (isInitializedRef.get() && shouldAcceptLateSync?.()) {
        console.log('[SyncManager] Accepting late SYNC_RESPONSE within initial window');
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
        if (onInitialSyncApplied) onInitialSyncApplied();
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

      // If sync returns a near-zero timestamp, wait briefly for Netflix resume
      // and prefer local progress to avoid resetting watch history.
      // This handles cases where room state is default or stale.
      if (currentTime <= 2) {
        try {
          console.log('[SyncManager] Received near-zero sync (', currentTime.toFixed(2) + 's), checking for local resume position from', fromUserId);
          const waitForLocalResume = async () => {
            const attempts = 8;
            const delayMs = 500;
            for (let i = 0; i < attempts; i++) {
              const localTimeMs = await netflix.getCurrentTime();
              console.log('[SyncManager] Resume check attempt', i + 1, '- local time:', localTimeMs != null ? (localTimeMs / 1000).toFixed(2) + 's' : 'null');
              if (localTimeMs != null && localTimeMs > 5000) {
                return localTimeMs;
              }
              await new Promise(r => setTimeout(r, delayMs));
            }
            return null;
          };

          const localTimeMs = await waitForLocalResume();
          if (localTimeMs != null && localTimeMs > 5000) {
            const localPaused = await netflix.isPaused();
            const localSeconds = localTimeMs / 1000;
            console.log('[SyncManager] Using local resume position instead of near-zero sync:', localSeconds.toFixed(2) + 's', localPaused ? 'paused' : 'playing');
            isInitializedRef.set(true);
            if (onInitialSyncApplied) onInitialSyncApplied();
            state.safeSendMessage({
              type: 'POSITION_UPDATE',
              currentTime: localSeconds,
              isPlaying: !localPaused
            });
            return;
          } else {
            console.log('[SyncManager] No local resume position found after waiting, applying sync at', currentTime.toFixed(2) + 's');
          }
        } catch (e) {
          console.warn('[SyncManager] Error checking local resume position:', e);
        }
      }
      
      isInitializedRef.set(true);
      if (onInitialSyncApplied) onInitialSyncApplied();
      
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
    async handlePlaybackControl(control, currentTime, fromUserId, eventTimestamp) {
      console.log('[SyncManager] Remote', control.toUpperCase(), 'from', fromUserId);
      const adjustedTime = applyLatencyCompensation(currentTime, control === 'play', eventTimestamp);

      await applyRemote(control, 1000, async () => {
        // Only apply play/pause, don't seek
        // Position is synced separately via SEEK and POSITION_UPDATE messages
        if (control === 'play') {
          if (Number.isFinite(adjustedTime)) {
            const localTimeMs = await netflix.getCurrentTime();
            const localTime = Number.isFinite(localTimeMs) ? (localTimeMs / 1000) : null;
            if (localTime != null && Math.abs(localTime - adjustedTime) > 0.75) {
              console.log('[SyncManager] Latency compensation: nudging to', adjustedTime.toFixed(2) + 's before play');
              await netflix.seek(adjustedTime * 1000);
            }
          }
          await netflix.play();
        } else {
          await netflix.pause();
        }
      });
    },
    async handleSeek(currentTime, isPlaying, fromUserId, eventTimestamp) {
      const adjustedTime = applyLatencyCompensation(currentTime, isPlaying, eventTimestamp);
      console.log('[SyncManager] Remote SEEK to', adjustedTime.toFixed(2) + 's', isPlaying ? 'playing' : 'paused', 'from', fromUserId);

      await applyRemote('seek', 1200, async () => {
        await netflix.seek(adjustedTime * 1000);
        const isPaused = await netflix.isPaused();
        
        if (isPlaying && isPaused) {
          await netflix.play();
        } else if (!isPlaying && !isPaused) {
          await netflix.pause();
        }
      });
    },
    async handleSeekPause(currentTime, fromUserId) {
      console.log('[SyncManager] Remote SEEK_PAUSE to', currentTime.toFixed(2) + 's from', fromUserId);

      await applyRemote('seek-pause', 1500, async () => {
        await netflix.seek(currentTime * 1000);
        await netflix.pause();

        const waitForReady = () => new Promise((resolve) => {
          const video = netflix.getVideoElement();
          if (!video) {
            setTimeout(resolve, 400);
            return;
          }
          if (video.readyState >= 3) {
            resolve();
            return;
          }
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            video.removeEventListener('canplaythrough', done);
            video.removeEventListener('canplay', done);
            resolve();
          };
          video.addEventListener('canplaythrough', done, { once: true });
          video.addEventListener('canplay', done, { once: true });
          setTimeout(done, 4000);
        });

        await waitForReady();
        state.safeSendMessage({ type: 'READY', targetTime: currentTime });
      });
    },
    async handleHostHeartbeat(currentTime, isPlaying, fromUserId, eventTimestamp) {
      if (!Number.isFinite(currentTime)) return;
      const adjustedTime = applyLatencyCompensation(currentTime, isPlaying, eventTimestamp);

      const localTimeMs = await netflix.getCurrentTime();
      const localTime = Number.isFinite(localTimeMs) ? (localTimeMs / 1000) : null;
      if (localTime == null) return;

      const drift = adjustedTime - localTime;
      if (Math.abs(drift) < 0.5) return;

      await applyRemote('heartbeat-catchup', 600, async () => {
        console.log('[SyncManager] Host heartbeat correction:', drift.toFixed(2) + 's');
        await netflix.seek(adjustedTime * 1000);
        const localPaused = await netflix.isPaused();
        if (isPlaying && localPaused) {
          await netflix.play();
        } else if (!isPlaying && !localPaused) {
          await netflix.pause();
        }
      });
    }
  };
}
