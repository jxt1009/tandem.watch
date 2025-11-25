// content-script.js - Injected into Netflix pages

let partyActive = false;
let userId = null;
let roomId = null;
let localStream = null;
let localPreviewVideo = null;
const peerConnections = new Map();
const remoteVideos = new Map();
const remoteStreams = new Map();

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
        
        // Monitor stream tracks for unexpected ending
        stream.getTracks().forEach(function(track) {
          console.log('Local stream track obtained:', track.kind, 'id=', track.id, 'readyState=', track.readyState);
          track.onended = function() {
            console.error('LOCAL STREAM TRACK ENDED UNEXPECTEDLY:', track.kind, 'id=', track.id);
          };
          track.onmute = function() {
            console.warn('Local stream track muted:', track.kind);
          };
          track.onunmute = function() {
            console.log('Local stream track unmuted:', track.kind);
          };
        });
        
        // Create or update local preview
        attachLocalPreview(stream);
          // add or replace tracks to any existing peer connections
          peerConnections.forEach((pc) => {
            try { stream.getTracks().forEach(t => addOrReplaceTrack(pc, t, stream)); } catch (e) { console.warn('Error adding tracks to pc', e); }
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
  waitForVideo().then(function onVideoReady(video) {
    if (!video) {
      console.warn('Netflix video element not found after wait');
      return;
    }

    // Track play/pause events
    const onPlay = function handlePlayEvent() {
      if (partyActive) {
        chrome.runtime.sendMessage({ type: 'PLAY_PAUSE', control: 'play', timestamp: video.currentTime }).catch(function() {});
      }
    };

    const onPause = function handlePauseEvent() {
      if (partyActive) {
        chrome.runtime.sendMessage({ type: 'PLAY_PAUSE', control: 'pause', timestamp: video.currentTime }).catch(function() {});
      }
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    // Throttled timeupdate sender (every ~1s at most)
    let lastSentAt = 0;
    const onTimeUpdate = function handleTimeUpdate() {
      if (!partyActive) return;
      const now = Date.now();
      if (now - lastSentAt < 1000) return; // throttle to ~1s
      lastSentAt = now;
      chrome.runtime.sendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused }).catch(function() {});
    };

    video.addEventListener('timeupdate', onTimeUpdate);

    // Periodic fallback sync (every 5 seconds)
    window.playbackSyncInterval = setInterval(function syncPlaybackPeriodic() {
      if (partyActive && video) {
        chrome.runtime.sendMessage({ type: 'SYNC_TIME', currentTime: video.currentTime, isPlaying: !video.paused }).catch(function() {});
      }
    }, 5000);

    // Save references for teardown
    window.__toperparty_video_listeners = { onPlay, onPause, onTimeUpdate, video };

    console.log('Playback sync setup complete');
  }).catch(function onVideoWaitError(err) {
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

  // Log track states and attach ended listeners for debugging
  try {
    if (stream && stream.getTracks) {
      stream.getTracks().forEach((t) => {
        console.log('Local track:', t.kind, 'readyState=', t.readyState);
        t.onended = () => console.warn('Local track ended:', t.kind);
      });
    }
  } catch (e) {}

  console.log('Attached local preview, tracks=', (stream && stream.getTracks) ? stream.getTracks().length : 0);
}

function removeLocalPreview() {
  if (localPreviewVideo) {
    try {
      // Do NOT stop the captured stream's tracks here - stopping the preview
      // element should not stop the camera/mic itself. Clearing the srcObject
      // prevents the element from holding the stream reference.
      if (localPreviewVideo.srcObject) {
        try { localPreviewVideo.srcObject = null; } catch (e) {}
      }
    } catch (e) {}
    try { localPreviewVideo.remove(); } catch (e) {}
    localPreviewVideo = null;
  }
}

// Add or replace a track on an RTCPeerConnection to avoid duplicate senders
function addOrReplaceTrack(pc, track, stream) {
  try {
    const kind = track.kind;
    const sender = pc.getSenders().find(s => s.track && s.track.kind === kind);
    if (sender) {
      // replace existing track
      sender.replaceTrack(track);
      console.log('Replaced sender track for kind', kind);
    } else {
      pc.addTrack(track, stream);
      console.log('Added sender track for kind', kind);
    }
  } catch (e) {
    console.warn('addOrReplaceTrack failed', e);
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
        localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
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
      localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
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
    console.log('Received remote track from', peerId, 'track=', event.track && event.track.kind);
    // Some browsers populate event.streams[0], others deliver individual tracks.
    let stream = (event.streams && event.streams[0]) || remoteStreams.get(peerId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(peerId, stream);
    }
    if (event.track) {
      try { 
        stream.addTrack(event.track);
        // Monitor track state
        event.track.onended = function() {
          console.warn('Remote track ended from', peerId, 'kind=', event.track.kind);
        };
        console.log('Added remote track to stream, kind=', event.track.kind, 'readyState=', event.track.readyState);
      } catch (e) { 
        console.warn('Failed to add remote track to stream', e); 
      }
    }
    // Only create the video element once, not on every track
    if (!remoteVideos.has(peerId)) {
      addRemoteVideo(peerId, stream);
    }
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
  // Mute remote by default so autoplay will start the video; user can unmute if desired.
  v.muted = true;
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
  try {
    v.play().catch(err => console.warn('Remote video play() failed:', err));
  } catch (e) {}
}

function removeRemoteVideo(peerId) {
  const v = remoteVideos.get(peerId);
  if (v) {
    try {
      // Do NOT stop remote tracks - they are managed by the sender
      // Just clear the srcObject to release the reference
      if (v.srcObject) {
        v.srcObject = null;
      }
    } catch (e) {}
    v.remove();
    remoteVideos.delete(peerId);
  }
  // Also clean up the stream reference
  remoteStreams.delete(peerId);
}

// Done
