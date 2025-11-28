export function attachPlaybackListeners({ video, state, isInitializedRef, lock, debouncer, onBroadcast, onPassiveSyncContext }) {
  const context = { lastUserInteractionAt: 0 };
  const handleLocalEvent = (e) => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    context.lastUserInteractionAt = Date.now();
    debouncer.add(e.type);
    debouncer.schedule(() => onBroadcast(video));
  };

  let lastPassiveSentAt = 0;
  const handleTimeUpdate = () => {
    if (!state.isActive()) return;
    const now = Date.now();
    if (lock.isActive()) return;
    if (now - context.lastUserInteractionAt < 5000) return;
    if (now - lastPassiveSentAt < 10000) return;
    if (video.paused) return;
    lastPassiveSentAt = now;
    onPassiveSyncContext({ now, lastPassiveSentAt });
  };

  video.addEventListener('play', handleLocalEvent);
  video.addEventListener('pause', handleLocalEvent);
  video.addEventListener('seeked', handleLocalEvent);
  video.addEventListener('timeupdate', handleTimeUpdate);

  return { video, handleLocalEvent, handleTimeUpdate, context };
}
