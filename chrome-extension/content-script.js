// content-script.js - Injected into Netflix pages

let partyActive = false;
let userId = null;
let roomId = null;
let localStream = null;
let localPreviewVideo = null;
const peerConnections = new Map();
const remoteVideos = new Map();

// Find Netflix video player
function getVideoElement() {
  return document.querySelector('video');
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Signaling messages forwarded from background
  if (request.type === 'SIGNAL' && request.message) {
    handleSignalingMessage(request.message).catch(err => console.error('Signal handling error:', err));
    return; // no sendResponse needed
  }
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    // Get media stream for webcam/mic
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    })
      .then((stream) => {
        localStream = stream;
        console.log('Media stream obtained in content script');
        // Create or update local preview
        attachLocalPreview(stream);
        // add tracks to any existing peer connections
        peerConnections.forEach((pc) => {
          try { stream.getTracks().forEach(t => pc.addTrack(t, stream)); } catch (e) {}
        });
        sendResponse({ success: true, message: 'Media stream obtained' });
      })
      .catch((err) => {
        console.error('Failed to get media stream:', err);
        sendResponse({ success: false, error: err.message });
      });
    
    return true; // Keep channel open for async response
  }

  if (request.type === 'PARTY_STARTED') {
    partyActive = true;
    userId = request.userId;
    roomId = request.roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
    // Inject controls and setup playback sync (wait for video if necessary)
    injectControls();
    setupPlaybackSync();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    partyActive = false;
    userId = null;
    roomId = null;
    teardownPlaybackSync();
    
    // Stop media stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    // Remove local preview UI
    removeLocalPreview();
    // Remove injected controls
    removeInjectedControls();
    // Close and clear peer connections
    try {
      peerConnections.forEach((pc) => {
        try { pc.close(); } catch (e) {}
      });
      peerConnections.clear();
    } catch (e) {}
    // Remove remote video elements
    try {
      remoteVideos.forEach((v, id) => removeRemoteVideo(id));
    } catch (e) {}
    
    console.log('Party stopped');
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    const video = getVideoElement();
    if (video) {
      if (request.control === 'play') {
        video.play().catch(err => console.error('Failed to play:', err));
      } else if (request.control === 'pause') {
        video.pause();
      }
    }
    sendResponse({ success: true });
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    const video = getVideoElement();
    if (video) {
      // Only sync if times differ significantly (avoid constant micro-adjustments)
      const timeDiff = Math.abs(video.currentTime - request.currentTime);
      if (timeDiff > 0.5) { // 500ms threshold
        video.currentTime = request.currentTime;
      }

      if (request.isPlaying && video.paused) {
        video.play().catch(err => console.error('Failed to play:', err));
      } else if (!request.isPlaying && !video.paused) {
        video.pause();
      }
    }
    sendResponse({ success: true });
  }
});

// Setup playback synchronization
function setupPlaybackSync() {
  // Wait for the Netflix <video> element to be present, then attach listeners
  waitForVideo().then((video) => {
    if (!video) {
      console.warn('Netflix video element not found after wait');
      return;
    }

    // Track play/pause events
    const onPlay = () => {
      if (partyActive) {
        chrome.runtime.sendMessage({ type: 'PLAY_PAUSE', control: 'play', timestamp: video.currentTime }).catch(() => {});
      }
    };

    const onPause = () => {
      if (partyActive) {
        chrome.runtime.sendMessage({ type: 'PLAY_PAUSE', control: 'pause', timestamp: video.currentTime }).catch(() => {});
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    // Throttled timeupdate sender (every ~1s at most)
    let lastSentAt = 0;
    const onTimeUpdate = () => {
      if (!partyActive) return;
      const now = Date.now();
      if (now - lastSentAt < 1000) return; // throttle to ~1s
      lastSentAt = now;
      chrome.runtime.sendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused }).catch(() => {});
    };

    video.addEventListener('timeupdate', onTimeUpdate);

    // Periodic fallback sync (every 5 seconds)
    window.playbackSyncInterval = setInterval(() => {
      if (partyActive && video) {
        chrome.runtime.sendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused }).catch(() => {});
      }
    }, 5000);

    // Save references for teardown
    window.__toperparty_video_listeners = { onPlay, onPause, onTimeUpdate, video };

    console.log('Playback sync setup complete');
  }).catch((err) => {
    console.error('Error waiting for video element:', err);
  });
}

// Teardown playback synchronization
function teardownPlaybackSync() {
  if (window.playbackSyncInterval) {
    clearInterval(window.playbackSyncInterval);
    window.playbackSyncInterval = null;
  }
  // Remove listeners attached to the video element
  const refs = window.__toperparty_video_listeners;
  if (refs && refs.video) {
    try {
      refs.video.removeEventListener('play', refs.onPlay);
      refs.video.removeEventListener('pause', refs.onPause);
      refs.video.removeEventListener('timeupdate', refs.onTimeUpdate);
    } catch (e) {
      // ignore
    }
  }
  window.__toperparty_video_listeners = null;
}

// Inject play/pause controls into page
function injectControls() {
  if (document.getElementById('netflix-party-controls')) {
    return; // Already injected
  }

  const controlsDiv = document.createElement('div');
  controlsDiv.id = 'netflix-party-controls';
  controlsDiv.innerHTML = `
    <style>
      #netflix-party-controls {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: rgba(0, 0, 0, 0.8);
        border: 2px solid #e50914;
        border-radius: 8px;
        padding: 15px;
        z-index: 10000;
        font-family: Arial, sans-serif;
        color: white;
      }
      .control-button {
        background: #e50914;
        color: white;
        border: none;
        padding: 8px 15px;
        margin: 5px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }
      .control-button:hover {
        background: #bb070f;
      }
      .status-text {
        font-size: 12px;
        margin: 5px 0;
      }
    </style>
    <div class="status-text">Party Mode Active</div>
    <button class="control-button" id="play-btn">Γû╢ Play</button>
    <button class="control-button" id="pause-btn">ΓÅ╕ Pause</button>
  `;

  document.body.appendChild(controlsDiv);

  // Add event listeners
  document.getElementById('play-btn')?.addEventListener('click', () => {
    const video = getVideoElement();
    if (video) {
      video.play().catch(err => console.error('Failed to play:', err));
    }
  });

  document.getElementById('pause-btn')?.addEventListener('click', () => {
    const video = getVideoElement();
    if (video) {
      video.pause();
    }
  });
}

function removeInjectedControls() {
  const el = document.getElementById('netflix-party-controls');
  if (el) el.remove();
}

// Create a small local preview video element and attach a media stream to it
function attachLocalPreview(stream) {
  removeLocalPreview();
  if (!stream) return;
  const v = document.createElement('video');
  v.id = 'toperparty-local-preview';
  v.autoplay = true;
  v.muted = true; // mute local preview
  v.playsInline = true;
  v.style.position = 'fixed';
  v.style.bottom = '20px';
  v.style.left = '20px';
  v.style.width = '160px';
  v.style.height = '120px';
  v.style.zIndex = 10001;
  v.style.border = '2px solid #e50914';
  v.style.borderRadius = '4px';
  try {
    v.srcObject = stream;
  } catch (e) {
    // older browsers: createObjectURL fallback
    v.src = URL.createObjectURL(stream);
  }
  document.body.appendChild(v);
  localPreviewVideo = v;
  try {
    // Ensure the video element starts playing (muted allows autoplay in most browsers)
    v.play().catch(() => {});
  } catch (e) {}
  console.log('Attached local preview, tracks=', (stream && stream.getTracks) ? stream.getTracks().length : 0);
}

function removeLocalPreview() {
  if (localPreviewVideo) {
    try {
      // stop preview tracks if they've not been stopped already
      if (localPreviewVideo.srcObject) {
        const s = localPreviewVideo.srcObject;
        if (s.getTracks) s.getTracks().forEach(t => t.stop());
      }
    } catch (e) {
      // ignore
    }
    localPreviewVideo.remove();
    localPreviewVideo = null;
  }
}

// Wait for the page <video> element to appear (MutationObserver + fallback)
function waitForVideo(timeoutMs = 10000) {
  return new Promise((resolve) => {
    try {
      const existing = getVideoElement();
      if (existing) return resolve(existing);

      const root = document.body || document.documentElement || document;
      let timer = null;
      const observer = new MutationObserver((mutations, obs) => {
        const v = getVideoElement();
        if (v) {
          if (timer) clearTimeout(timer);
          try { obs.disconnect(); } catch (e) {}
          resolve(v);
        }
      });

      observer.observe(root, { childList: true, subtree: true });

      timer = setTimeout(() => {
        try { observer.disconnect(); } catch (e) {}
        // final attempt
        resolve(getVideoElement());
      }, timeoutMs);
    } catch (err) {
      resolve(null);
    }
  });
}

// --- WebRTC signaling helpers (content-script side) ---
function sendSignal(message) {
  try {
    chrome.runtime.sendMessage({ type: 'SIGNAL_SEND', message }, (resp) => {
      // optionally handle response
    });
  } catch (e) {
    console.error('Failed to send signal via background:', e);
  }
}

async function handleSignalingMessage(message) {
  if (!message || !message.type) return;
  const type = message.type;
  const from = message.userId || message.from;
  const to = message.to;

  // Ignore messages not for us (if addressed)
  if (to && to !== userId) return;

  if (type === 'JOIN' && from && from !== userId) {
    // Another user joined the room — initiate P2P if we have local media
    if (!peerConnections.has(from)) {
      const pc = createPeerConnection(from);
      peerConnections.set(from, pc);
      if (localStream) {
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'OFFER', from: userId, to: from, offer: pc.localDescription });
    }
    return;
  }

  if (type === 'OFFER' && message.offer && from && from !== userId) {
    // Received an offer from a peer
    let pc = peerConnections.get(from);
    if (!pc) {
      pc = createPeerConnection(from);
      peerConnections.set(from, pc);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: 'ANSWER', from: userId, to: from, answer: pc.localDescription });
    return;
  }

  if (type === 'ANSWER' && message.answer && from && from !== userId) {
    const pc = peerConnections.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
    }
    return;
  }

  if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== userId) {
    const pc = peerConnections.get(from);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (err) {
        console.warn('Error adding received ICE candidate', err);
      }
    }
    return;
  }

  if (type === 'LEAVE' && from) {
    // Peer left
    const pc = peerConnections.get(from);
    if (pc) {
      pc.close();
      peerConnections.delete(from);
    }
    removeRemoteVideo(from);
    return;
  }
}

function createPeerConnection(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] }
    ]
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: 'ICE_CANDIDATE', from: userId, to: peerId, candidate: event.candidate });
    }
  };

  pc.ontrack = (event) => {
    console.log('Received remote track from', peerId);
    const stream = event.streams && event.streams[0];
    if (stream) addRemoteVideo(peerId, stream);
  };

  pc.onconnectionstatechange = () => {
    console.log('PC state', pc.connectionState, 'for', peerId);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      peerConnections.delete(peerId);
      removeRemoteVideo(peerId);
    }
  };

  return pc;
}

function addRemoteVideo(peerId, stream) {
  removeRemoteVideo(peerId);
  const v = document.createElement('video');
  v.id = 'toperparty-remote-' + peerId;
  v.autoplay = true;
  v.playsInline = true;
  v.style.position = 'fixed';
  v.style.bottom = '20px';
  v.style.right = (20 + (remoteVideos.size * 180)) + 'px';
  v.style.width = '160px';
  v.style.height = '120px';
  v.style.zIndex = 10001;
  v.style.border = '2px solid #00aaff';
  v.style.borderRadius = '4px';
  try {
    v.srcObject = stream;
  } catch (e) {
    v.src = URL.createObjectURL(stream);
  }
  document.body.appendChild(v);
  remoteVideos.set(peerId, v);
}

function removeRemoteVideo(peerId) {
  const v = remoteVideos.get(peerId);
  if (v) {
    try {
      if (v.srcObject) {
        const s = v.srcObject;
        if (s.getTracks) s.getTracks().forEach(t => t.stop());
      }
    } catch (e) {}
    v.remove();
    remoteVideos.delete(peerId);
  }
}

// Done
