export function createRemoteVideoManager(remoteVideos, sidebarPanel = null) {
  function ensureSpinnerStyles() {
    if (document.getElementById('tandem-spinner-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'tandem-spinner-styles';
    style.textContent = `
      @keyframes tandem-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes tandem-pulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 1; }
      }
      @keyframes tandem-dot {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }
      .tandem-dots {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        justify-content: center;
      }
      .tandem-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #38bdf8;
        animation: tandem-dot 1.2s infinite ease-in-out;
      }
      .tandem-dot:nth-child(2) { animation-delay: 0.2s; }
      .tandem-dot:nth-child(3) { animation-delay: 0.4s; }
    `;
    document.head.appendChild(style);
  }

  function createLoadingSpinner() {
    ensureSpinnerStyles();
    // Create a more visually appealing spinner using CSS
    const spinner = document.createElement('div');
    spinner.className = 'tandem-spinner';
    spinner.style.cssText = `
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid #00aaff;
      border-radius: 50%;
      animation: tandem-spin 1s linear infinite;
      margin-bottom: 12px;
    `;
    return spinner;
  }

  function createWaitingDots() {
    ensureSpinnerStyles();
    const dots = document.createElement('div');
    dots.className = 'tandem-dots';
    dots.innerHTML = '<span class="tandem-dot"></span><span class="tandem-dot"></span><span class="tandem-dot"></span>';
    return dots;
  }
  
  function makeDraggable(element) {
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

  function add(peerId, stream) {
    console.log('[RemoteVideoManager] Adding remote video for peer:', peerId);

    // ── Sidebar path ──────────────────────────────────────────────────────
    if (sidebarPanel) {
      sidebarPanel.setParticipantStream(peerId, stream);
      remoteVideos.set(peerId, null); // Track that this peer has a stream
      return;
    }

    // ── Floating fallback path (no sidebar) ───────────────────────────────
    console.log('[RemoteVideoManager] stream:', stream, 'tracks:', stream.getTracks());
    console.log('[RemoteVideoManager] Current remoteVideos map size:', remoteVideos.size, 'peers:', Array.from(remoteVideos.keys()));
    
    // First, aggressively clean up any existing elements for this peer to prevent duplicates
    const existingInMap = remoteVideos.get(peerId);
    const existingInDom = document.getElementById('tandem-remote-' + peerId);
    const existingContainer = document.getElementById('tandem-container-' + peerId);
    
    if (existingInDom && existingInMap && existingInDom === existingInMap) {
      console.log('[RemoteVideoManager] Video already exists for peer:', peerId, 'updating stream if needed');
      if (existingInDom.srcObject !== stream) {
        console.log('[RemoteVideoManager] Updating stream on existing video element');
        if (existingInDom.srcObject) {
          existingInDom.srcObject.getTracks().forEach(t => t.stop());
        }
        existingInDom.srcObject = stream;
        const overlay = document.getElementById('tandem-overlay-' + peerId);
        if (overlay) overlay.remove();
      }
      return;
    }
    
    // Clean up any stale elements before creating new ones
    if (existingInMap || existingInDom || existingContainer) {
      console.log('[RemoteVideoManager] Found stale elements for peer:', peerId, 'cleaning up before creating new');
      remove(peerId);
    }
    
    // Create fresh container
    const container = document.createElement('div');
    container.id = 'tandem-container-' + peerId;
    container.style.position = 'fixed';
    container.style.bottom = '145px';
    container.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    container.style.width = '240px';
    container.style.height = '160px';
    container.style.zIndex = 999999;
    container.style.border = '2px solid #00aaff';
    container.style.borderRadius = '4px';
    container.style.backgroundColor = '#000';
    
    const v = document.createElement('video');
    v.id = 'tandem-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.width = '100%';
    v.style.height = '100%';
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';
    v.style.backgroundColor = '#000';
    
    // Get or create overlay
    let overlay = document.getElementById('tandem-overlay-' + peerId);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tandem-overlay-' + peerId;
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.color = '#fff';
      overlay.style.fontSize = '14px';
      overlay.style.fontFamily = 'Arial, sans-serif';
      overlay.style.borderRadius = '4px';
      overlay.style.pointerEvents = 'none';
      
      const spinner = createLoadingSpinner();
      const text = document.createElement('div');
      text.textContent = 'Connecting...';
      text.style.fontWeight = '500';
      
      overlay.appendChild(spinner);
      overlay.appendChild(text);
    }
    
    ensureSpinnerStyles();
    
    container.appendChild(v);
    if (!overlay.parentElement) {
      container.appendChild(overlay);
    }
    if (!container.parentElement) {
      document.body.appendChild(container);
      // Make container draggable if newly created
      makeDraggable(container);
    }
    console.log('[RemoteVideoManager] Added video to container:', container.id);
    
    // Verify stream has active tracks
    const activeTracks = stream.getTracks().filter(t => t.readyState === 'live');
    console.log('[RemoteVideoManager] Stream has', activeTracks.length, 'active tracks:', 
      activeTracks.map(t => `${t.kind}:${t.id.substring(0,8)}`).join(', '));
    
    try { 
      v.srcObject = stream;
      console.log('[RemoteVideoManager] Set srcObject successfully');
    } catch (e) { 
      console.warn('[RemoteVideoManager] srcObject failed:', e);
    }
    
    remoteVideos.set(peerId, v);

    // If the remote peer has no video track, show a "no camera" label
    // instead of a blank black box. Audio will still play through the element.
    const hasVideoTrack = stream.getTracks().some(t => t.kind === 'video');
    if (!hasVideoTrack) {
      const noCamLabel = document.createElement('div');
      noCamLabel.id = 'tandem-nocam-' + peerId;
      noCamLabel.style.cssText = `
        position: absolute; top: 0; left: 0; width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column; gap: 6px;
        color: #94a3b8; font-size: 13px; font-family: Arial, sans-serif;
        pointer-events: none;
      `;
      noCamLabel.innerHTML = `
        <div style="font-size:28px">👤</div>
        <div>No camera</div>
      `;
      container.appendChild(noCamLabel);
    }

    // Handle video playback with better error handling
    const playVideo = () => {
      v.play().then(() => {
        console.log('[RemoteVideoManager] Video playing, unmuting and removing overlay');
        v.muted = false;
        v.volume = 1.0;
        // Remove loading overlay
        overlay.remove();
      }).catch((e) => { 
        console.warn('[RemoteVideoManager] Play failed:', e.name, e.message);
        // Try unmuting anyway in case autoplay blocked
        v.muted = false;
        // Still remove overlay even if play failed
        overlay.remove();
      });
    };
    
    // If stream already has tracks, play immediately
    if (activeTracks.length > 0) {
      playVideo();
    } else {
      // Wait for tracks to become active
      console.log('[RemoteVideoManager] Waiting for stream tracks to become active');
      overlay.innerHTML = '<div style="text-align: center;"><div style="margin-bottom: 8px;">●</div><div>Waiting for stream...</div></div>';
      const checkTracks = setInterval(() => {
        const nowActive = stream.getTracks().filter(t => t.readyState === 'live');
        if (nowActive.length > 0) {
          clearInterval(checkTracks);
          console.log('[RemoteVideoManager] Tracks now active, playing video');
          playVideo();
        }
      }, 100);
      // Give up after 5 seconds and remove overlay anyway
      setTimeout(() => {
        clearInterval(checkTracks);
        if (overlay.parentNode) {
          console.log('[RemoteVideoManager] Timeout waiting for tracks, removing overlay');
          overlay.remove();
        }
      }, 5000);
    }
  }
  
  function remove(peerId) {
    console.log('[RemoteVideoManager] Removing remote video for peer:', peerId);

    if (sidebarPanel) {
      remoteVideos.delete(peerId);
      return;
    }

    // Floating fallback cleanup
    const v = remoteVideos.get(peerId);
    if (v) {
      try { 
        if (v.srcObject) {
          v.srcObject.getTracks().forEach(track => track.stop());
          v.srcObject = null;
        }
      } catch (e) {
        console.warn('[RemoteVideoManager] Error cleaning up stream:', e);
      }
      // Remove the container (which includes the video)
      const container = v.parentElement;
      if (container && container.id === 'tandem-container-' + peerId) {
        container.remove();
      } else {
        v.remove();
      }
      remoteVideos.delete(peerId);
    }
    
    // Also check DOM for any orphaned elements (extra safety)
    const domContainer = document.getElementById('tandem-container-' + peerId);
    if (domContainer) {
      console.log('[RemoteVideoManager] Found orphaned container, removing');
      domContainer.remove();
    }
    
    const domElement = document.getElementById('tandem-remote-' + peerId);
    if (domElement && domElement !== v) {
      console.log('[RemoteVideoManager] Found orphaned video element, removing');
      try {
        if (domElement.srcObject) {
          domElement.srcObject = null;
        }
      } catch (e) {}
      domElement.remove();
    }
    
    // Clean up overlay and no-camera label if they exist
    const overlay = document.getElementById('tandem-overlay-' + peerId);
    if (overlay) {
      overlay.remove();
    }
    const noCamLabel = document.getElementById('tandem-nocam-' + peerId);
    if (noCamLabel) {
      noCamLabel.remove();
    }
  }
  
  function showReconnecting(peerId) {
    console.log('[RemoteVideoManager] Showing reconnecting overlay for peer:', peerId);
    if (sidebarPanel) {
      sidebarPanel.setConnectionStatus(peerId, 'reconnecting');
      return;
    }
    
    // Check if overlay already exists
    let overlay = document.getElementById('tandem-overlay-' + peerId);
    if (overlay) {
      // Update existing overlay content
      overlay.innerHTML = '';
      const spinner = createLoadingSpinner();
      const text = document.createElement('div');
      text.textContent = 'Reconnecting...';
      text.style.fontWeight = '500';
      overlay.appendChild(spinner);
      overlay.appendChild(text);
      overlay.style.display = 'flex';
      return;
    }
    
    // Create new overlay if it doesn't exist
    const container = document.getElementById('tandem-container-' + peerId);
    if (!container) {
      console.warn('[RemoteVideoManager] Cannot show reconnecting - container not found');
      return;
    }
    
    overlay = document.createElement('div');
    overlay.id = 'tandem-overlay-' + peerId;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    
    const spinner = createLoadingSpinner();
    const text = document.createElement('div');
    text.textContent = 'Reconnecting...';
    text.style.fontWeight = '500';
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    container.appendChild(overlay);
  }
  
  function hideOverlay(peerId) {
    if (sidebarPanel) {
      sidebarPanel.setConnectionStatus(peerId, 'connected');
      return;
    }
    const overlay = document.getElementById('tandem-overlay-' + peerId);
    if (overlay) {
      console.log('[RemoteVideoManager] Hiding overlay for peer:', peerId);
      overlay.remove();
    }
  }
  
  function showWaitingIndicator() {
    // Remove any existing waiting indicator first
    hideWaitingIndicator();
    
    console.log('[RemoteVideoManager] Showing waiting indicator');
    const container = document.createElement('div');
    container.id = 'tandem-waiting-indicator';
    container.style.position = 'fixed';
    container.style.bottom = '24px';
    container.style.right = '20px';
    container.style.padding = '8px 12px';
    container.style.zIndex = 999999;
    container.style.border = '1px solid rgba(56, 189, 248, 0.4)';
    container.style.borderRadius = '999px';
    container.style.backgroundColor = 'rgba(15, 23, 42, 0.9)';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.style.color = '#e2e8f0';
    container.style.fontSize = '12px';
    container.style.fontFamily = 'Arial, sans-serif';
    container.style.pointerEvents = 'none';
    container.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.35)';
    
    const dots = createWaitingDots();
    const text = document.createElement('div');
    text.textContent = 'Party started • waiting for others';
    text.style.fontWeight = '500';
    text.style.letterSpacing = '0.2px';
    
    container.appendChild(dots);
    container.appendChild(text);
    document.body.appendChild(container);
  }
  
  function hideWaitingIndicator() {
    const indicator = document.getElementById('tandem-waiting-indicator');
    if (indicator) {
      console.log('[RemoteVideoManager] Hiding waiting indicator');
      indicator.remove();
    }
  }
  
  function showPlaceholder(peerId) {
    console.log('[RemoteVideoManager] Showing placeholder for peer:', peerId);
    if (sidebarPanel) {
      sidebarPanel.setConnectionStatus(peerId, 'connecting');
      return;
    }
    
    // Hide waiting indicator when first peer connects
    hideWaitingIndicator();
    
    // Check if container already exists
    let container = document.getElementById('tandem-container-' + peerId);
    if (container) {
      console.log('[RemoteVideoManager] Placeholder already exists for peer:', peerId, '- reusing it');
      return;
    }
    
    console.log('[RemoteVideoManager] Creating NEW placeholder container for peer:', peerId);
    
    // Create container immediately
    container = document.createElement('div');
    container.id = 'tandem-container-' + peerId;
    container.style.position = 'fixed';
    container.style.bottom = '145px';
    container.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    container.style.width = '240px';
    container.style.height = '160px';
    container.style.zIndex = 999999;
    container.style.border = '2px solid #00aaff';
    container.style.borderRadius = '4px';
    container.style.backgroundColor = '#000';
    
    // Create loading overlay
    const overlay = document.createElement('div');
    overlay.id = 'tandem-overlay-' + peerId;
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontFamily = 'Arial, sans-serif';
    overlay.style.borderRadius = '4px';
    overlay.style.pointerEvents = 'none';
    
    const spinner = createLoadingSpinner();
    const text = document.createElement('div');
    text.textContent = 'Connecting...';
    text.style.fontWeight = '500';
    
    overlay.appendChild(spinner);
    overlay.appendChild(text);
    container.appendChild(overlay);
    document.body.appendChild(container);
    
    // Make container draggable immediately
    makeDraggable(container);
    
    console.log('[RemoteVideoManager] Created placeholder container:', container.id);
  }
  
  function setSidebarPanel(panel) {
    sidebarPanel = panel;
    if (panel) {
      // Clean up any floating video containers that were created before the sidebar was ready
      remoteVideos.forEach((videoEl, peerId) => {
        const container = document.getElementById('tandem-container-' + peerId);
        if (container) container.remove();
        remoteVideos.set(peerId, null); // mark as handled by sidebar
      });
      // Remove the floating local preview as well (sidebar has its own tile)
      const localPreview = document.getElementById('tandem-local-preview');
      if (localPreview) {
        const localContainer = localPreview.closest('[id^="tandem-local"]') || localPreview.parentElement;
        if (localContainer && localContainer !== document.body) localContainer.remove();
        else localPreview.remove();
      }
    }
  }

  return { add, remove, showReconnecting, hideOverlay, showPlaceholder, showWaitingIndicator, hideWaitingIndicator, setSidebarPanel };
}
