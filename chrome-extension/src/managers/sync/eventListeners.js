<<<<<<< HEAD
export function attachPlaybackListeners({ video, state, isInitializedRef, lock, debouncer, onBroadcast, onPassiveSyncContext }) {
  const context = { lastUserInteractionAt: 0 };
  const handleLocalEvent = (e) => {
    console.log('[EventListener] Local event:', e.type, 'video.currentTime:', video.currentTime.toFixed(2), 'paused:', video.paused);
    
    if (!state.isActive()) {
      console.log('[EventListener] Suppressed - party not active');
      return;
    }
    if (!isInitializedRef.get()) {
      console.log('[EventListener] Suppressed - not initialized');
      return;
    }
    if (lock.isActive()) {
      console.log('[EventListener] Suppressed - lock active');
      return;
    }
    
    console.log('[EventListener] Event accepted, scheduling broadcast');
    context.lastUserInteractionAt = Date.now();
    debouncer.add(e.type);
    debouncer.schedule(() => onBroadcast(video));
=======
export function attachPlaybackListeners({ video, state, isInitializedRef, lock, onPlay, onPause, onSeek }) {
  const handlePlay = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Play event detected');
    onPlay(video);
>>>>>>> ecb1452 (refactor project to a more sensible dir structure)
  };

  const handlePause = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Pause event detected');
    onPause(video);
  };

  const handleSeeked = () => {
    if (!state.isActive()) return;
    if (!isInitializedRef.get()) return;
    if (lock.isActive()) return;
    console.log('[EventListeners] Seek event detected');
    onSeek(video);
  };

  video.addEventListener('play', handlePlay);
  video.addEventListener('pause', handlePause);
  video.addEventListener('seeked', handleSeeked);

  return { video, handlePlay, handlePause, handleSeeked };
}
