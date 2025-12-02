let status = { isConnected: false, roomId: null, userId: null, hasLocalStream: false };

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const controlsSection = document.getElementById('controls-section');
const partyInfo = document.getElementById('party-info');
const statsSection = document.getElementById('stats-section');
const videoSection = document.getElementById('video-section');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const resetBtn = document.getElementById('reset-btn');
const roomInput = document.getElementById('room-input');
const roomDisplay = document.getElementById('room-display');
const userDisplay = document.getElementById('user-display');
const localTimeEl = document.getElementById('local-time');
const syncStatusEl = document.getElementById('sync-status');
const remoteUsersList = document.getElementById('remote-users-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const copyRoomBtn = document.getElementById('copy-room-btn');

updateStatus();
setupEventListeners();
startStatusPolling();

function setupEventListeners() {
  startBtn.addEventListener('click', startParty);
  stopBtn.addEventListener('click', stopParty);
  resetBtn.addEventListener('click', resetParty);
  copyRoomBtn.addEventListener('click', copyRoomId);
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
  const { isConnected, roomId, userId } = status;
  if (isConnected) {
    statusEl.className = 'status connected';
    statusText.textContent = '🟢 Connected';
    controlsSection.classList.remove('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    resetBtn.classList.remove('hidden');
    partyInfo.classList.remove('hidden');
    statsSection.classList.remove('hidden');
    roomDisplay.textContent = roomId;
    userDisplay.textContent = userId;
    updateStats();
  } else {
    statusEl.className = 'status disconnected';
    statusText.textContent = '🔴 Disconnected';
    controlsSection.classList.remove('hidden');
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    partyInfo.classList.add('hidden');
    statsSection.classList.add('hidden');
    videoSection.classList.add('hidden');
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }
}

async function startParty() {
  const roomId = roomInput.value.trim() || undefined;
  startBtn.disabled = true;
  statusText.textContent = '⏳ Connecting...';
  chrome.runtime.sendMessage({ type: 'START_PARTY', roomId }, (response) => {
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
    roomInput.value = '';
    updateStatus();
  });
}

function resetParty() {
  const desiredRoomId = roomInput.value.trim() || status.roomId || undefined;
  resetBtn.disabled = true;
  statusText.textContent = '♻️ Resetting...';
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    chrome.runtime.sendMessage({ type: 'START_PARTY', roomId: desiredRoomId }, (response) => {
      resetBtn.disabled = false;
      if (response && response.success) {
        setTimeout(updateStatus, 500);
      } else {
        alert('Error resetting party: ' + (response && response.error ? response.error : 'Unknown error'));
        statusText.textContent = '🔴 Disconnected';
      }
    });
  });
}

function copyRoomId() {
  if (status.roomId) {
    navigator.clipboard.writeText(status.roomId);
    copyRoomBtn.textContent = '✓';
    setTimeout(() => { copyRoomBtn.textContent = '📋'; }, 2000);
  }
}

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

function updateStats() {
  // Request stats from content script
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('netflix.com')) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PARTY_STATS' }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        
        // Update local time
        if (localTimeEl) {
          localTimeEl.textContent = response.localTime || '--:--';
        }
        
        // Update sync status
        if (syncStatusEl) {
          syncStatusEl.textContent = response.connected ? 'In Sync' : 'Disconnected';
          syncStatusEl.style.color = response.connected ? '#4ade80' : '#ef4444';
        }
        
        // Update remote users
        if (remoteUsersList && response.remoteUsers) {
          if (response.remoteUsers.length === 0) {
            remoteUsersList.innerHTML = '<div style="color: rgba(255,255,255,0.5); font-size: 12px; font-style: italic;">No other users in party</div>';
          } else {
            remoteUsersList.innerHTML = '<div style="font-weight: 600; font-size: 12px; margin-bottom: 8px; color: rgba(255,255,255,0.7);">Remote Users:</div>' +
              response.remoteUsers.map(user => `
                <div style="padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.1);">
                  <div style="font-size: 11px; opacity: 0.7;">${user.id.substring(0, 16)}...</div>
                  <div style="font-weight: 600; color: #a78bfa; font-size: 12px;">${user.time}</div>
                </div>
              `).join('');
          }
        }
      });
    }
  });
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.type === 'REMOTE_STREAM_RECEIVED') {
    remoteVideo.srcObject = request.stream;
  }
});
