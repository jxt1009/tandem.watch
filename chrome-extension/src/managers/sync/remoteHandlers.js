export function createRemoteHandlers({ state, netflix, lock, isInitializedRef, contextRef }) {
  async function applyRemote(actionName, durationMs, actionFn) {
    lock.set(durationMs);
    try { await actionFn(); } catch (err) {
      console.error(`[SyncManager] Error applying remote ${actionName}:`, err);
    }
  }

  return {
    async handleRequestSync(fromUserId) {
      if (!isInitializedRef.get()) return;
      try {
        const currentTime = await netflix.getCurrentTime();
        const isPaused = await netflix.isPaused();
        state.safeSendMessage({
          type: 'SYNC_RESPONSE',
          targetUserId: fromUserId,
          currentTime: currentTime / 1000,
          isPlaying: !isPaused
        });
      } catch (e) { console.error('[SyncManager] Error handling sync request:', e); }
    },
    async handleSyncResponse(currentTime, isPlaying, fromUserId) {
      if (isInitializedRef.get()) return;
      isInitializedRef.set(true);
      await applyRemote('initial-sync', 2000, async () => {
        await netflix.seek(currentTime * 1000);
        const localPaused = await netflix.isPaused();
        if (isPlaying && localPaused) await netflix.play();
        else if (!isPlaying && !localPaused) await netflix.pause();
      });
    },
    async handlePlaybackControl(control) {
      await applyRemote(control, 1000, async () => {
        if (control === 'play') await netflix.play();
        else await netflix.pause();
      });
    },
    async handleSeek(currentTime, isPlaying) {
      await applyRemote('seek', 2000, async () => {
        await netflix.seek(currentTime * 1000);
        const isPaused = await netflix.isPaused();
        if (isPlaying && isPaused) await netflix.play();
        else if (!isPlaying && !isPaused) await netflix.pause();
      });
    },
    async handlePassiveSync(currentTime, isPlaying, fromUserId, timestamp) {
      const now = Date.now();
      if (timestamp && (now - timestamp > 5000)) return;
      if (now - contextRef.get().lastUserInteractionAt < 10000) return;
      if (lock.isActive()) return;
      try {
        const localTimeMs = await netflix.getCurrentTime();
        const targetMs = currentTime * 1000;
        const driftMs = Math.abs(localTimeMs - targetMs);
        if (driftMs <= 3000) return;
        await applyRemote('passive-correction', 1500, async () => {
          await netflix.seek(targetMs);
          const localPaused = await netflix.isPaused();
          if (isPlaying && localPaused) await netflix.play();
          else if (!isPlaying && !localPaused) await netflix.pause();
        });
      } catch (err) { console.error('[SyncManager] Error handling passive sync:', err); }
    }
  };
}
