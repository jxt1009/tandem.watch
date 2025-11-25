// webrtc-manager.js - Centralised WebRTC peer connection management for the content script

export class WebRTCManager {
  constructor(stateManager, uiManager) {
    this.stateManager = stateManager;
    this.uiManager = uiManager;

    this.peerConnections = new Map();
    this.reconnectionAttempts = new Map();
    this.reconnectionTimeouts = new Map();
    this.remoteStreams = this.uiManager.getRemoteStreams();
    this.remoteVideos = this.uiManager.getRemoteVideos();

    this.peersThatLeft = new Set();
    this.localStream = null;
  }

  // --- Local media ------------------------------------------------------

  setLocalStream(stream) {
    this.localStream = stream;
  }

  getLocalStream() {
    return this.localStream;
  }

  // Called when we obtain/refresh local media so we can attach to existing PCs
  onLocalStreamAvailable(stream) {
    this.localStream = stream;
    this.peerConnections.forEach((pc) => {
      try {
        stream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, stream));
      } catch (e) {
        console.warn('[WebRTCManager] Error adding tracks to peer connection', e);
      }
    });
  }

  // --- Signaling entrypoint --------------------------------------------

  async handleSignal(message) {
    if (!message || !message.type) return;

    const type = message.type;
    const from = message.userId || message.from;
    const to = message.to;
    const state = this.stateManager.getState();

    // Ignore messages not for us (if addressed)
    if (to && to !== state.userId) return;

    if (type === 'JOIN' && from && from !== state.userId) {
      // Another user joined the room — initiate P2P if we have local media
      this.peersThatLeft.delete(from);
      if (!this.peerConnections.has(from)) {
        try {
          const pc = this._createPeerConnection(from);
          this.peerConnections.set(from, pc);
          if (this.localStream) {
            this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
          }
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this._sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
        } catch (err) {
          console.error('[WebRTCManager] Error handling JOIN and creating offer:', err);
          this.peerConnections.delete(from);
        }
      }
      return;
    }

    if (type === 'OFFER' && message.offer && from && from !== state.userId) {
      let pc = this.peerConnections.get(from);

      if (pc) {
        const pcState = pc.signalingState;
        if (pcState !== 'closed') {
          console.log('[WebRTCManager] Received new offer while in state:', pcState, '- recreating connection for', from);
          try { pc.close(); } catch (e) {}
          this.peerConnections.delete(from);
          pc = null;
        }
      }

      if (!pc) {
        pc = this._createPeerConnection(from);
        this.peerConnections.set(from, pc);
      }

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
        if (this.localStream) {
          this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this._sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
      } catch (err) {
        console.error('[WebRTCManager] Error handling offer:', err);
        this.peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
      return;
    }

    if (type === 'ANSWER' && message.answer && from && from !== state.userId) {
      const pc = this.peerConnections.get(from);
      if (pc) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
          } else {
            console.warn('[WebRTCManager] Received answer in unexpected state:', pc.signalingState);
          }
        } catch (err) {
          console.error('[WebRTCManager] Error handling answer:', err);
        }
      }
      return;
    }

    if (type === 'ICE_CANDIDATE' && message.candidate && from && from !== state.userId) {
      const pc = this.peerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (err) {
          console.warn('[WebRTCManager] Error adding received ICE candidate', err);
        }
      }
      return;
    }

    if (type === 'LEAVE' && from) {
      this.peersThatLeft.add(from);
      const pc = this.peerConnections.get(from);
      if (pc) {
        try { pc.close(); } catch (e) {}
        this.peerConnections.delete(from);
      }
      this._clearReconnectionState(from);
      this._removeRemoteVideo(from);
      return;
    }
  }

  // --- Reconnection logic ----------------------------------------------

  async attemptReconnection(peerId) {
    const state = this.stateManager.getState();
    if (!this.stateManager.isInParty()) {
      console.log('[WebRTCManager] Cannot reconnect - party not active');
      return;
    }

    if (this.peersThatLeft.has(peerId)) {
      console.log('[WebRTCManager] Not attempting reconnection to peer that has explicitly left:', peerId);
      this._clearReconnectionState(peerId);
      return;
    }

    const attempts = this.reconnectionAttempts.get(peerId) || 0;
    const maxAttempts = 5;
    const backoffDelay = Math.min(1000 * Math.pow(2, attempts), 30000);

    if (attempts >= maxAttempts) {
      console.log('[WebRTCManager] Max reconnection attempts reached for', peerId);
      this.reconnectionAttempts.delete(peerId);
      this.reconnectionTimeouts.delete(peerId);
      return;
    }

    console.log(`[WebRTCManager] Attempting reconnection to ${peerId} (attempt ${attempts + 1}/${maxAttempts}) in ${backoffDelay}ms`);
    this.reconnectionAttempts.set(peerId, attempts + 1);

    const existingTimeout = this.reconnectionTimeouts.get(peerId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const timeoutHandle = setTimeout(async () => {
      console.log('[WebRTCManager] Reconnecting to', peerId);

      const oldPc = this.peerConnections.get(peerId);
      if (oldPc) {
        try { oldPc.close(); } catch (e) { console.warn('[WebRTCManager] Error closing old peer connection:', e); }
        this.peerConnections.delete(peerId);
      }

      try {
        const pc = this._createPeerConnection(peerId);
        this.peerConnections.set(peerId, pc);

        if (this.localStream) {
          this.localStream.getTracks().forEach(t => this._addOrReplaceTrack(pc, t, this.localStream));
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._sendSignal({ type: 'OFFER', from: state.userId, to: peerId, offer: pc.localDescription });

        console.log('[WebRTCManager] Reconnection offer sent to', peerId);
      } catch (err) {
        console.error('[WebRTCManager] Failed to create reconnection offer:', err);
        this.attemptReconnection(peerId);
      }
    }, backoffDelay);

    this.reconnectionTimeouts.set(peerId, timeoutHandle);
  }

  _clearReconnectionState(peerId) {
    this.reconnectionAttempts.delete(peerId);
    const timeoutHandle = this.reconnectionTimeouts.get(peerId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.reconnectionTimeouts.delete(peerId);
    }
  }

  // --- Peer connection helpers -----------------------------------------

  _createPeerConnection(peerId) {
    const state = this.stateManager.getState();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTCManager] Received remote track from', peerId, 'track=', event.track && event.track.kind);
      let stream = (event.streams && event.streams[0]) || this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      if (event.track) {
        try {
          stream.addTrack(event.track);
          event.track.onended = () => {
            console.warn('[WebRTCManager] Remote track ended from', peerId, 'kind=', event.track.kind);
          };
          console.log('[WebRTCManager] Added remote track to stream, kind=', event.track.kind, 'readyState=', event.track.readyState);
        } catch (e) {
          console.warn('[WebRTCManager] Failed to add remote track to stream', e);
        }
      }
      if (!this.remoteVideos.has(peerId)) {
        this._addRemoteVideo(peerId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTCManager] PC state', pc.connectionState, 'for', peerId);

      if (pc.connectionState === 'connected') {
        console.log('[WebRTCManager] Connection established successfully with', peerId);
        this._clearReconnectionState(peerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.peersThatLeft.has(peerId)) {
          console.warn('[WebRTCManager] Connection', pc.connectionState, 'with peer that has left', peerId, '- not reconnecting');
          this.peerConnections.delete(peerId);
          this._removeRemoteVideo(peerId);
          this._clearReconnectionState(peerId);
        } else {
          console.warn('[WebRTCManager] Connection', pc.connectionState, 'with', peerId, '- attempting reconnection');
          this.peerConnections.delete(peerId);
          this._removeRemoteVideo(peerId);
          this.attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'closed') {
        console.log('[WebRTCManager] Connection closed with', peerId);
        this.peerConnections.delete(peerId);
        this._removeRemoteVideo(peerId);
        this._clearReconnectionState(peerId);
      }
    };

    return pc;
  }

  _addOrReplaceTrack(pc, track, stream) {
    const senders = pc.getSenders();
    const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
    if (existingSender) {
      existingSender.replaceTrack(track).catch(e => console.warn('[WebRTCManager] Error replacing track', e));
    } else {
      try {
        pc.addTrack(track, stream);
      } catch (e) {
        console.warn('[WebRTCManager] Error adding track', e);
      }
    }
  }

  // --- UI helpers -------------------------------------------------------

  _addRemoteVideo(peerId, stream) {
    this._removeRemoteVideo(peerId);
    const v = document.createElement('video');
    v.id = 'toperparty-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.position = 'fixed';
    v.style.bottom = '20px';
    v.style.right = (20 + (this.remoteVideos.size * 180)) + 'px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = 10001;
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';

    const audioTracks = stream.getAudioTracks();
    console.log('[WebRTCManager] Remote stream audio tracks:', audioTracks.length);
    audioTracks.forEach((track) => {
      console.log('[WebRTCManager] Audio track:', track.id, 'enabled=', track.enabled, 'readyState=', track.readyState);
    });

    try {
      v.srcObject = stream;
    } catch (e) {
      v.src = URL.createObjectURL(stream);
    }
    document.body.appendChild(v);
    this.remoteVideos.set(peerId, v);

    try {
      v.play().then(() => {
        console.log('[WebRTCManager] Remote video playing, unmuting audio for', peerId);
        v.muted = false;
        v.volume = 1.0;
      }).catch((err) => {
        console.warn('[WebRTCManager] Remote video play() failed:', err);
        v.muted = false;
      });
    } catch (e) {
      console.error('[WebRTCManager] Exception calling play():', e);
    }
  }

  _removeRemoteVideo(peerId) {
    const v = this.remoteVideos.get(peerId);
    if (v) {
      try {
        if (v.srcObject) {
          v.srcObject = null;
        }
      } catch (e) {}
      v.remove();
      this.remoteVideos.delete(peerId);
    }
    this.remoteStreams.delete(peerId);
  }

  // --- Messaging to background -----------------------------------------

  _sendSignal(message) {
    this.stateManager.safeSendMessage({ type: 'SIGNAL_SEND', message }, function() {});
  }

  // --- Teardown ---------------------------------------------------------

  clearAll() {
    this.peerConnections.forEach((pc) => {
      try { pc.close(); } catch (e) {}
    });
    this.peerConnections.clear();

    this.reconnectionTimeouts.forEach((timeoutHandle) => {
      clearTimeout(timeoutHandle);
    });
    this.reconnectionTimeouts.clear();
    this.reconnectionAttempts.clear();
    this.peersThatLeft.clear();

    this.remoteVideos.forEach((v, id) => {
      try {
        if (v.srcObject) {
          v.srcObject = null;
        }
      } catch (e) {}
      v.remove();
    });
    this.remoteVideos.clear();
    this.remoteStreams.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }
}
