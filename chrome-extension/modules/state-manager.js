// state-manager.js - Manages party state and action tracking

export class StateManager {
  constructor() {
    // Party state
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    this.restoringPartyState = false;
  }
  
  // Party state management
  startParty(userId, roomId) {
    this.partyActive = true;
    this.userId = userId;
    this.roomId = roomId;
    console.log('Party started! Room:', roomId, 'User:', userId);
  }
  
  stopParty() {
    this.partyActive = false;
    this.userId = null;
    this.roomId = null;
    console.log('Party stopped');
  }
  
  isActive() {
    return this.partyActive;
  }
  
  getUserId() {
    return this.userId;
  }
  
  getRoomId() {
    return this.roomId;
  }
  
  getState() {
    return {
      partyActive: this.partyActive,
      userId: this.userId,
      roomId: this.roomId,
      restoringPartyState: this.restoringPartyState
    };
  }

   // Convenience: are we currently in a valid party session?
  isInParty() {
    return !!(this.partyActive && this.userId && this.roomId);
  }
  
  setRestoringFlag(value) {
    this.restoringPartyState = value;
  }
  
  // Extension context validation
  isExtensionContextValid() {
    try {
      return chrome.runtime && chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }
  
  // Safe message sending
  safeSendMessage(message, callback) {
    if (!this.isExtensionContextValid()) {
      console.warn('Extension context invalidated - please reload the page');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.warn('Failed to send message, extension may have been reloaded:', e.message);
    }
  }
}
