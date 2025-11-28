export class UIManager {
  constructor() {
    this.localPreviewVideo = null;
    this.remoteVideos = new Map();
    this.remoteStreams = new Map();
    this.streamMonitorInterval = null;
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
    v.style.bottom = '20px';
    v.style.left = '20px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = '10001';
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
  }
}
