export class UIManager {
  constructor() {
    this.localPreviewVideo = null;
    this.remoteVideos = new Map();
    this.remoteStreams = new Map();
    this.streamMonitorInterval = null;
  }

  makeDraggable(element) {
    let isDragging = false;
    let initialX = 0;
    let initialY = 0;

    element.style.cursor = 'grab';

    element.addEventListener('mousedown', (e) => {
      const rect = element.getBoundingClientRect();
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.bottom = 'auto';
      element.style.right = 'auto';

      initialX = e.clientX - rect.left;
      initialY = e.clientY - rect.top;
      isDragging = true;
      element.style.opacity = '0.8';
      element.style.cursor = 'grabbing';
      e.preventDefault();

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      let x = e.clientX - initialX;
      let y = e.clientY - initialY;

      const maxX = window.innerWidth - element.offsetWidth;
      const maxY = window.innerHeight - element.offsetHeight;
      x = Math.max(0, Math.min(x, maxX));
      y = Math.max(0, Math.min(y, maxY));

      element.style.left = x + 'px';
      element.style.top = y + 'px';
    }

    function onMouseUp() {
      isDragging = false;
      element.style.opacity = '1';
      element.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
  }
  getRemoteVideos() { return this.remoteVideos; }
  getRemoteStreams() { return this.remoteStreams; }
  setLocalPreviewVideo(video) { this.localPreviewVideo = video; }
  getLocalPreviewVideo() { return this.localPreviewVideo; }
  setStreamMonitorInterval(interval) { this.streamMonitorInterval = interval; }
  getStreamMonitorInterval() { return this.streamMonitorInterval; }
  clearStreamMonitorInterval() {
    if (this.streamMonitorInterval) {
      clearInterval(this.streamMonitorInterval);
      this.streamMonitorInterval = null;
    }
  }

  attachLocalPreview(stream) {
    console.log('[UIManager] Attaching local preview with stream:', stream);
    this.removeLocalPreview();

    // No video track — nothing useful to preview locally
    if (!stream || !stream.getVideoTracks().length) {
      console.log('[UIManager] Skipping local preview — no video track');
      return;
    }
    
    const v = document.createElement('video');
    v.id = 'tandem-local-preview';
    v.autoplay = true;
    v.muted = true; // Always mute local preview to avoid feedback
    v.playsInline = true;
    v.style.position = 'fixed';
    v.style.bottom = '145px';
    v.style.left = '20px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = '999999';
    v.style.border = '2px solid #e50914';
    v.style.borderRadius = '4px';
    v.style.transform = 'scaleX(-1)'; // Mirror for natural preview

    try {
      v.srcObject = stream;
      console.log('[UIManager] Set srcObject on local preview');
    } catch (e) {
      console.warn('[UIManager] srcObject failed, trying createObjectURL:', e);
      v.src = URL.createObjectURL(stream);
    }

    document.body.appendChild(v);
    this.localPreviewVideo = v;
    console.log('[UIManager] Local preview video appended to body');

    // Make it draggable
    this.makeDraggable(v);

    v.play().catch(err => {
      console.warn('[UIManager] Local preview play() failed:', err);
    });
  }

  removeLocalPreview() {
    if (this.localPreviewVideo) {
      console.log('[UIManager] Removing local preview video');
      try {
        if (this.localPreviewVideo.srcObject) {
          this.localPreviewVideo.srcObject = null;
        }
      } catch (e) {
        console.warn('[UIManager] Error clearing srcObject:', e);
      }
      this.localPreviewVideo.remove();
      this.localPreviewVideo = null;
    }
  }

  clearAll() {
    this.removeLocalPreview();
    this.remoteVideos.clear();
    this.remoteStreams.clear();
    this.clearStreamMonitorInterval();
    this.removeConnectionIndicator();
  }

  showConnectionIndicator() {
    // Remove existing indicator if any
    this.removeConnectionIndicator();

    const indicator = document.createElement('div');
    indicator.id = 'tandem-connection-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 8px 16px;
      border-radius: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
      cursor: pointer;
    `;

    // Add click handler to open extension popup
    indicator.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
    });

    const dot = document.createElement('div');
    dot.id = 'tandem-connection-dot';
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      animation: pulse 2s ease-in-out infinite;
    `;

    const text = document.createElement('span');
    text.id = 'tandem-connection-text';
    text.textContent = 'Connected';

    indicator.appendChild(dot);
    indicator.appendChild(text);
    document.body.appendChild(indicator);

    // Add pulse animation
    const style = document.createElement('style');
    style.id = 'tandem-connection-style';
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    return indicator;
  }

  updateConnectionIndicator(status) {
    const dot = document.getElementById('tandem-connection-dot');
    const text = document.getElementById('tandem-connection-text');
    
    if (dot && text) {
      if (status === 'connected') {
        dot.style.background = '#4ade80';
        dot.style.animation = 'pulse 2s ease-in-out infinite';
        text.textContent = 'Connected';
      } else if (status === 'waiting') {
        dot.style.background = '#a78bfa';
        dot.style.animation = 'spin 1s linear infinite';
        text.textContent = 'Waiting for others...';
      } else if (status === 'reconnecting') {
        dot.style.background = '#f59e0b';
        dot.style.animation = 'spin 1s linear infinite';
        text.textContent = 'Reconnecting...';
      } else if (status === 'disconnected') {
        dot.style.background = '#ef4444';
        dot.style.animation = 'pulse 1s ease-in-out infinite';
        text.textContent = 'Disconnected';
      }
    }
  }

  removeConnectionIndicator() {
    const indicator = document.getElementById('tandem-connection-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
}
