import { BackgroundService } from './BackgroundService.js';

const backgroundService = new BackgroundService();

// When the extension icon is clicked, toggle the in-page launcher/sidebar
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && tab.url.startsWith('https://www.netflix.com/')) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_LAUNCHER' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_PARTY') {
    backgroundService.startParty(request.roomId, request.username, request.pin).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true;
  }

  if (request.type === 'STOP_PARTY') {
    backgroundService.stopParty();
    sendResponse({ success: true });
  }

  if (request.type === 'RESTORE_PARTY') {
    // Don't generate a new userId - keep the existing one so peers can still communicate
    // Check if WebSocket is already connected
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      console.log('[Background] RESTORE_PARTY - WebSocket already connected, reusing connection');
      backgroundService.roomId = request.roomId;
      backgroundService.intentionalDisconnect = false;
      
      // Re-register with signaling server so other peers know we're back
      console.log('[Background] Sending JOIN for room:', request.roomId, 'userId:', backgroundService.userId);
      backgroundService.ws.send(JSON.stringify({ 
        type: 'JOIN', 
        userId: backgroundService.userId, 
        roomId: backgroundService.roomId,
        username: backgroundService.username || null,
        pin: backgroundService.pin || null,
        timestamp: Date.now() 
      }));
      
      // Respond with all state info — content script handles the UI itself (no PARTY_STARTED needed)
      sendResponse({ 
        success: true, 
        userId: backgroundService.userId,
        roomId: backgroundService.roomId,
        username: backgroundService.username || null,
        pin: backgroundService.pin || null,
      });
    } else {
      // WebSocket is not connected, need to reconnect
      console.log('[Background] RESTORE_PARTY - WebSocket not connected, reconnecting');
      backgroundService.stopParty(false);
      backgroundService.startParty(request.roomId, request.username, request.pin).then(() => {
        sendResponse({ 
          success: true, 
          userId: backgroundService.userId,
          roomId: backgroundService.roomId,
          username: backgroundService.username || null,
          pin: backgroundService.pin || null,
        });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  if (request.type === 'GET_STATUS') {
    sendResponse(backgroundService.getStatus());
    return true;
  }

  if (request.type === 'UPDATE_USERNAME') {
    backgroundService.updateUsername(request.username);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'PLAY_PAUSE') {
    console.log('[Background] Broadcasting PLAY_PAUSE:', request.control, 'at', request.currentTime);
    backgroundService.broadcastMessage({
      type: 'PLAY_PAUSE',
      control: request.control,
      currentTime: request.currentTime,
      eventTimestamp: request.eventTimestamp,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_TIME') {
    backgroundService.broadcastMessage({
      type: 'SYNC_PLAYBACK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SEEK') {
    backgroundService.broadcastMessage({
      type: 'SEEK',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      eventTimestamp: request.eventTimestamp,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'READY') {
    backgroundService.broadcastMessage({
      type: 'READY',
      targetTime: request.targetTime,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'HOST_HEARTBEAT') {
    backgroundService.broadcastMessage({
      type: 'HOST_HEARTBEAT',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      eventTimestamp: request.eventTimestamp,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'POSITION_UPDATE') {
    // Send position update to server without broadcasting to other clients
    backgroundService.broadcastMessage({
      type: 'POSITION_UPDATE',
      currentTime: request.currentTime,
      isPlaying: request.isPlaying,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'URL_CHANGE') {
    console.log('[Background] Broadcasting URL_CHANGE:', request.url, 'time:', request.currentTime);
    backgroundService.broadcastMessage({
      type: 'URL_CHANGE',
      url: request.url,
      currentTime: request.currentTime,
      userId: backgroundService.userId,
      roomId: backgroundService.roomId
    });
    sendResponse({ success: true });
  }

  if (request.type === 'REQUEST_SYNC') {
    backgroundService.broadcastMessage({
      type: 'REQUEST_SYNC',
      userId: backgroundService.userId,
      roomId: backgroundService.roomId,
      respectAutoPlay: request.respectAutoPlay || false
    });
    sendResponse({ success: true });
  }

  if (request.type === 'SYNC_RESPONSE') {
    console.log('[Background] Forwarding SYNC_RESPONSE to', request.targetUserId, 'with URL:', request.url);
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      backgroundService.ws.send(JSON.stringify({
        type: 'SYNC_RESPONSE',
        to: request.targetUserId,
        currentTime: request.currentTime,
        isPlaying: request.isPlaying,
        url: request.url,
        respectAutoPlay: request.respectAutoPlay || false,
        fromUserId: backgroundService.userId,
        roomId: backgroundService.roomId
      }));
    }
    sendResponse({ success: true });
  }

  if (request.type === 'SIGNAL_SEND') {
    const msg = Object.assign({}, request.message || {});
    msg.userId = msg.userId || backgroundService.userId;
    msg.roomId = msg.roomId || backgroundService.roomId;
    if (backgroundService.ws && backgroundService.ws.readyState === WebSocket.OPEN) {
      try {
        backgroundService.ws.send(JSON.stringify(msg));
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    } else {
      sendResponse({ success: false, error: 'Not connected to signaling server' });
    }
    return true;
  }
});
