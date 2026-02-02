import { CONFIG } from '../config.js';

let status = { isConnected: false, roomId: null, userId: null, hasLocalStream: false };

// Username management
let persistedUsername = null;

async function loadUsername() {
  return new Promise((resolve) => {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['tandemUsername'], (result) => {
        persistedUsername = result.tandemUsername || '';
        if (!persistedUsername) {
          persistedUsername = generateDefaultUsername();
          chrome.storage.local.set({ tandemUsername: persistedUsername }, () => {});
        }
        // Only update label if not currently being edited
        if (usernameLabel && usernameLabel.contentEditable !== 'true') {
          usernameLabel.textContent = persistedUsername;
        }
        resolve(persistedUsername);
      });
      return;
    }

    const stored = localStorage.getItem('tandemUsername') || '';
    persistedUsername = stored || generateDefaultUsername();
    localStorage.setItem('tandemUsername', persistedUsername);
    // Only update label if not currently being edited
    if (usernameLabel && usernameLabel.contentEditable !== 'true') {
      usernameLabel.textContent = persistedUsername;
    }
    resolve(persistedUsername);
  });
}

function generateDefaultUsername() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const suffix = array[0].toString(36).slice(0, 4);
  return `user-${suffix}`;
}

async function saveUsername() {
  const finalUsername = (usernameLabel?.textContent || '').trim() || generateDefaultUsername();
  persistedUsername = finalUsername;
  
  return new Promise((resolve) => {
    const onSaved = () => {
      if (saveUsernameBtn) {
        saveUsernameBtn.classList.add('hidden');
      }
      if (editUsernameBtn) {
        editUsernameBtn.classList.remove('hidden');
      }
      if (usernameLabel) {
        usernameLabel.contentEditable = 'false';
        usernameLabel.textContent = finalUsername;
      }
      chrome.runtime.sendMessage({ type: 'UPDATE_USERNAME', username: finalUsername }, () => {});
      resolve(finalUsername);
    };

    if (chrome?.storage?.local) {
      chrome.storage.local.set({ tandemUsername: finalUsername }, onSaved);
      return;
    }

    localStorage.setItem('tandemUsername', finalUsername);
    onSaved();
  });
}

// Cache DOM elements
let statusEl, statusText, statusControls, controlsSection, joinSection, partyInfo, statsSection, videoSection;
let startBtn, stopBtn, shareLinkEl, roomCodeDisplay, roomCodeInput, joinRoomBtn;
let userDisplay, localTimeEl, syncStatusEl, remoteUsersList, localVideo, remoteVideo;
let copyLinkBtn, copyCodeBtn, copyPinBtn, saveUsernameBtn, serverUrlEl;
let usernameLabel, usernameContainer, editUsernameBtn;
let toggleMicBtn, toggleVideoBtn;
let roomPinInput, roomPinDisplay;
let listenersBound = false;

function initializeDOMElements() {
  statusEl = document.getElementById('status');
  statusText = document.getElementById('status-text');
  statusControls = document.getElementById('status-controls');
  controlsSection = document.getElementById('controls-section');
  joinSection = document.getElementById('join-section');
  partyInfo = document.getElementById('party-info');
  statsSection = document.getElementById('stats-section');
  videoSection = document.getElementById('video-section');
  startBtn = document.getElementById('start-btn');
  stopBtn = document.getElementById('stop-btn');
  shareLinkEl = document.getElementById('share-link');
  roomCodeDisplay = document.getElementById('room-code-display');
  roomCodeInput = document.getElementById('room-code-input');
  joinRoomBtn = document.getElementById('join-room-btn');
  userDisplay = document.getElementById('user-display');
  localTimeEl = document.getElementById('local-time');
  syncStatusEl = document.getElementById('sync-status');
  remoteUsersList = document.getElementById('remote-users-list');
  localVideo = document.getElementById('local-video');
  remoteVideo = document.getElementById('remote-video');
  copyLinkBtn = document.getElementById('copy-link-btn');
  copyCodeBtn = document.getElementById('copy-code-btn');
  copyPinBtn = document.getElementById('copy-pin-btn');
  saveUsernameBtn = document.getElementById('save-username-btn');
  serverUrlEl = document.getElementById('server-url');
  usernameLabel = document.getElementById('user-display');
  usernameContainer = document.getElementById('username-container');
  editUsernameBtn = document.getElementById('edit-username-btn');
  toggleMicBtn = document.getElementById('toggle-mic-btn');
  toggleVideoBtn = document.getElementById('toggle-video-btn');
  roomPinInput = document.getElementById('room-pin-input');
  roomPinDisplay = document.getElementById('room-pin-display');
}

// Import and display server URL from config
try {
  console.log('[Popup] Signaling server configured at:', CONFIG.WS.URL);
} catch (err) {
  console.warn('[Popup] Could not load config:', err);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeDOMElements();
      updateUI();
    setupEventListeners();
    loadUsername().then(() => {
      updateStatus();
      startStatusPolling();
    });
  });
} else {
  // DOM is already loaded
  initializeDOMElements();
    updateUI();
  setupEventListeners();
  loadUsername().then(() => {
    updateStatus();
    startStatusPolling();
  });
}

let lastShareLinkRoomId = null;
let lastShareLink = null;
let lastShortId = null;

async function getOrCreateShortId(roomId) {
  // Query the signaling server to get or create a short ID for this room
  try {
    // Get the server URL from config
    const config = CONFIG;
    const serverUrl = config.WS.URL.replace('wss://', 'https://').replace('/ws', '');
    
    // We'll fetch this from the server - it will create the mapping
    // For now, we'll request via a special endpoint (we'll add this to the server)
    const response = await fetch(`${serverUrl}/api/short-id/${encodeURIComponent(roomId)}`);
    if (!response.ok) {
      throw new Error(`Failed to get short ID: ${response.statusText}`);
    }
    const data = await response.json();
    return data.shortId;
  } catch (err) {
    console.warn('[Popup] Could not get short ID from server, using fallback:', err);
    // Fallback: generate a simple short ID client-side (not persistent)
    return roomId.substring(0, 8);
  }
}

function buildShareLink(roomId, pin) {
  // Build a short URL with PIN in path: /room/shortId/pin
  return new Promise(async (resolve) => {
    try {
      const config = CONFIG;
      const serverUrl = config.WS.URL.replace('wss://', 'https://').replace('/ws', '');
      const shortId = await getOrCreateShortId(roomId);
      const shortUrl = `${serverUrl}/room/${shortId}${pin ? '/' + pin : ''}`;
      resolve(shortUrl);
    } catch (err) {
      console.error('[Popup] Error building share link:', err);
      resolve(`https://watch.toper.dev/room/unknown`);
    }
  });
}

function updateShareLink() {
  if (!shareLinkEl || !status.roomId) return;
  if (status.roomId === lastShareLinkRoomId && lastShareLink) {
    shareLinkEl.textContent = lastShareLink;
    if (roomCodeDisplay && lastShortId) {
      roomCodeDisplay.textContent = lastShortId;
    }
    if (roomPinDisplay && status.pin) {
      roomPinDisplay.textContent = status.pin;
    }
    return;
  }

  buildShareLink(status.roomId, status.pin).then((link) => {
    lastShareLinkRoomId = status.roomId;
    lastShareLink = link;
    shareLinkEl.textContent = link;
    // Extract short ID from link (before query params)
    const match = link.match(/\/room\/([a-z0-9]+)/i);
    if (match && roomCodeDisplay) {
      lastShortId = match[1];
      roomCodeDisplay.textContent = lastShortId;
    }
    // Display PIN
    if (roomPinDisplay && status.pin) {
      roomPinDisplay.textContent = status.pin;
    }
  });
}

async function joinRoomByCode() {
  const rawInput = roomCodeInput.value.trim();
  if (!rawInput) {
    alert('Please enter a room code');
    return;
  }

  const parsed = parseRoomInput(rawInput);
  if (parsed.type === 'invalid' || parsed.type === 'empty') {
    alert('Please enter a valid room code or share link');
    return;
  }

  joinRoomBtn.disabled = true;
  try {
    let roomId = null;
    if (parsed.type === 'roomId') {
      roomId = parsed.roomId;
    } else {
      // Get the server URL from config
      const config = CONFIG;
      const serverUrl = config.WS.URL.replace(/^wss?:\/\//, 'https://').replace(/\/ws$/, '');

      roomId = await resolveRoomIdFromShortId(serverUrl, parsed.shortId);
    }
    
    // Get PIN if provided
    const pin = roomPinInput?.value?.trim() || null;
    
    // Start party with the retrieved roomId, username, and PIN
    chrome.runtime.sendMessage({ type: 'START_PARTY', roomId, username: persistedUsername, pin }, (response) => {
      joinRoomBtn.disabled = false;
      if (response && response.success) {
        roomCodeInput.value = '';
        if (roomPinInput) roomPinInput.value = '';
        setTimeout(updateStatus, 500);
      } else {
        alert('Error: ' + (response && response.error ? response.error : 'Failed to join party'));
      }
    });
  } catch (err) {
    console.error('[Popup] Error joining room:', err);
    alert('Failed to join room: ' + err.message);
    joinRoomBtn.disabled = false;
  }
}

async function resolveRoomIdFromShortId(serverUrl, shortId) {
  // First try the JSON API
  try {
    const response = await fetch(`${serverUrl}/api/room/${encodeURIComponent(shortId)}`);
    if (!response.ok) {
      throw new Error('Room code not found');
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      // If server doesn't support /api/room, fall through to redirect-based lookup
      if (!text.includes('Signaling server running')) {
        throw new Error(`Unexpected response from server: ${text.slice(0, 160)}`);
      }
    } else {
      const data = await response.json();
      if (data && data.roomId) return data.roomId;
    }
  } catch (err) {
    if (err?.message === 'Room code not found') {
      throw err;
    }
  }

  // Fallback: use /room/:shortId redirect and extract tandemRoom from Location header
  const redirectResponse = await fetch(`${serverUrl}/room/${encodeURIComponent(shortId)}`, {
    redirect: 'manual'
  });

  const location = redirectResponse.headers.get('location');
  if (location) {
    const match = location.match(/[?&]tandemRoom=([^&]+)/i);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  throw new Error('Room codes are not supported on this server. Ask the host for a full Netflix link with ?tandemRoom=... or update the signaling server.');
}

function parseRoomInput(input) {
  if (!input) return { type: 'empty' };
  const trimmed = input.trim();

  const tandemRoomMatch = trimmed.match(/[?&]tandemRoom=([^&]+)/i);
  if (tandemRoomMatch) {
    return { type: 'roomId', roomId: decodeURIComponent(tandemRoomMatch[1]) };
  }

  const roomUrlMatch = trimmed.match(/\/room\/([a-z0-9]+)/i);
  if (roomUrlMatch) {
    return { type: 'shortId', shortId: roomUrlMatch[1] };
  }

  const uuidMatch = trimmed.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (uuidMatch) {
    return { type: 'roomId', roomId: trimmed };
  }

  const shortIdMatch = trimmed.match(/^([a-z0-9]{3,})$/i);
  if (shortIdMatch) {
    return { type: 'shortId', shortId: shortIdMatch[1] };
  }

  return { type: 'invalid' };
}

function setupEventListeners() {
  if (listenersBound) return;
  listenersBound = true;

  if (startBtn) {
  startBtn.addEventListener('click', startParty);
  }
  if (stopBtn) {
  stopBtn.addEventListener('click', stopParty);
  }
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', copyShareLink);
  }
  if (copyCodeBtn) {
    copyCodeBtn.addEventListener('click', () => {
      if (!lastShortId) return;
      navigator.clipboard.writeText(lastShortId);
      copyCodeBtn.textContent = '✓';
      setTimeout(() => { copyCodeBtn.textContent = 'Copy'; }, 1500);
    });
  }
  if (copyPinBtn) {
    copyPinBtn.addEventListener('click', () => {
      if (!status.pin) return;
      navigator.clipboard.writeText(status.pin);
      copyPinBtn.textContent = '✓';
      setTimeout(() => { copyPinBtn.textContent = 'Copy'; }, 1500);
    });
  }
  if (joinRoomBtn) {
    joinRoomBtn.addEventListener('click', joinRoomByCode);
  }
  if (roomCodeInput) {
    roomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        joinRoomByCode();
      }
    });
  }
  if (saveUsernameBtn) {
    saveUsernameBtn.addEventListener('click', saveUsername);
  }
  if (toggleMicBtn) {
    toggleMicBtn.addEventListener('click', () => toggleMedia('audio'));
  }
  if (toggleVideoBtn) {
    toggleVideoBtn.addEventListener('click', () => toggleMedia('video'));
  }
  if (editUsernameBtn) {
    editUsernameBtn.addEventListener('click', () => {
      if (usernameLabel) {
        usernameLabel.contentEditable = 'true';
        usernameLabel.focus();
        // Select all text
        const range = document.createRange();
        range.selectNodeContents(usernameLabel);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      if (editUsernameBtn) {
        editUsernameBtn.classList.add('hidden');
      }
      if (saveUsernameBtn) {
        saveUsernameBtn.classList.remove('hidden');
      }
    });
  }
  if (saveUsernameBtn) {
    saveUsernameBtn.addEventListener('click', saveUsername);
  }
  if (usernameLabel) {
    usernameLabel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveUsername();
      }
      if (e.key === 'Escape') {
        usernameLabel.contentEditable = 'false';
        usernameLabel.textContent = persistedUsername;
        if (saveUsernameBtn) {
          saveUsernameBtn.classList.add('hidden');
        }
        if (editUsernameBtn) {
          editUsernameBtn.classList.remove('hidden');
        }
      }
    });
  }
}

function sendToNetflixTab(message, callback) {
  chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      callback && callback({ success: false, error: 'No Netflix tab found' });
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
      if (chrome.runtime.lastError) {
        callback && callback({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      callback && callback(response);
    });
  });
}

function updateMediaButtons(state) {
  if (!state) return;
  if (toggleMicBtn) {
    const micEnabled = state.audioEnabled;
    toggleMicBtn.textContent = micEnabled ? '🎤' : '🔇';
    toggleMicBtn.setAttribute('aria-label', micEnabled ? 'Mute mic' : 'Unmute mic');
    toggleMicBtn.setAttribute('title', micEnabled ? 'Mute mic' : 'Unmute mic');
    toggleMicBtn.classList.toggle('active', !micEnabled);
  }
  if (toggleVideoBtn) {
    const videoEnabled = state.videoEnabled;
    toggleVideoBtn.textContent = videoEnabled ? '📷' : '🚫📷';
    toggleVideoBtn.setAttribute('aria-label', videoEnabled ? 'Turn off camera' : 'Turn on camera');
    toggleVideoBtn.setAttribute('title', videoEnabled ? 'Turn off camera' : 'Turn on camera');
    toggleVideoBtn.classList.toggle('active', !videoEnabled);
  }
}

function toggleMedia(kind) {
  const type = kind === 'audio' ? 'TOGGLE_MIC' : 'TOGGLE_CAMERA';
  sendToNetflixTab({ type }, (response) => {
    if (!response || !response.success) {
      console.warn('[Popup] Media toggle failed:', response?.error);
      return;
    }
    updateMediaButtons(response.state);
  });
}

function refreshMediaState() {
  sendToNetflixTab({ type: 'GET_MEDIA_STATE' }, (response) => {
    if (response && response.success) {
      updateMediaButtons(response.state);
    }
  });
}

function updateStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      status = response;
      updateUI();
    }
  });
}

function updateUI() {
  if (!statusEl || !statusText || !statusControls || !joinSection || !startBtn || !stopBtn || !partyInfo || !statsSection || !videoSection || !userDisplay) {
    console.warn('[Popup] UI elements not ready, skipping update');
    return;
  }
  const { isConnected, roomId, userId } = status;
  if (isConnected) {
    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.className = 'status connected status-minimal';
    }
    statusText.textContent = '🟢 Connected';
    if (statusControls) {
      statusControls.classList.remove('hidden');
    }
    if (controlsSection) {
      controlsSection.classList.remove('hidden');
    }
    joinSection.classList.add('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    partyInfo.classList.remove('hidden');
    statsSection.classList.remove('hidden');
    
    // Display username if set, otherwise show userId
    const displayName = persistedUsername || userId;
    // Only update if not currently being edited
    if (userDisplay && userDisplay.contentEditable !== 'true') {
      userDisplay.textContent = displayName;
    }
    updateShareLink();
    updateStats();
    refreshMediaState();
  } else {
    if (statusEl) {
      statusEl.classList.add('hidden');
      statusEl.className = 'status disconnected status-minimal';
    }
    statusText.textContent = '🔴 Disconnected';
    if (statusControls) {
      statusControls.classList.remove('hidden');
    }
    if (controlsSection) {
      controlsSection.classList.remove('hidden');
    }
    joinSection.classList.remove('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
    statsSection.classList.add('hidden');
    videoSection.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }
}

async function startParty() {
  startBtn.disabled = true;
  statusText.textContent = '⏳ Connecting...';
  
  // Auto-generate a 6-digit PIN
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  
  chrome.runtime.sendMessage({ type: 'START_PARTY', username: persistedUsername, pin }, (response) => {
    if (response.success) {
      setTimeout(updateStatus, 500);
    } else {
      alert('Error: ' + response.error);
      statusText.textContent = '🔴 Disconnected';
      startBtn.disabled = false;
    }
  });
}

function stopParty() {
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    updateStatus();
  });
}

function copyShareLink() {
  if (!status.roomId) return;
  buildShareLink(status.roomId, status.pin).then((link) => {
    navigator.clipboard.writeText(link);
    if (copyLinkBtn) {
      copyLinkBtn.textContent = '✓';
      setTimeout(() => { copyLinkBtn.textContent = 'Copy'; }, 2000);
    }
  });
}

const formatTime = (seconds) => {
  if (seconds === null || seconds === undefined) {
    return '--:--';
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

function startStatusPolling() {
  updateStatus();
  setInterval(updateStatus, 2000);
  // Update stats more frequently when connected
  setInterval(() => {
    if (status.isConnected) {
      updateStats();
    }
  }, 1000);
}

async function updateStats() {
  if (!status.isConnected || !status.roomId) {
    console.log('[Popup] Not connected or no room ID', { isConnected: status.isConnected, roomId: status.roomId });
    return;
  }

  try {
    // Import config to get the server URL
    const config = CONFIG;
    
    // Fetch stats from signaling server (construct HTTP URL from WebSocket URL)
    const httpUrl = config.WS.URL.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://').replace(/\/ws$/, '');
    const statusUrl = httpUrl + '/status';
    
    console.log('[Popup] Fetching stats from server:', statusUrl, 'at', new Date().toISOString());
    const response = await fetch(statusUrl);
    if (!response.ok) {
      console.error('[Popup] Failed to fetch server status:', response.status, response.statusText);
      return;
    }

    const serverStatus = await response.json();
    console.log('[Popup] Server status received at', new Date().toISOString(), ':', serverStatus);
    console.log('[Popup] Looking for room:', status.roomId);

    // Find our room
    const room = serverStatus.rooms?.find(r => r.roomId === status.roomId);
    if (!room) {
      console.log('[Popup] Room not found on server. Available rooms:', serverStatus.rooms?.map(r => r.roomId));
      if (syncStatusEl) {
        syncStatusEl.textContent = 'Not Found';
        syncStatusEl.style.color = '#ef4444';
      }
      return;
    }
    
    console.log('[Popup] Room found:', room);
    console.log('[Popup] Room currentTime:', room.currentTime, 'isPlaying:', room.isPlaying);
    console.log('[Popup] Room users:', room.users);

    // Update local time (use room's currentTime as reference)
    if (localTimeEl) {
      const formattedTime = formatTime(room.currentTime);
      console.log('[Popup] Updating local time from', localTimeEl.textContent, 'to', formattedTime);
      localTimeEl.textContent = formattedTime;
    } else {
      console.log('[Popup] localTimeEl not found!');
    }

    // Update sync status
    if (syncStatusEl) {
      const isPlaying = room.isPlaying ? 'Playing' : 'Paused';
      console.log('[Popup] Setting sync status to:', isPlaying);
      syncStatusEl.textContent = isPlaying;
      syncStatusEl.style.color = room.isPlaying ? '#4ade80' : '#fbbf24';
    } else {
      console.log('[Popup] syncStatusEl not found!');
    }

    // Update user list with individual positions
    if (remoteUsersList) {
      const users = room.users || [];
      
      if (users.length === 0) {
        remoteUsersList.innerHTML = '<div style="color: rgba(255,255,255,0.5); font-size: 12px; font-style: italic;">No users in party</div>';
      } else {
        const userListHTML = users.map((user, index) => {
          const timeDiff = Math.abs(user.currentTime - room.currentTime);
          const isOutOfSync = timeDiff > 2; // More than 2 seconds off
          const statusColor = user.isPlaying ? '#4ade80' : '#fbbf24';
          const syncColor = isOutOfSync ? '#ef4444' : '#4ade80';
          const isCurrentUser = user.userId === status.userId;
          const bgColor = isCurrentUser ? 'rgba(167, 139, 250, 0.1)' : 'transparent';
          const borderColor = isCurrentUser ? '1px solid rgba(167, 139, 250, 0.3)' : '1px solid rgba(255,255,255,0.1)';
          const displayName = isCurrentUser
            ? (persistedUsername || user.username || 'You')
            : (user.username || `${user.userId.substring(0, 8)}...`);
          
          return `
            <div style="padding: 8px; border-top: ${borderColor}; background-color: ${bgColor}; ${index === 0 ? 'border-top: none;' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="font-weight: 600; font-size: 12px; color: rgba(82, 82, 82, 0.9);">
                  ${displayName}${isCurrentUser ? ' (You)' : ''}
                </div>
                <div style="font-size: 10px; color: ${statusColor};">
                  ${user.isPlaying ? '▶' : '⏸'}
                </div>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 13px; font-weight: 600; color: #a78bfa;">
                  ${formatTime(user.currentTime)}
                </div>
                <div style="font-size: 10px; color: ${syncColor}; font-weight: 600;">
                  ${isOutOfSync ? `±${timeDiff.toFixed(1)}s` : '✓ synced'}
                </div>
              </div>
            </div>
          `;
        }).join('');
        
        remoteUsersList.innerHTML = `
          <div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: rgba(255,255,255,0.7);">
            ${users.length} user${users.length === 1 ? '' : 's'} in party
          </div>
          ${userListHTML}
        `;
      }
    }
  } catch (error) {
    console.error('[Popup] Error fetching stats:', error);
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'REMOTE_STREAM_RECEIVED') {
    remoteVideo.srcObject = request.stream;
  }
});
