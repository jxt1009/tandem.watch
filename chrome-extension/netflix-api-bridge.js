// netflix-api-bridge.js - Injected into page context to access Netflix API
// This runs in the page context, not the extension context

(function() {
  // Netflix Player API Helper - runs in page context
  window.__tandem_netflix = {
    getPlayer: function() {
      try {
        const videoPlayer = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
        const sessions = videoPlayer.getAllPlayerSessionIds();
        const sessionId = sessions && sessions.length ? sessions[sessions.length - 1] : null;
        if (!sessionId) return null;
        return videoPlayer.getVideoPlayerBySessionId(sessionId);
      } catch (e) {
        console.warn('Failed to get Netflix player:', e);
        return null;
      }
    },
    
    play: function() {
      const player = this.getPlayer();
      if (player) player.play();
    },
    
    pause: function() {
      const player = this.getPlayer();
      if (player) player.pause();
    },
    
    seek: function(timeMs) {
      const player = this.getPlayer();
      if (player) player.seek(timeMs);
    },
    
    getCurrentTime: function() {
      const player = this.getPlayer();
      return player ? player.getCurrentTime() : null;
    },
    
    isPaused: function() {
      const player = this.getPlayer();
      return player ? player.isPaused() : true;
    },
    
    setVolume: function(level) {
      const player = this.getPlayer();
      if (player) {
        player.setVolume(level);
        return true;
      }
      return false;
    },
    
    getVolume: function() {
      const player = this.getPlayer();
      return player ? player.getVolume() : 1.0;
    },
    
    getDuration: function() {
      const player = this.getPlayer();
      try {
        if (player && player.getDuration) {
          return player.getDuration();
        }
      } catch (e) {
        console.warn('Failed to get duration:', e);
      }
      return null;
    },
    
    getPlayerState: function() {
      const player = this.getPlayer();
      try {
        if (!player) return null;
        const currentTime = player.getCurrentTime();
        const duration = player.getDuration ? player.getDuration() : null;
        const isPaused = player.isPaused();
        const justEnded = duration && currentTime && Math.abs(duration - currentTime) < 500;
        return { currentTime, duration, isPaused, justEnded: justEnded || false };
      } catch (e) {
        console.warn('Failed to get player state:', e);
        return null;
      }
    }
  };
  
  // Listen for commands from content script
  document.addEventListener('__tandem_command', function(e) {
    const { command, args } = e.detail;
    if (window.__tandem_netflix[command]) {
      const result = window.__tandem_netflix[command].apply(window.__tandem_netflix, args || []);
      document.dispatchEvent(new CustomEvent('__tandem_response', { detail: { command, result } }));
    }
  });
})();
