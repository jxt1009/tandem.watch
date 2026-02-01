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
const shareLinkEl = document.getElementById('share-link');
const userDisplay = document.getElementById('user-display');
const localTimeEl = document.getElementById('local-time');
const syncStatusEl = document.getElementById('sync-status');
const remoteUsersList = document.getElementById('remote-users-list');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const copyLinkBtn = document.getElementById('copy-link-btn');
const serverUrlEl = document.getElementById('server-url');

// Import and display server URL from config
import('../config.js').then(({ CONFIG }) => {
  if (serverUrlEl) {
    serverUrlEl.textContent = CONFIG.WS.URL;
  }
  console.log('[Popup] Signaling server configured at:', CONFIG.WS.URL);
}).catch(err => {
  console.warn('[Popup] Could not load config:', err);
});

updateStatus();
setupEventListeners();
startStatusPolling();

let lastShareLinkRoomId = null;
let lastShareLink = null;

function buildShareLink(roomId) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const fallbackUrl = 'https://www.netflix.com/browse';
      let targetUrl = fallbackUrl;

      const tabUrl = tabs && tabs[0] ? tabs[0].url : null;
      if (tabUrl && tabUrl.startsWith('http')) {
        targetUrl = tabUrl;
      }

      try {
        let url = new URL(targetUrl);
        if (!url.hostname.endsWith('netflix.com')) {
          url = new URL(fallbackUrl);
        }
        url.searchParams.set('tandemRoom', roomId);
        resolve(url.toString());
      } catch (e) {
        resolve(`${fallbackUrl}?tandemRoom=${encodeURIComponent(roomId)}`);
      }
    });
  });
}

function updateShareLink() {
  if (!shareLinkEl || !status.roomId) return;
  if (status.roomId === lastShareLinkRoomId && lastShareLink) {
    shareLinkEl.textContent = lastShareLink;
    return;
  }

  buildShareLink(status.roomId).then((link) => {
    lastShareLinkRoomId = status.roomId;
    lastShareLink = link;
    shareLinkEl.textContent = link;
  });
}

function setupEventListeners() {
  startBtn.addEventListener('click', startParty);
  stopBtn.addEventListener('click', stopParty);
  resetBtn.addEventListener('click', resetParty);
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', copyShareLink);
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
    userDisplay.textContent = userId;
    updateShareLink();
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
  startBtn.disabled = true;
  statusText.textContent = '⏳ Connecting...';
  chrome.runtime.sendMessage({ type: 'START_PARTY' }, (response) => {
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

function resetParty() {
  resetBtn.disabled = true;
  statusText.textContent = '♻️ Resetting...';
  chrome.runtime.sendMessage({ type: 'STOP_PARTY' }, () => {
    chrome.runtime.sendMessage({ type: 'START_PARTY' }, (response) => {
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

function copyShareLink() {
  if (!status.roomId) return;
  buildShareLink(status.roomId).then((link) => {
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
    const { CONFIG } = await import('../config.js');
    
    // Fetch stats from signaling server (construct HTTP URL from WebSocket URL)
    const httpUrl = CONFIG.WS.URL.replace(/^wss?:\/\//, 'http://').replace(/\/ws$/, '');
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
          
          return `
            <div style="padding: 8px; border-top: ${borderColor}; background-color: ${bgColor}; ${index === 0 ? 'border-top: none;' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="font-weight: 600; font-size: 12px; color: rgba(255,255,255,0.9);">
                  ${user.userId.substring(0, 8)}...${isCurrentUser ? ' (You)' : ''}
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
