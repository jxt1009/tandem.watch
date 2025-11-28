export class URLSync {
  constructor(stateManager) {
    this.stateManager = stateManager;
    this.urlMonitorInterval = null;
    this.lastUrl = null;
  }
  start() { this.lastUrl = window.location.href; }
  stop() {
    if (this.urlMonitorInterval) { clearInterval(this.urlMonitorInterval); this.urlMonitorInterval = null; }
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
    sessionStorage.setItem('toperparty_restore', JSON.stringify(payload));
  }
  clearState() { sessionStorage.removeItem('toperparty_restore'); }
  getRestorationState() {
    const stored = sessionStorage.getItem('toperparty_restore');
    if (!stored) return null;
    try {
      const state = JSON.parse(stored);
      if (Date.now() - state.timestamp < 30000) { return state; }
    } catch (e) { console.error('[toperparty] Failed to parse restoration state:', e); }
    return null;
  }
}
