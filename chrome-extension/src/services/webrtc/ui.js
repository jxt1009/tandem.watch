export function createRemoteVideoManager(remoteVideos) {
  function add(peerId, stream) {
    remove(peerId);
    const v = document.createElement('video');
    v.id = 'toperparty-remote-' + peerId;
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;
    v.style.position = 'fixed';
    v.style.bottom = '20px';
    v.style.right = (20 + (remoteVideos.size * 180)) + 'px';
    v.style.width = '240px';
    v.style.height = '160px';
    v.style.zIndex = 10001;
    v.style.border = '2px solid #00aaff';
    v.style.borderRadius = '4px';
    try { v.srcObject = stream; } catch (e) { v.src = URL.createObjectURL(stream); }
    document.body.appendChild(v);
    remoteVideos.set(peerId, v);
    try {
      v.play().then(() => {
        v.muted = false;
        v.volume = 1.0;
      }).catch(() => { v.muted = false; });
    } catch (e) {}
  }
  
  function remove(peerId) {
    const v = remoteVideos.get(peerId);
    if (v) {
      try { if (v.srcObject) v.srcObject = null; } catch (e) {}
      v.remove();
      remoteVideos.delete(peerId);
    }
  }
  
  return { add, remove };
}
