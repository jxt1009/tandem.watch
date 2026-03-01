export function createSignalingHandlers({ getState, peerConnections, peersThatLeft, getLocalStream, createPeer, sendSignal, addOrReplaceTrack, clearReconnection, removeRemoteVideo }) {
  // Buffer ICE candidates that arrive before setRemoteDescription is called
  const pendingCandidates = new Map();

  async function flushPendingCandidates(peerId, pc) {
    const queued = pendingCandidates.get(peerId);
    if (!queued || queued.length === 0) return;
    pendingCandidates.delete(peerId);
    console.log('[Signaling] Flushing', queued.length, 'buffered ICE candidates for', peerId);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn('[Signaling] Error adding buffered ICE candidate:', err);
      }
    }
  }

  return {
    async handleJoin(from) {
      console.log('[Signaling] Handling JOIN from', from);
      const state = getState();
      if (from === state.userId) {
        console.log('[Signaling] Ignoring JOIN from self');
        return;
      }
      
      // First, clear any reconnection attempts - peer has explicitly rejoined
      clearReconnection(from);
      peersThatLeft.delete(from);
      
      let pc = peerConnections.get(from);
      if (pc) {
        const connectionState = pc.connectionState;
        console.log('[Signaling] Already have peer connection for', from, 'state:', connectionState);
        
        // Only reuse if connection is fully connected AND tracks are present
        // Otherwise clean up and start fresh to avoid duplicate videos
        if (connectionState === 'connected') {
          const receivers = pc.getReceivers();
          const hasActiveStreams = receivers.some(r => r.track && r.track.readyState === 'live');
          
          if (hasActiveStreams) {
            console.log('[Signaling] Reusing existing connected peer with active streams');
            const stream = getLocalStream();
            if (stream) {
              let needsRenegotiation = false;
              stream.getTracks().forEach(t => {
                const senders = pc.getSenders();
                const existingSender = senders.find(s => s.track && s.track.kind === t.kind);
                if (!existingSender || existingSender.track.id !== t.id) {
                  console.log('[Signaling] Track changed, replacing:', t.kind, t.id);
                  addOrReplaceTrack(pc, t, stream);
                  needsRenegotiation = true;
                }
              });
              
              if (needsRenegotiation && pc.signalingState === 'stable') {
                console.log('[Signaling] Renegotiating due to track changes');
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
              }
            }
            return;
          }
        }
        
        // For any other state or if no active streams, clean it up completely
        console.log('[Signaling] Cleaning up existing connection in state:', connectionState, '- starting fresh');
        clearReconnection(from);
        removeRemoteVideo(from);
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
        pc = null;
      }
      
      if (!pc) {
        try {
          console.log('[Signaling] Creating new peer connection for', from);
          pc = createPeer(from);
          peerConnections.set(from, pc);
          const stream = getLocalStream();
          console.log('[Signaling] Local stream:', stream, 'tracks:', stream ? stream.getTracks().length : 0);
          if (stream) {
            stream.getTracks().forEach(t => {
              console.log('[Signaling] Adding local track to peer:', t.kind, t.id);
              addOrReplaceTrack(pc, t, stream);
            });
          } else {
            console.warn('[Signaling] No local stream available when handling JOIN');
          }
          console.log('[Signaling] Creating and sending OFFER to', from);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
        } catch (err) {
          console.error('[Signaling] Error handling JOIN:', err);
          peerConnections.delete(from);
        }
      }
    },
    async handleOffer(from, offer) {
      console.log('[Signaling] Handling OFFER from', from);
      const state = getState();
      if (from === state.userId) {
        console.log('[Signaling] Ignoring OFFER from self');
        return;
      }
      let pc = peerConnections.get(from);
      if (pc) {
        console.log('[Signaling] Existing peer connection state:', pc.signalingState);
        if (pc.signalingState === 'closed') {
          // Dead connection — discard and create fresh
          peerConnections.delete(from);
          pc = null;
        } else if (pc.signalingState !== 'stable') {
          // Glare: we sent an offer and received one simultaneously — restart
          console.log('[Signaling] Closing existing peer connection in state:', pc.signalingState, '(glare)');
          try { pc.close(); } catch (e) {}
          peerConnections.delete(from);
          pc = null;
        }
        // else: signalingState === 'stable' — reuse for renegotiation (do NOT close)
      }
      if (!pc) {
        console.log('[Signaling] Creating new peer connection for', from);
        // Clear any reconnection attempts when receiving an offer
        clearReconnection(from);
        peersThatLeft.delete(from);
        pc = createPeer(from);
        peerConnections.set(from, pc);
      }
      try {
        console.log('[Signaling] Setting remote description, current state:', pc.signalingState);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await flushPendingCandidates(from, pc);
        const stream = getLocalStream();
        console.log('[Signaling] Local stream:', stream, 'tracks:', stream ? stream.getTracks().length : 0);
        if (stream) {
          stream.getTracks().forEach(t => {
            console.log('[Signaling] Adding local track to peer:', t.kind, t.id);
            addOrReplaceTrack(pc, t, stream);
          });
        } else {
          console.warn('[Signaling] No local stream available when handling OFFER');
        }
        console.log('[Signaling] Creating and sending ANSWER to', from);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
      } catch (err) {
        console.error('[Signaling] Error handling offer:', err.name, err.message);
        console.error('[Signaling] Full error:', err);
        peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
    },
    async handleAnswer(from, answer) {
      console.log('[Signaling] Handling ANSWER from', from);
      const pc = peerConnections.get(from);
      if (!pc) {
        console.warn('[Signaling] Cannot handle ANSWER - no peer connection found for', from);
        return;
      }
      
      console.log('[Signaling] Peer connection state:', {
        signalingState: pc.signalingState,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState
      });
      
      if (pc.signalingState === 'have-local-offer') {
        console.log('[Signaling] Setting remote description from ANSWER');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          await flushPendingCandidates(from, pc);
          console.log('[Signaling] Remote description set successfully');
        } catch (err) {
          console.error('[Signaling] Error handling answer:', err.name, err.message);
          console.error('[Signaling] Full error:', err);
          // If the peer connection is in a bad state, close it and remove it
          if (err.name === 'InvalidStateError' || err.name === 'OperationError') {
            console.log('[Signaling] Closing peer connection due to state error');
            try { pc.close(); } catch (e) {}
            peerConnections.delete(from);
          }
        }
      } else if (pc.signalingState === 'stable') {
        console.log('[Signaling] Received ANSWER but already in stable state (connection:', pc.connectionState + ') - likely duplicate, ignoring');
      } else if (pc.signalingState === 'have-remote-offer') {
        console.warn('[Signaling] Received ANSWER but expecting to send one (have-remote-offer) - might be glare, ignoring');
      } else if (pc.signalingState === 'closed') {
        console.warn('[Signaling] Received ANSWER but peer connection is closed - ignoring');
      } else {
        console.warn('[Signaling] Cannot handle ANSWER - unexpected state:', pc.signalingState);
      }
    },
    async handleIceCandidate(from, candidate) {
      console.log('[Signaling] Handling ICE_CANDIDATE from', from);
      const pc = peerConnections.get(from);
      if (pc) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('[Signaling] ICE candidate added successfully');
          } catch (err) {
            console.warn('[Signaling] Error adding ICE candidate', err);
          }
        } else {
          // Remote description not set yet — buffer for later
          console.log('[Signaling] Buffering ICE candidate for', from, '(no remote description yet)');
          if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
          pendingCandidates.get(from).push(candidate);
        }
      } else {
        // No peer connection yet — buffer optimistically in case it's created shortly
        console.log('[Signaling] Buffering ICE candidate for', from, '(no peer connection yet)');
        if (!pendingCandidates.has(from)) pendingCandidates.set(from, []);
        pendingCandidates.get(from).push(candidate);
      }
    },
    handleLeave(from) {
      console.log('[Signaling] Handling LEAVE from', from);
      peersThatLeft.add(from);
      pendingCandidates.delete(from);
      const pc = peerConnections.get(from);
      if (pc) {
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
      }
      clearReconnection(from);
      removeRemoteVideo(from);
    }
  };
}
