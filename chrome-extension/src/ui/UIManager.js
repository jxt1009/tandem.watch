export class UIManager {
  constructor() {
    this.localPreviewVideo = null;
    this.remoteVideos = new Map();
    this.remoteStreams = new Map();
    this.streamMonitorInterval = null;
  }

  makeDraggable(element) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;

    element.addEventListener('mousedown', dragStart);
    element.addEventListener('mouseup', dragEnd);
    element.addEventListener('mousemove', drag);
    element.style.cursor = 'move';

    function dragStart(e) {
      // Get current position from style
      const computedStyle = window.getComputedStyle(element);
      const bottom = computedStyle.bottom;
      const left = computedStyle.left;
      const right = computedStyle.right;
      
      // Convert to absolute positioning from current position
      const rect = element.getBoundingClientRect();
      element.style.left = rect.left + 'px';
      element.style.top = rect.top + 'px';
      element.style.bottom = 'auto';
      element.style.right = 'auto';
      
      initialX = e.clientX - rect.left;
      initialY = e.clientY - rect.top;
      isDragging = true;
      element.style.opacity = '0.8';
    }

    function dragEnd(e) {
      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      element.style.opacity = '1';
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        
        // Keep within viewport bounds
        const maxX = window.innerWidth - element.offsetWidth;
        const maxY = window.innerHeight - element.offsetHeight;
        currentX = Math.max(0, Math.min(currentX, maxX));
        currentY = Math.max(0, Math.min(currentY, maxY));
        
        setTranslate(currentX, currentY, element);
      }
    }

    function setTranslate(xPos, yPos, el) {
      el.style.left = xPos + 'px';
      el.style.top = yPos + 'px';
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
    
    const v = document.createElement('video');
    v.id = 'toperparty-local-preview';
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
    indicator.id = 'toperparty-connection-indicator';
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
    `;

    const dot = document.createElement('div');
    dot.id = 'toperparty-connection-dot';
    dot.style.cssText = `
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      animation: pulse 2s ease-in-out infinite;
    `;

    const text = document.createElement('span');
    text.id = 'toperparty-connection-text';
    text.textContent = 'Party Active';

    indicator.appendChild(dot);
    indicator.appendChild(text);
    document.body.appendChild(indicator);

    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);

    return indicator;
  }

  updateConnectionIndicator(connected) {
    const dot = document.getElementById('toperparty-connection-dot');
    const text = document.getElementById('toperparty-connection-text');
    
    if (dot && text) {
      if (connected) {
        dot.style.background = '#4ade80';
        text.textContent = 'Party Active';
      } else {
        dot.style.background = '#ef4444';
        text.textContent = 'Reconnecting...';
      }
    }
  }

  removeConnectionIndicator() {
    const indicator = document.getElementById('toperparty-connection-indicator');
    if (indicator) {
      indicator.remove();
    }
  }
}
