export function createPeerConnectionFactory({ stateManager, sendSignal, remoteStreams, remoteVideos, addRemoteVideo, attemptReconnection, clearReconnection, removeRemoteVideo, peersThatLeft, showReconnecting, hideOverlay, showPlaceholder }) {
  return function createPeerConnection(peerId) {
    console.log('[PeerConnection] Creating peer connection for peerId:', peerId);
    
    // Ensure any existing video/container AND stream is removed before creating placeholder
    // This prevents duplicates when rapidly recreating connections (like force refresh)
    removeRemoteVideo(peerId);
    remoteStreams.delete(peerId); // Also clear the stream
    
    // Show placeholder immediately when peer connection is created
    showPlaceholder(peerId);
    
    const state = stateManager.getState();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] }
      ]
    });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[PeerConnection] ICE candidate for peer:', peerId, event.candidate);
        sendSignal({ type: 'ICE_CANDIDATE', from: state.userId, to: peerId, candidate: event.candidate });
      }
    };
    pc.ontrack = (event) => {
      console.log('[PeerConnection] ontrack fired for peer:', peerId, 'track:', event.track, 'streams:', event.streams);
      let stream = (event.streams && event.streams[0]) || remoteStreams.get(peerId);
      if (!stream) {
        console.log('[PeerConnection] Creating new MediaStream for peer:', peerId);
        stream = new MediaStream();
      }
      // Always keep remoteStreams in sync so cleanup works correctly
      remoteStreams.set(peerId, stream);
      if (event.track) {
        console.log('[PeerConnection] Adding track to stream:', event.track.kind, event.track.id);
        try { 
          // Check if track already exists in stream to prevent duplicates
          const existingTrack = stream.getTracks().find(t => t.id === event.track.id);
          if (!existingTrack) {
            stream.addTrack(event.track);
          } else {
            console.log('[PeerConnection] Track already in stream, skipping');
          }
        } catch (e) {
          console.warn('[PeerConnection] Error adding track:', e);
        }
      }
      
      // Check if video element exists
      const hasVideoInMap = remoteVideos.has(peerId);
      const hasVideoInDom = !!document.getElementById('tandem-remote-' + peerId);
      const videoExists = hasVideoInMap || hasVideoInDom;
      
      if (videoExists) {
        console.log('[PeerConnection] Video already exists for peer:', peerId, 'inMap:', hasVideoInMap, 'inDom:', hasVideoInDom);
        // Update the existing video element's stream if it's different
        const existingVideo = remoteVideos.get(peerId) || document.getElementById('tandem-remote-' + peerId);
        if (existingVideo && existingVideo.srcObject !== stream) {
          console.log('[PeerConnection] Updating existing video element with new stream');
          existingVideo.srcObject = stream;
          // Ensure it's tracked in the map
          if (!hasVideoInMap) {
            remoteVideos.set(peerId, existingVideo);
          }
        }
      } else {
        // Create video element as soon as any track is available.
        // If the remote peer has no camera or no mic, we still want to show them.
        // Additional tracks (if they arrive later) are added to the same stream so
        // the existing video element picks them up automatically.
        const tracks = stream.getTracks();
        console.log('[PeerConnection] Stream status - audio:', tracks.some(t => t.kind === 'audio'), 'video:', tracks.some(t => t.kind === 'video'), 'total tracks:', tracks.length);
        if (tracks.length > 0) {
          console.log('[PeerConnection] Track(s) present, adding remote video for peer:', peerId);
          addRemoteVideo(peerId, stream);
        }
      }
    };
    pc.onconnectionstatechange = () => {
      console.log('[PeerConnection] Connection state changed for peer:', peerId, '→', pc.connectionState);
      if (pc.connectionState === 'connected') {
        clearReconnection(peerId);
        hideOverlay(peerId);
      } else if (pc.connectionState === 'disconnected') {
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          // Keep video visible while reconnecting - don't remove immediately
          console.log('[PeerConnection] Connection disconnected, attempting reconnection while keeping video visible');
          showReconnecting(peerId);
          attemptReconnection(peerId);
        }
      } else if (pc.connectionState === 'failed') {
        console.log('[PeerConnection] Connection failed for peer:', peerId);
        if (peersThatLeft.has(peerId)) {
          removeRemoteVideo(peerId);
          clearReconnection(peerId);
        } else {
          // Remove video on failed state and try to reconnect
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
