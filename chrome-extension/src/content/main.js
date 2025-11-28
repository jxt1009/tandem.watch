import { StateManager } from '../managers/state/StateManager.js';
import { NetflixController } from './netflix/NetflixController.js';
import { SyncManager } from '../managers/sync/SyncManager.js';
import { WebRTCManager } from '../services/webrtc/WebRTCManager.js';
import { UIManager } from '../ui/UIManager.js';
import { URLSync } from '../managers/url/URLSync.js';

console.log('[Content Script] Initializing managers...');
const stateManager = new StateManager();
const uiManager = new UIManager();
const netflixController = new NetflixController();
const syncManager = new SyncManager(stateManager, netflixController);
const webrtcManager = new WebRTCManager(stateManager, uiManager);
const urlSync = new URLSync(stateManager);
console.log('[Content Script] Managers initialized');

let localStream = null;

(function checkRestorePartyState() {
  const restorationState = urlSync.getRestorationState();
  if (restorationState) {
    urlSync.clearState();
    stateManager.setRestoringFlag(true);
    setTimeout(function() {
      chrome.runtime.sendMessage({ type: 'RESTORE_PARTY', roomId: restorationState.roomId });
      setTimeout(function() {
        stateManager.setRestoringFlag(false);
      }, 2000);
    }, 1000);
  }
})();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Content Script] Received message:', request.type);
  if (request.type === 'REQUEST_MEDIA_STREAM') {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        console.log('[Content Script] Media stream obtained, tracks:', stream.getTracks().length);
        localStream = stream;
        webrtcManager.setLocalStream(stream);
        webrtcManager.onLocalStreamAvailable(stream);
        uiManager.attachLocalPreview(stream);
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
    syncManager.setup();
    urlSync.start();
    sendResponse({ success: true });
  }

  if (request.type === 'PARTY_STOPPED') {
    console.log('[Content Script] Stopping party');
    stateManager.stopParty();
    syncManager.teardown();
    urlSync.stop();
    urlSync.clearState();
    webrtcManager.clearAll();
    uiManager.removeLocalPreview();
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL') {
    console.log('[Content Script] Handling SIGNAL:', request.message?.type);
    webrtcManager.handleSignal(request.message);
  }

  if (request.type === 'APPLY_PLAYBACK_CONTROL') {
    syncManager.handlePlaybackControl(request.control, request.fromUserId);
  }

  if (request.type === 'APPLY_SYNC_PLAYBACK') {
    syncManager.handlePassiveSync(request.currentTime, request.isPlaying, request.fromUserId, request.timestamp);
  }

  if (request.type === 'APPLY_SEEK') {
    syncManager.handleSeek(request.currentTime, request.isPlaying, request.fromUserId);
  }

  if (request.type === 'APPLY_URL_CHANGE') {
    if (!stateManager.restoringPartyState) {
      window.location.href = request.url;
    }
  }

  if (request.type === 'HANDLE_REQUEST_SYNC') {
    syncManager.handleRequestSync(request.fromUserId);
  }

  if (request.type === 'APPLY_SYNC_RESPONSE') {
    syncManager.handleSyncResponse(request.currentTime, request.isPlaying, request.fromUserId);
  }
});

window.addEventListener('beforeunload', () => {
  if (stateManager.isActive()) {
    urlSync.saveState();
  }
});
