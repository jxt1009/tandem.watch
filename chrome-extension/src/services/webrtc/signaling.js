export function createSignalingHandlers({ state, peerConnections, peersThatLeft, localStream, createPeer, sendSignal, addOrReplaceTrack, clearReconnection, removeRemoteVideo }) {
  return {
    async handleJoin(from) {
      if (from === state.userId) return;
      peersThatLeft.delete(from);
      if (peerConnections.has(from)) return;
      try {
        const pc = createPeer(from);
        peerConnections.set(from, pc);
        if (localStream) {
          localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
        }
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'OFFER', from: state.userId, to: from, offer: pc.localDescription });
      } catch (err) {
        console.error('[WebRTCManager] Error handling JOIN:', err);
        peerConnections.delete(from);
      }
    },
    async handleOffer(from, offer) {
      if (from === state.userId) return;
      let pc = peerConnections.get(from);
      if (pc && pc.signalingState !== 'closed') {
        try { pc.close(); } catch (e) {}
        peerConnections.delete(from);
        pc = null;
      }
      if (!pc) {
        pc = createPeer(from);
        peerConnections.set(from, pc);
      }
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        if (localStream) {
          localStream.getTracks().forEach(t => addOrReplaceTrack(pc, t, localStream));
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'ANSWER', from: state.userId, to: from, answer: pc.localDescription });
      } catch (err) {
        console.error('[WebRTCManager] Error handling offer:', err);
        peerConnections.delete(from);
        try { pc.close(); } catch (e) {}
      }
    },
    async handleAnswer(from, answer) {
      const pc = peerConnections.get(from);
      if (pc && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error('[WebRTCManager] Error handling answer:', err);
        }
      }
    },
    async handleIceCandidate(from, candidate) {
      const pc = peerConnections.get(from);
      if (pc) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('[WebRTCManager] Error adding ICE candidate', err);
        }
      }
    },
    handleLeave(from) {
      peersThatLeft.add(from);
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
