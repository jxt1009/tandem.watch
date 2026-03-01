import { StateManager } from '../managers/state/StateManager.js';
import { NetflixController } from './netflix/NetflixController.js';
import { SyncManager } from '../managers/sync/SyncManager.js';
import { WebRTCManager } from '../services/webrtc/WebRTCManager.js';
import { UIManager } from '../ui/UIManager.js';
import { URLSync } from '../managers/url/URLSync.js';
import { SidebarPanel } from '../ui/SidebarPanel.js';
import { PartyLauncher } from '../ui/PartyLauncher.js';
import { CONFIG } from '../config.js';

console.log('[Content Script] Initializing managers...');

// Don't clean up stale elements on navigation - they should persist
// Only clean up if party is not active
const wasPartyActive = sessionStorage.getItem('tandem_was_active') === 'true';
if (!wasPartyActive) {
  console.log('[Content Script] No active party detected, cleaning up stale elements...');
  const staleContainers = document.querySelectorAll('[id^="tandem-container-"]');
  const staleVideos = document.querySelectorAll('[id^="tandem-remote-"]');
  const staleOverlays = document.querySelectorAll('[id^="tandem-overlay-"]');
  const staleLocalVideo = document.getElementById('tandem-local-preview');
  const staleWaitingIndicator = document.getElementById('tandem-waiting-indicator');

  staleContainers.forEach(el => {
    console.log('[Content Script] Removing stale container:', el.id);
    el.remove();
  });
  staleVideos.forEach(el => {
    console.log('[Content Script] Removing stale video:', el.id);
    el.remove();
  });
  staleOverlays.forEach(el => {
    console.log('[Content Script] Removing stale overlay:', el.id);
    el.remove();
  });
  if (staleLocalVideo) {
    console.log('[Content Script] Removing stale local video');
    staleLocalVideo.remove();
  }
  if (staleWaitingIndicator) {
    console.log('[Content Script] Removing stale waiting indicator');
    staleWaitingIndicator.remove();
  }
} else {
  console.log('[Content Script] Party is active, keeping existing video elements');
}

const stateManager = new StateManager();
const uiManager = new UIManager();
const netflixController = new NetflixController();
const syncManager = new SyncManager(stateManager, netflixController);
const webrtcManager = new WebRTCManager(stateManager, uiManager);

// Callback when we navigate to a different /watch page
const handleWatchPageChange = () => {
  console.log('[Content Script] Watch page changed - reinitializing sync manager');
  const state = stateManager.getState();
  if (state.partyActive) {
    console.log('[Content Script] Party is active, reinitializing sync manager');
    syncManager.teardown();
    syncManager.setup().catch(err => {
      console.error('[Content Script] Failed to reinitialize sync manager:', err);
    });
  } else {
    console.log('[Content Script] Party not active, skipping sync manager reinitialization');
  }
};

// Also initialize sync manager when navigating TO a watch page (not just between watch pages)
const handleNavigationToWatch = () => {
  console.log('[Content Script] Navigated to /watch page');
  const state = stateManager.getState();
  if (state.partyActive) {
    console.log('[Content Script] Party is active, initializing sync manager');
    syncManager.teardown();
    syncManager.setup().catch(err => {
      console.error('[Content Script] Failed to initialize sync manager:', err);
    });
  }
};

// Teardown sync manager when leaving a watch page
const handleLeaveWatch = () => {
  console.log('[Content Script] Left /watch page');
  syncManager.teardown();
};

const urlSync = new URLSync(stateManager, handleWatchPageChange, handleNavigationToWatch, handleLeaveWatch, netflixController, () => syncManager.canBroadcast());
syncManager.setUrlSync(urlSync);
console.log('[Content Script] Managers initialized');

function checkJoinFromLink() {
  const state = stateManager.getState();
  if (state.partyActive) {
    return;
  }

  try {
    const url = new URL(window.location.href);
    const roomId = url.searchParams.get('tandemRoom');
    if (!roomId) {
      return;
    }

    console.log('[Content Script] Found tandemRoom in URL, joining room:', roomId);

    // Extract PIN if present
    const pin = url.searchParams.get('pin') || null;

    // Clean the URL so it doesn't keep re-triggering
    url.searchParams.delete('tandemRoom');
    url.searchParams.delete('pin');
    history.replaceState({}, document.title, url.toString());

    chrome.runtime.sendMessage({ type: 'START_PARTY', roomId, pin }, (response) => {
      if (response && response.success) {
        console.log('[Content Script] Joined party from link successfully');
      } else {
        console.error('[Content Script] Failed to join party from link:', response ? response.error : 'Unknown error');
      }
    });
  } catch (e) {
    console.error('[Content Script] Failed to process tandemRoom in URL:', e);
  }
}

let localStream = null;
let videoElementMonitor = null;
let sidebarPanel = null;

// Floating launcher — always mounted on Netflix pages, hidden when party is active
const partyLauncher = new PartyLauncher({
  onStartParty: (username) => {
    partyLauncher.setLoading(true);
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    chrome.runtime.sendMessage({ type: 'START_PARTY', username: username || undefined, pin }, (response) => {
      partyLauncher.setLoading(false);
      if (!response || !response.success) {
        partyLauncher.showStatus(response?.error || 'Failed to start party', true);
        partyLauncher.show();
      }
    });
  },
  onJoinParty: (roomCode, pin, username) => {
    partyLauncher.setLoading(true);
    // roomCode may be a short ID — resolve to full roomId via API
    const serverUrl = CONFIG.WS.URL.replace(/^wss?:\/\//, 'https://').replace(/\/ws$/, '');
    fetch(`${serverUrl}/api/room/${encodeURIComponent(roomCode)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const roomId = data.roomId || roomCode;
        chrome.runtime.sendMessage({ type: 'START_PARTY', roomId, username: username || undefined, pin: pin || undefined }, (response) => {
          partyLauncher.setLoading(false);
          if (!response || !response.success) {
            partyLauncher.showStatus(response?.error || 'Failed to join party', true);
            partyLauncher.show();
          }
        });
      })
      .catch(() => {
        // Server unreachable or short ID not found — try roomCode as raw roomId
        chrome.runtime.sendMessage({ type: 'START_PARTY', roomId: roomCode, username: username || undefined, pin: pin || undefined }, (response) => {
          partyLauncher.setLoading(false);
          if (!response || !response.success) {
            partyLauncher.showStatus(response?.error || 'Failed to join party', true);
            partyLauncher.show();
          }
        });
      });
  },
});

// Mount launcher once the DOM is ready (content script runs at document_start)
function mountLauncher() {
  if (document.body) {
    partyLauncher.mount();
    // If party was already active (e.g. restored session), hide the launcher
    if (wasPartyActive) partyLauncher.hide();
  } else {
    document.addEventListener('DOMContentLoaded', () => partyLauncher.mount(), { once: true });
  }
}
mountLauncher();

// Try to get a media stream, gracefully falling back if camera or mic is absent.
// Returns a MediaStream (possibly with fewer tracks than requested) or null if no
// devices are available at all. Never throws — callers can proceed without media.
async function getLocalStreamWithFallback() {
  const attempts = [
    { video: true, audio: true },
    { video: false, audio: true },  // no camera
    { video: true, audio: false },  // no microphone
  ];
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const kinds = stream.getTracks().map(t => t.kind).join('+');
      console.log('[Content Script] Got media stream:', kinds || 'none');
      return stream;
    } catch (err) {
      console.warn('[Content Script] getUserMedia failed with', JSON.stringify(constraints), '-', err.name, err.message);
    }
  }
  console.warn('[Content Script] No media devices available, proceeding without stream');
  return null;
}

// If party was active before this page load, try to restore videos immediately
if (wasPartyActive) {
  console.log('[Content Script] Party was active, checking for restoration state...');
  setTimeout(() => {
    // Give the page a moment to initialize
    const state = stateManager.getState();
    if (state.partyActive && localStream) {
      console.log('[Content Script] Restoring local preview video after navigation');
      const existingPreview = document.getElementById('tandem-local-preview');
      if (!existingPreview) {
        uiManager.attachLocalPreview(localStream);
      }
    }
  }, 100);
}

// Monitor and restore video elements if they get removed during navigation
function startVideoElementMonitoring() {
  if (videoElementMonitor) return;
  
  videoElementMonitor = setInterval(() => {
    const state = stateManager.getState();
    if (!state.partyActive) return;
    
    // When sidebar is active, it manages all video elements — no need to check DOM IDs
    if (sidebarPanel) return;
    
    // Check if local preview exists
    if (localStream && !document.getElementById('tandem-local-preview')) {
      console.log('[Content Script] Local preview missing, re-attaching');
      uiManager.attachLocalPreview(localStream);
    }
    
    // Check if remote videos exist
    const remoteStreams = uiManager.getRemoteStreams();
    remoteStreams.forEach((stream, peerId) => {
      const videoId = 'tandem-remote-' + peerId;
      if (!document.getElementById(videoId)) {
        console.log('[Content Script] Remote video missing for peer:', peerId, 're-adding');
        const videoManager = webrtcManager.videoManager;
        if (videoManager && videoManager.add) {
          videoManager.add(peerId, stream);
        }
      }
    });
  }, 250); // Check every 250ms for faster restoration
  
  console.log('[Content Script] Started video element monitoring');
}

function stopVideoElementMonitoring() {
  if (videoElementMonitor) {
    clearInterval(videoElementMonitor);
    videoElementMonitor = null;
    console.log('[Content Script] Stopped video element monitoring');
  }
}

async function fetchAndSetShareInfo(roomId, pin) {
  if (!sidebarPanel) return;
  try {
    const serverUrl = CONFIG.WS.URL.replace(/^wss?:\/\//, 'https://').replace(/\/ws$/, '');
    const response = await fetch(`${serverUrl}/api/short-id/${encodeURIComponent(roomId)}`);
    if (response.ok) {
      const data = await response.json();
      const shortId = data.shortId;
      const shareLink = `${serverUrl}/room/${shortId}${pin ? '/' + pin : ''}`;
      sidebarPanel.setShareInfo(shortId, shareLink, pin);
    } else {
      sidebarPanel.setShareInfo(roomId.substring(0, 8), null, pin);
    }
  } catch (err) {
    console.warn('[Content Script] Could not fetch share info:', err);
    sidebarPanel.setShareInfo(roomId.substring(0, 8), null, pin);
  }
}

checkJoinFromLink();

// Shared restoration helper — called from both the sessionStorage and GET_STATUS paths
let _restorationInProgress = false;

function applyPartyRestore(response) {
  if (stateManager.isActive()) {
    console.log('[Content Script] Party already active, skipping duplicate restore');
    return;
  }
  console.log('[Content Script] Applying party restore for userId:', response.userId);
  stateManager.startParty(response.userId, response.roomId);

  if (!sidebarPanel) {
    sidebarPanel = new SidebarPanel({
      onLeave: () => { chrome.runtime.sendMessage({ type: 'STOP_PARTY' }); },
      onToggleGuestControl: (enabled) => {
        stateManager.safeSendMessage({ type: 'TOGGLE_GUEST_CONTROL', enabled });
        syncManager.setGuestControlEnabled(enabled);
      },
      onTransferHost: (targetUserId) => {
        stateManager.safeSendMessage({ type: 'TRANSFER_HOST', targetUserId });
      },
      onToggleMic: () => {
        if (!localStream) return;
        const tracks = localStream.getAudioTracks();
        if (!tracks.length) return;
        const newEnabled = !tracks[0].enabled;
        tracks.forEach(t => { t.enabled = newEnabled; });
        sidebarPanel.setMediaState(newEnabled, localStream.getVideoTracks()[0]?.enabled ?? true);
      },
      onToggleCamera: () => {
        if (!localStream) return;
        const tracks = localStream.getVideoTracks();
        if (!tracks.length) return;
        const newEnabled = !tracks[0].enabled;
        tracks.forEach(t => { t.enabled = newEnabled; });
        sidebarPanel.setMediaState(localStream.getAudioTracks()[0]?.enabled ?? true, newEnabled);
      },
      onUsernameChange: (newName) => {
        if (chrome?.storage?.local) chrome.storage.local.set({ tandemUsername: newName }, () => {});
        chrome.runtime.sendMessage({ type: 'UPDATE_USERNAME', username: newName });
      },
    });
    sidebarPanel.mount();
    const restoredUsername = response.username || response.userId;
    sidebarPanel.setLocalUserId(response.userId, restoredUsername);
    sidebarPanel.setUsername(restoredUsername);
    fetchAndSetShareInfo(response.roomId, response.pin || null);
    webrtcManager.setSidebarPanel(sidebarPanel);
    partyLauncher.hide();
  }

  // Re-obtain media stream and finish setup
  getLocalStreamWithFallback().then(stream => {
    localStream = stream;
    if (stream) {
      webrtcManager.setLocalStream(stream);
      webrtcManager.onLocalStreamAvailable(stream);
      if (sidebarPanel) {
        const myId = stateManager.getUserId();
        if (myId) sidebarPanel.setLocalStream(myId, stream);
        sidebarPanel.setMediaState(
          stream.getAudioTracks()[0]?.enabled ?? false,
          stream.getVideoTracks()[0]?.enabled ?? false
        );
      }
    } else {
      console.warn('[Content Script] No media devices after restoration — rejoining without camera/mic');
    }
    syncManager.teardown();
    syncManager.setup().catch(err => console.error('[Content Script] Sync manager setup failed after restore:', err));
    urlSync.start();
    startVideoElementMonitoring();
  }).catch(err => console.error('[Content Script] Media stream failed after restore:', err))
    .finally(() => setTimeout(() => stateManager.setRestoringFlag(false), 2000));
}

// Path A: sessionStorage has tandem_restore (beforeunload fired before page reload)
(function checkRestorePartyState() {
  const restorationState = urlSync.getRestorationState();
  if (!restorationState) return;
  console.log('[Content Script] Session storage restore for room:', restorationState.roomId);
  urlSync.clearState();
  stateManager.setRestoringFlag(true);
  _restorationInProgress = true;
  chrome.runtime.sendMessage({ type: 'RESTORE_PARTY', roomId: restorationState.roomId }, (response) => {
    _restorationInProgress = false;
    if (response && response.success) {
      applyPartyRestore(response);
    } else {
      console.error('[Content Script] Party restoration failed:', response?.error);
      setTimeout(() => stateManager.setRestoringFlag(false), 2000);
    }
  });
})();

// Path B: background has active party but sessionStorage has no record
// (covers cases where beforeunload didn't fire, e.g. Netflix navigated via location.href)
function checkBackgroundPartyState() {
  if (_restorationInProgress || stateManager.isActive() || urlSync.getRestorationState()) return;
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (status) => {
    if (!status || !status.isActive) return;
    if (_restorationInProgress || stateManager.isActive()) return; // raced with Path A
    console.log('[Content Script] Background has active party (no sessionStorage) — restoring');
    stateManager.setRestoringFlag(true);
    _restorationInProgress = true;
    chrome.runtime.sendMessage({ type: 'RESTORE_PARTY', roomId: status.roomId }, (response) => {
      _restorationInProgress = false;
      if (response && response.success) {
        applyPartyRestore(response);
      } else {
        console.error('[Content Script] Background restore failed:', response?.error);
        setTimeout(() => stateManager.setRestoringFlag(false), 2000);
      }
    });
  });
}

// Run path B after DOM is ready (need document.body to mount sidebar)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkBackgroundPartyState, { once: true });
} else {
  checkBackgroundPartyState();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content Script] Received message:', request.type);

  if (request.type === 'TOGGLE_LAUNCHER') {
    // Extension icon was clicked — toggle launcher or sidebar
    if (sidebarPanel) {
      sidebarPanel._toggleCollapse?.();
    } else {
      partyLauncher.toggle();
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'GET_MEDIA_STATE') {
    const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;
    const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
    sendResponse({
      success: true,
      state: {
        audioEnabled: audioTrack ? audioTrack.enabled : false,
        videoEnabled: videoTrack ? videoTrack.enabled : false,
        hasStream: !!localStream,
      },
    });
    return true;
  }

  if (request.type === 'TOGGLE_MIC') {
    if (!localStream) {
      sendResponse({ success: false, error: 'No local stream' });
      return true;
    }
    const tracks = localStream.getAudioTracks();
    if (!tracks.length) {
      sendResponse({ success: false, error: 'No audio track' });
      return true;
    }
    const newEnabled = !tracks[0].enabled;
    tracks.forEach(t => { t.enabled = newEnabled; });
    sendResponse({
      success: true,
      state: {
        audioEnabled: newEnabled,
        videoEnabled: localStream.getVideoTracks()[0]?.enabled ?? false,
        hasStream: true,
      },
    });
    return true;
  }

  if (request.type === 'TOGGLE_CAMERA') {
    if (!localStream) {
      sendResponse({ success: false, error: 'No local stream' });
      return true;
    }
    const tracks = localStream.getVideoTracks();
    if (!tracks.length) {
      sendResponse({ success: false, error: 'No video track' });
      return true;
    }
    const newEnabled = !tracks[0].enabled;
    tracks.forEach(t => { t.enabled = newEnabled; });
    sendResponse({
      success: true,
      state: {
        audioEnabled: localStream.getAudioTracks()[0]?.enabled ?? false,
        videoEnabled: newEnabled,
        hasStream: true,
      },
    });
    return true;
  }
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    console.log('[Content Script] Processing REQUEST_MEDIA_STREAM');
    getLocalStreamWithFallback()
      .then(stream => {
        localStream = stream;
        if (stream) {
          console.log('[Content Script] Media stream obtained, tracks:', stream.getTracks().length);
          webrtcManager.setLocalStream(stream);
          webrtcManager.onLocalStreamAvailable(stream);
          // Show local camera in sidebar tile; fallback to floating preview if no sidebar
          if (sidebarPanel) {
            const myId = stateManager.getUserId();
            if (myId) sidebarPanel.setLocalStream(myId, stream);
            // Set initial mic/cam state in sidebar
            const audioEnabled = stream.getAudioTracks()[0]?.enabled ?? false;
            const videoEnabled = stream.getVideoTracks()[0]?.enabled ?? false;
            sidebarPanel.setMediaState(audioEnabled, videoEnabled);
          } else {
            uiManager.attachLocalPreview(stream);
          }
        } else {
          console.warn('[Content Script] No media devices — joining without camera/mic');
        }
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Content Script] Failed to get media stream:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.type === 'PARTY_STARTED') {
    console.log('[Content Script] Party started:', request.userId, request.roomId);
    stateManager.startParty(request.userId, request.roomId);

    // Create and mount sidebar
    if (sidebarPanel) sidebarPanel.destroy();
    sidebarPanel = new SidebarPanel({
      onLeave: () => {
        chrome.runtime.sendMessage({ type: 'STOP_PARTY' });
      },
      onToggleGuestControl: (enabled) => {
        stateManager.safeSendMessage({ type: 'TOGGLE_GUEST_CONTROL', enabled });
        syncManager.setGuestControlEnabled(enabled);
      },
      onTransferHost: (targetUserId) => {
        stateManager.safeSendMessage({ type: 'TRANSFER_HOST', targetUserId });
      },
      onToggleMic: () => {
        if (!localStream) return;
        const tracks = localStream.getAudioTracks();
        if (!tracks.length) return;
        const newEnabled = !tracks[0].enabled;
        tracks.forEach(t => { t.enabled = newEnabled; });
        const videoEnabled = localStream.getVideoTracks()[0]?.enabled ?? true;
        sidebarPanel.setMediaState(newEnabled, videoEnabled);
      },
      onToggleCamera: () => {
        if (!localStream) return;
        const tracks = localStream.getVideoTracks();
        if (!tracks.length) return;
        const newEnabled = !tracks[0].enabled;
        tracks.forEach(t => { t.enabled = newEnabled; });
        const audioEnabled = localStream.getAudioTracks()[0]?.enabled ?? true;
        sidebarPanel.setMediaState(audioEnabled, newEnabled);
      },
      onUsernameChange: (newName) => {
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ tandemUsername: newName }, () => {});
        }
        chrome.runtime.sendMessage({ type: 'UPDATE_USERNAME', username: newName });
      },
    });
    sidebarPanel.mount();

    // Set local user tile
    const myUsername = request.username || request.userId;
    sidebarPanel.setLocalUserId(request.userId, myUsername);
    sidebarPanel.setUsername(myUsername);

    // Attach local stream to the sidebar tile if we already have it
    // (REQUEST_MEDIA_STREAM completes before PARTY_STARTED arrives)
    if (localStream) {
      sidebarPanel.setLocalStream(request.userId, localStream);
      const audioEnabled = localStream.getAudioTracks()[0]?.enabled ?? false;
      const videoEnabled = localStream.getVideoTracks()[0]?.enabled ?? false;
      sidebarPanel.setMediaState(audioEnabled, videoEnabled);
      // Clean up the floating local preview if it was created as a fallback
      uiManager.removeLocalPreview();
    }

    // Fetch/display share info (room code + PIN + invite link)
    fetchAndSetShareInfo(request.roomId, request.pin || null);

    // Wire sidebar into WebRTC so video streams route to tiles
    webrtcManager.setSidebarPanel(sidebarPanel);

    // Hide the in-page launcher — sidebar takes over
    partyLauncher.hide();
    
    // Set Netflix volume to 15%
    setTimeout(() => {
      netflixController.setVolume(0.15).then(() => {
        console.log('[Content Script] Set Netflix volume to 15%');
      }).catch(err => {
        console.warn('[Content Script] Failed to set volume:', err);
      });
    }, 1000);
    
    // Teardown existing sync manager if already set up
    syncManager.teardown();
    
    // Setup sync manager (will wait for video element)
    syncManager.setup().catch(err => {
      console.error('[Content Script] Failed to setup sync manager:', err);
    });
    
    urlSync.start();
    startVideoElementMonitoring();
    sendResponse({ success: true });
  }

  if (request.type === 'ROOM_STATE') {
    if (request.hostUserId) {
      console.log('[Content Script] Room state received - hostUserId:', request.hostUserId, 'guestControl:', request.guestControlEnabled);
      syncManager.setHostUserId(request.hostUserId);
      syncManager.setGuestControlEnabled(request.guestControlEnabled || false);
    }
    if (sidebarPanel) {
      if (request.hostUserId) sidebarPanel.setHost(request.hostUserId);
      sidebarPanel.setGuestControlEnabled(request.guestControlEnabled || false);
      // Add any existing participants we don't know about yet
      const myId = stateManager.getUserId();
      (request.users || []).forEach(u => {
        if (u.userId && u.userId !== myId) {
          const isHost = u.userId === request.hostUserId;
          sidebarPanel.addParticipant(u.userId, u.username || u.userId, isHost, false);
        }
      });
    }
  }

  if (request.type === 'HOST_CHANGED') {
    if (request.hostUserId) {
      console.log('[Content Script] Host changed - new hostUserId:', request.hostUserId);
      syncManager.setHostUserId(request.hostUserId);
      if (sidebarPanel) sidebarPanel.setHost(request.hostUserId);
    }
  }

  if (request.type === 'GUEST_CONTROL') {
    console.log('[Content Script] Guest control changed:', request.enabled);
    syncManager.setGuestControlEnabled(request.enabled);
    if (sidebarPanel) sidebarPanel.setGuestControlEnabled(request.enabled);
  }

  if (request.type === 'USERNAME_UPDATED') {
    if (sidebarPanel && request.userId && request.username) {
      sidebarPanel.updateUsername(request.userId, request.username);
    }
  }

  if (request.type === 'PARTY_STOPPED') {
    console.log('[Content Script] Stopping party');
    stopVideoElementMonitoring();
    stateManager.stopParty();
    syncManager.teardown();
    urlSync.stop();
    urlSync.clearState();
    webrtcManager.clearAll();
    uiManager.removeLocalPreview();
    uiManager.removeConnectionIndicator();
    if (sidebarPanel) {
      sidebarPanel.destroy();
      sidebarPanel = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    // Show the launcher again so the user can start/join another party
    partyLauncher.show();
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL') {
    const msg = request.message;
    console.log('[Content Script] Handling SIGNAL:', msg?.type);

    // Update sidebar for participant join/leave
    if (sidebarPanel && msg) {
      const myId = stateManager.getUserId();
      if (msg.type === 'USER_JOINED' && msg.userId && msg.userId !== myId) {
        sidebarPanel.addParticipant(msg.userId, msg.username || msg.userId, false, false);
      } else if ((msg.type === 'USER_LEFT' || msg.type === 'LEAVE') && msg.userId && msg.userId !== myId) {
        sidebarPanel.removeParticipant(msg.userId);
      }
    }

    webrtcManager.handleSignal(msg);
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    // Only apply playback controls if we're on a /watch page
    if (!window.location.pathname.startsWith('/watch')) {
      console.log('[Content Script] Ignoring playback control - not on /watch page');
      return;
    }
    console.log('[Content Script] Applying playback control:', request.control, 'at', request.currentTime, 'from', request.fromUserId);
    syncManager.handlePlaybackControl(request.control, request.currentTime, request.fromUserId, request.eventTimestamp);
  }

  if (request.type === 'APPLY_PLAYBACK_ACK') {
    syncManager.handlePlaybackAck(request.control);
  }

  // Passive sync removed - using event-based sync only

  if (request.type === 'APPLY_SEEK') {
    // Only apply seek if we're on a /watch page
    if (!window.location.pathname.startsWith('/watch')) {
      console.log('[Content Script] Ignoring seek - not on /watch page');
      return;
    }
    syncManager.handleSeek(request.currentTime, request.isPlaying, request.fromUserId, request.eventTimestamp);
  }

  if (request.type === 'APPLY_SEEK_PAUSE') {
    if (!window.location.pathname.startsWith('/watch')) {
      console.log('[Content Script] Ignoring seek-pause - not on /watch page');
      return;
    }
    syncManager.handleSeekPause(request.currentTime, request.fromUserId);
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    console.log('[Content Script] Received URL change request:', request.url, 'time:', request.currentTime, 'from', request.fromUserId);
    
    // Mark this URL so we don't echo it back
    try {
      const normalized = urlSync.normalizeUrl(request.url);
      sessionStorage.setItem('tandem_last_remote_url', normalized);
      setTimeout(() => sessionStorage.removeItem('tandem_last_remote_url'), 2000);
    } catch (e) {}
    
    if (stateManager.restoringPartyState) {
      console.log('[Content Script] Ignoring URL change - currently restoring party state');
      return;
    }
    
    // Apply URL changes to all Netflix pages (browse, title, watch, etc.)
    const incomingUrl = new URL(request.url);
    const currentUrl = new URL(window.location.href);

    // Prevent bouncing back to previous episode during auto-advance
    if (window.location.pathname.startsWith('/watch')) {
      try {
        const transitionRaw = sessionStorage.getItem('tandem_watch_transition');
        if (transitionRaw) {
          const transition = JSON.parse(transitionRaw);
          const withinWindow = Date.now() - transition.timestamp < 15000;
          const isBounceBack = transition.from === request.url && transition.to === window.location.href;
          if (withinWindow && isBounceBack) {
            console.log('[Content Script] Ignoring URL change back to previous episode during auto-advance');
            return;
          }
        }
      } catch (e) {
        console.warn('[Content Script] Failed to check watch transition state:', e);
      }
    }
    
    // For /watch pages, merge the video ID and trackId into current URL params
    let targetUrl = request.url;
    const incomingPath = incomingUrl.pathname;
    const currentPath = currentUrl.pathname;
    const bothAreWatch = currentPath.startsWith('/watch') && incomingPath.startsWith('/watch');
    
    if (bothAreWatch) {
      // Preserve current URL params, just update video ID and trackId
      const mergedUrl = new URL(currentUrl.href);
      mergedUrl.pathname = incomingUrl.pathname; // Update video ID in path
      
      // Update or add trackId if present in incoming URL
      const incomingTrackId = incomingUrl.searchParams.get('trackId');
      if (incomingTrackId) {
        mergedUrl.searchParams.set('trackId', incomingTrackId);
      }
      
      targetUrl = mergedUrl.href;
      console.log('[Content Script] Merged URL preserving params:', targetUrl);
    }
    
    // Don't navigate if we're already on this URL (compare normalized versions)
    const normalizedCurrent = urlSync.normalizeUrl(window.location.href);
    const normalizedTarget = urlSync.normalizeUrl(targetUrl);
    if (normalizedCurrent === normalizedTarget) {
      console.log('[Content Script] Already on this URL (normalized), skipping navigation');
      
      // But still sync to initiator's time if provided
      if (request.currentTime !== undefined && request.currentTime !== null) {
        console.log('[Content Script] Syncing to initiator\'s time:', request.currentTime);
        syncManager.handleSeekPause(request.currentTime, request.fromUserId);
      }
      return;
    }
    
    console.log('[Content Script] Navigating to:', targetUrl);
    // Save state before navigating (for restoration if on /watch page)
    if (currentPath.startsWith('/watch')) {
      urlSync.saveState();
    }
    
    // Store the initiator's time for post-navigation sync
    if (request.currentTime !== undefined && request.currentTime !== null) {
      sessionStorage.setItem('tandem_pending_seek_time', request.currentTime.toString());
      console.log('[Content Script] Storing pending seek time:', request.currentTime);
    }
    
    // For /watch to /watch navigation (episode changes), always force reload
    // Netflix player doesn't respond to pushState for episode changes
    if (bothAreWatch) {
      console.log('[Content Script] Watch-to-watch navigation detected, forcing full reload');
      window.location.href = targetUrl;
      return;
    }
    
    // For other navigation (browse to watch, etc), try SPA navigation
    try {
      window.history.pushState({}, '', targetUrl);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      console.log('[Content Script] SPA navigation triggered');
    } catch (e) {
      console.error('[Content Script] Failed to navigate via pushState, falling back to full reload:', e);
      window.location.href = request.url;
    }
  }

  if (request.type === 'HANDLE_REQUEST_SYNC') {
    // Only handle sync requests if we're on a /watch page
    if (!window.location.pathname.startsWith('/watch')) {
      console.log('[Content Script] Ignoring sync request - not on /watch page');
      return;
    }
    syncManager.handleRequestSync(request.fromUserId, request.respectAutoPlay);
  }

  if (request.type === 'APPLY_SYNC_RESPONSE') {
    // Only apply sync response if we're on a /watch page
    if (!window.location.pathname.startsWith('/watch')) {
      console.log('[Content Script] Ignoring sync response - not on /watch page');
      return;
    }
    console.log('[Content Script] Applying sync response from', request.fromUserId, 'URL:', request.url, request.respectAutoPlay ? '(respecting auto-play)' : '');
    syncManager.handleSyncResponse(request.currentTime, request.isPlaying, request.fromUserId, request.url, request.respectAutoPlay);
  }

  if (request.type === 'HOST_HEARTBEAT') {
    if (!window.location.pathname.startsWith('/watch')) {
      return;
    }
    syncManager.handleHostHeartbeat(request.currentTime, request.isPlaying, request.fromUserId, request.eventTimestamp);
  }

  if (request.type === 'REQUEST_INITIAL_SYNC_AND_PLAY') {
    console.log('[Content Script] Requesting initial sync and will auto-play when synced');
    // Request sync from other clients
    stateManager.safeSendMessage({ type: 'REQUEST_SYNC' });
  }

  if (request.type === 'CONNECTION_STATUS') {
    console.log('[Content Script] Connection status changed:', request.status);
    uiManager.updateConnectionIndicator(request.status);
    // Sidebar doesn't have a dedicated connection status bar, but the participant tiles
    // already show individual connection state via setConnectionStatus.
  }

  if (request.type === 'RECONNECTED') {
    console.log('[Content Script] WebSocket reconnected, userId:', request.userId);
  }

  if (request.type === 'REQUEST_SYNC_AFTER_RECONNECT') {
    // Only request sync if we're on a /watch page and party is active
    if (window.location.pathname.startsWith('/watch') && stateManager.isActive()) {
      console.log('[Content Script] Requesting sync after reconnection');
      stateManager.safeSendMessage({ type: 'REQUEST_SYNC' });
    }
  }
});

window.addEventListener('beforeunload', () => {
  if (stateManager.isActive()) {
    urlSync.saveState();
  }
});
