export function createPeerConnectionFactory({ stateManager, sendSignal, remoteStreams, remoteVideos, addRemoteVideo, attemptReconnection, clearReconnection, removeRemoteVideo, peersThatLeft }) {
  return function createPeerConnection(peerId) {
    const state = stateManager.getState();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      let stream = (event.streams && event.streams[0]) || remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }
      if (event.track) {
        try { stream.addTrack(event.track); } catch (e) {}
      }
      if (!remoteVideos.has(peerId)) {
        addRemoteVideo(peerId, stream);
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearReconnection(peerId);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          removeRemoteVideo(peerId);
          attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'closed') {
        removeRemoteVideo(peerId);
        clearReconnection(peerId);
      }
    };
    return pc;
  };
}

export function addOrReplaceTrack(pc, track, stream) {
  const senders = pc.getSenders();
  const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
  if (existingSender) {
    existingSender.replaceTrack(track).catch(e => console.warn('[WebRTCManager] Error replacing track', e));
  } else {
    try { pc.addTrack(track, stream); } catch (e) {}
  }
}
