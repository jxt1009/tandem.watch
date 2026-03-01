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
        resolve(persistedUsername);
      });
      return;
    }

    const stored = localStorage.getItem('tandemUsername') || '';
    persistedUsername = stored || generateDefaultUsername();
    localStorage.setItem('tandemUsername', persistedUsername);
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
  const finalUsername = persistedUsername || generateDefaultUsername();
  return new Promise((resolve) => {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ tandemUsername: finalUsername }, () => {
        chrome.runtime.sendMessage({ type: 'UPDATE_USERNAME', username: finalUsername }, () => {});
        resolve(finalUsername);
      });
      return;
    }
    localStorage.setItem('tandemUsername', finalUsername);
    resolve(finalUsername);
  });
}

// Cache DOM elements
let statusEl, statusText, statusControls, controlsSection, joinSection, partyInfo;
let startBtn, stopBtn, roomCodeInput, joinRoomBtn;
let serverUrlEl;
let roomPinInput;
let listenersBound = false;

function initializeDOMElements() {
  statusEl = document.getElementById('status');
  statusText = document.getElementById('status-text');
  statusControls = document.getElementById('status-controls');
  controlsSection = document.getElementById('controls-section');
  joinSection = document.getElementById('join-section');
  partyInfo = document.getElementById('party-info');
  startBtn = document.getElementById('start-btn');
  stopBtn = document.getElementById('stop-btn');
  roomCodeInput = document.getElementById('room-code-input');
  joinRoomBtn = document.getElementById('join-room-btn');
  serverUrlEl = document.getElementById('server-url');
  roomPinInput = document.getElementById('room-pin-input');
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
    
    // Get PIN: prefer the explicit pin field, fall back to PIN embedded in the share URL
    const pin = roomPinInput?.value?.trim() || parsed.pin || null;
    
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

  const roomUrlMatch = trimmed.match(/\/room\/([a-z0-9]+)(?:\/([0-9]+))?/i);
  if (roomUrlMatch) {
    return { type: 'shortId', shortId: roomUrlMatch[1], pin: roomUrlMatch[2] || null };
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

  if (startBtn) startBtn.addEventListener('click', startParty);
  if (stopBtn) stopBtn.addEventListener('click', stopParty);
  if (joinRoomBtn) joinRoomBtn.addEventListener('click', joinRoomByCode);
  if (roomCodeInput) {
    roomCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinRoomByCode();
    });
  }
}

function updateUI() {
  if (!statusEl || !statusText || !statusControls || !joinSection || !startBtn || !stopBtn || !partyInfo) {
    console.warn('[Popup] UI elements not ready, skipping update');
    return;
  }
  const { isConnected } = status;
  if (isConnected) {
    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.className = 'status connected status-minimal';
    }
    statusText.textContent = '🟢 Connected';
    if (statusControls) statusControls.classList.remove('hidden');
    if (controlsSection) controlsSection.classList.remove('hidden');
    joinSection.classList.add('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    partyInfo.classList.remove('hidden');
  } else {
    if (statusEl) {
      statusEl.classList.add('hidden');
      statusEl.className = 'status disconnected status-minimal';
    }
    statusText.textContent = '🔴 Disconnected';
    if (statusControls) statusControls.classList.remove('hidden');
    if (controlsSection) controlsSection.classList.remove('hidden');
    joinSection.classList.remove('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
  }
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

function startStatusPolling() {
  updateStatus();
  setInterval(updateStatus, 2000);
}

chrome.runtime.onMessage.addListener((request) => {
  // Reserved for future messages from background
});
