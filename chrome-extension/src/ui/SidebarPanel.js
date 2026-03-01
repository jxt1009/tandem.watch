import { getInitials, getAvatarColor } from './avatarUtils.js';

const SIDEBAR_WIDTH = 300;

/**
 * TeleParty-style sidebar panel injected into the Netflix page.
 *
 * Participant tile layout:
 *   ┌─────────────────────────┐
 *   │  [Video / Avatar bg]    │  ← 16:9 aspect ratio
 *   │  [Connecting overlay]   │
 *   ├─────────────────────────┤
 *   │ ● Name            👑 👑 │  ← small avatar dot, name, host badge, transfer btn
 *   └─────────────────────────┘
 *
 * Public API:
 *   mount() / destroy()
 *   setLocalUserId(userId, username)
 *   addParticipant(userId, username, isHost, isLocal)
 *   removeParticipant(userId)
 *   setParticipantStream(userId, stream)   ← remote stream
 *   setLocalStream(userId, stream)         ← local camera (muted preview)
 *   setConnectionStatus(userId, status)    ← 'connecting'|'reconnecting'|'connected'
 *   setHost(hostUserId)
 *   setGuestControlEnabled(enabled)
 *   updateUsername(userId, username)
 */
export class SidebarPanel {
  constructor({ onLeave, onToggleGuestControl, onTransferHost } = {}) {
    this.callbacks = { onLeave, onToggleGuestControl, onTransferHost };

    this.localUserId = null;
    this.hostUserId = null;
    this.guestControlEnabled = false;
    /** @type {Map<string, ParticipantTile>} */
    this.participants = new Map();
    this.collapsed = false;
    this.mounted = false;

    this._sidebar = null;
    this._tab = null;
    this._participantList = null;
    this._statusDot = null;
    this._statusText = null;
    this._guestControlWrap = null;
    this._guestToggle = null;
  }

  mount() {
    if (this.mounted) return;
    this.mounted = true;
    this._injectStyles();
    this._buildDOM();
    document.body.appendChild(this._sidebar);
    document.body.appendChild(this._tab);
  }

  destroy() {
    if (!this.mounted) return;
    this.mounted = false;
    this.participants.forEach((p) => {
      if (p.video && p.video.srcObject) {
        p.video.srcObject = null;
      }
    });
    this.participants.clear();
    if (this._sidebar) { this._sidebar.remove(); this._sidebar = null; }
    if (this._tab) { this._tab.remove(); this._tab = null; }
  }

  setLocalUserId(userId, username) {
    this.localUserId = userId;
    if (!this.participants.has(userId)) {
      this.addParticipant(userId, username, false, true);
    }
  }

  /**
   * @param {string} userId
   * @param {string} username
   * @param {boolean} [isHost]
   * @param {boolean} [isLocal] — true for the local user's own tile
   */
  addParticipant(userId, username, isHost = false, isLocal = false) {
    if (this.participants.has(userId)) {
      // Already exists — update username/host in case it changed
      this.updateUsername(userId, username);
      if (isHost) this.setHost(userId);
      return;
    }
    const tile = this._createTile(userId, username, isLocal, isHost);
    this._participantList.appendChild(tile.element);
    this.participants.set(userId, tile);
    this._refreshStatus();
    this._updateTransferButtons();
  }

  removeParticipant(userId) {
    const p = this.participants.get(userId);
    if (!p) return;
    if (p.video && p.video.srcObject) p.video.srcObject = null;
    p.element.remove();
    this.participants.delete(userId);
    this._refreshStatus();
  }

  /**
   * Attach a remote MediaStream to a participant's video tile.
   * Shows the video element if the stream has a video track; otherwise shows
   * the avatar placeholder so audio still plays.
   */
  setParticipantStream(userId, stream) {
    const p = this.participants.get(userId);
    if (!p) return;
    const hasVideo = stream && stream.getVideoTracks().length > 0;

    p.video.srcObject = stream || null;
    p.video.style.display = hasVideo ? 'block' : 'none';
    p.noCamEl.style.display = hasVideo ? 'none' : 'flex';

    if (stream) {
      p.video.play().catch(() => {
        p.video.muted = false;
        p.video.play().catch(() => {});
      });
    }

    // Remove connecting overlay once we have a stream
    if (p.connectingEl) p.connectingEl.style.display = 'none';
  }

  /**
   * Attach the local user's camera stream (always muted to avoid echo).
   */
  setLocalStream(userId, stream) {
    const p = this.participants.get(userId);
    if (!p) return;
    const hasVideo = stream && stream.getVideoTracks().length > 0;

    p.video.srcObject = stream || null;
    p.video.muted = true;
    p.video.style.display = hasVideo ? 'block' : 'none';
    p.noCamEl.style.display = hasVideo ? 'none' : 'flex';

    if (stream && hasVideo) {
      p.video.play().catch(() => {});
    }
  }

  /** @param {'connecting'|'reconnecting'|'connected'} status */
  setConnectionStatus(userId, status) {
    const p = this.participants.get(userId);
    if (!p || !p.connectingEl) return;
    if (status === 'connecting' || status === 'reconnecting') {
      p.connectingEl.style.display = 'flex';
      p.connectingLabel.textContent = status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
    } else {
      p.connectingEl.style.display = 'none';
    }
  }

  setHost(hostUserId) {
    const prev = this.hostUserId;
    this.hostUserId = hostUserId;

    if (prev && this.participants.has(prev)) {
      this.participants.get(prev).hostBadge.style.display = 'none';
    }
    if (hostUserId && this.participants.has(hostUserId)) {
      this.participants.get(hostUserId).hostBadge.style.display = 'inline';
    }

    this._updateGuestControlVisibility();
    this._updateTransferButtons();
  }

  setGuestControlEnabled(enabled) {
    this.guestControlEnabled = enabled;
    if (this._guestToggle) this._guestToggle.checked = enabled;
  }

  updateUsername(userId, username) {
    const p = this.participants.get(userId);
    if (!p) return;
    const isLocal = userId === this.localUserId;
    p.nameEl.textContent = isLocal ? `${username} (You)` : username;
    p.avatarSmEl.textContent = getInitials(username);
    p.avatarLgEl.textContent = getInitials(username);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  _refreshStatus() {
    if (!this._statusDot || !this._statusText) return;
    const count = this.participants.size;
    if (count <= 1) {
      this._statusDot.style.background = '#a78bfa';
      this._statusText.textContent = 'Waiting for others…';
    } else {
      this._statusDot.style.background = '#4ade80';
      this._statusText.textContent = `${count} watching together`;
    }
  }

  _updateGuestControlVisibility() {
    if (!this._guestControlWrap) return;
    const isHost = !!(this.hostUserId && this.hostUserId === this.localUserId);
    this._guestControlWrap.style.display = isHost ? 'flex' : 'none';
  }

  _updateTransferButtons() {
    const isHost = !!(this.hostUserId && this.hostUserId === this.localUserId);
    this.participants.forEach((p, userId) => {
      if (!p.transferBtn) return;
      p.transferBtn.style.display = (isHost && userId !== this.localUserId) ? 'block' : 'none';
    });
  }

  _toggleCollapse() {
    this.collapsed = !this.collapsed;
    if (this.collapsed) {
      this._sidebar.style.transform = `translateX(${SIDEBAR_WIDTH}px)`;
      this._tab.style.right = '0';
      this._tab.textContent = '❮';
      this._tab.title = 'Show party panel';
    } else {
      this._sidebar.style.transform = 'translateX(0)';
      this._tab.style.right = `${SIDEBAR_WIDTH}px`;
      this._tab.textContent = '❯';
      this._tab.title = 'Hide party panel';
    }
  }

  _createTile(userId, username, isLocal, isHost) {
    const color = getAvatarColor(userId);
    const initials = getInitials(username);

    const element = document.createElement('div');
    element.className = 'tandem-participant';
    element.dataset.userId = userId;

    // ── Video wrap (16:9) ───────────────────────────────────────────────────
    const videoWrap = document.createElement('div');
    videoWrap.className = 'tandem-video-wrap';

    // Avatar shown when no camera
    const noCamEl = document.createElement('div');
    noCamEl.className = 'tandem-no-cam';
    const avatarLgEl = document.createElement('div');
    avatarLgEl.className = 'tandem-avatar-lg';
    avatarLgEl.style.background = color;
    avatarLgEl.textContent = initials;
    noCamEl.appendChild(avatarLgEl);

    // Video element — hidden until stream attached
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = isLocal;
    video.style.display = 'none';
    if (isLocal) video.style.transform = 'scaleX(-1)'; // mirror own preview

    // Connecting overlay — shown for remote peers until stream arrives
    const connectingEl = document.createElement('div');
    connectingEl.className = 'tandem-connecting';
    connectingEl.style.display = isLocal ? 'none' : 'flex';
    const connectingLabel = document.createElement('span');
    connectingLabel.textContent = 'Connecting…';
    connectingEl.appendChild(connectingLabel);

    videoWrap.appendChild(noCamEl);
    videoWrap.appendChild(video);
    videoWrap.appendChild(connectingEl);

    // ── Info bar ────────────────────────────────────────────────────────────
    const infoBar = document.createElement('div');
    infoBar.className = 'tandem-participant-info';

    const avatarSmEl = document.createElement('div');
    avatarSmEl.className = 'tandem-avatar-sm';
    avatarSmEl.style.background = color;
    avatarSmEl.textContent = initials;

    const nameEl = document.createElement('span');
    nameEl.className = 'tandem-participant-name';
    nameEl.textContent = isLocal ? `${username} (You)` : username;

    const hostBadge = document.createElement('span');
    hostBadge.className = 'tandem-host-badge';
    hostBadge.textContent = '👑';
    hostBadge.title = 'Party Host';
    hostBadge.style.display = isHost ? 'inline' : 'none';

    const transferBtn = document.createElement('button');
    transferBtn.className = 'tandem-transfer-btn';
    transferBtn.textContent = '👑';
    transferBtn.title = 'Make host';
    transferBtn.style.display = 'none';
    if (!isLocal) {
      transferBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.callbacks.onTransferHost && this.callbacks.onTransferHost(userId);
      });
    }

    infoBar.appendChild(avatarSmEl);
    infoBar.appendChild(nameEl);
    infoBar.appendChild(hostBadge);
    if (!isLocal) infoBar.appendChild(transferBtn);

    element.appendChild(videoWrap);
    element.appendChild(infoBar);

    return { element, videoWrap, noCamEl, avatarLgEl, video, connectingEl, connectingLabel, infoBar, avatarSmEl, nameEl, hostBadge, transferBtn };
  }

  _buildDOM() {
    // ── Sidebar container ───────────────────────────────────────────────────
    this._sidebar = document.createElement('div');
    this._sidebar.id = 'tandem-sidebar';
    this._sidebar.className = 'tandem-sidebar';

    // Header
    const header = document.createElement('div');
    header.className = 'tandem-header';
    header.innerHTML = '<span class="tandem-logo">🎬 tandem.watch</span>';

    // Status bar
    const statusBar = document.createElement('div');
    statusBar.className = 'tandem-status-bar';
    this._statusDot = document.createElement('span');
    this._statusDot.className = 'tandem-status-dot';
    this._statusDot.style.background = '#a78bfa';
    this._statusText = document.createElement('span');
    this._statusText.className = 'tandem-status-text';
    this._statusText.textContent = 'Waiting for others…';
    statusBar.appendChild(this._statusDot);
    statusBar.appendChild(this._statusText);

    // Participant list
    this._participantList = document.createElement('div');
    this._participantList.className = 'tandem-participant-list';

    // Footer
    const footer = document.createElement('div');
    footer.className = 'tandem-footer';

    // Guest control toggle (host only)
    this._guestControlWrap = document.createElement('div');
    this._guestControlWrap.className = 'tandem-guest-control';
    this._guestControlWrap.style.display = 'none';

    this._guestToggle = document.createElement('input');
    this._guestToggle.type = 'checkbox';
    this._guestToggle.id = 'tandem-guest-toggle';
    this._guestToggle.checked = false;
    this._guestToggle.addEventListener('change', () => {
      this.callbacks.onToggleGuestControl && this.callbacks.onToggleGuestControl(this._guestToggle.checked);
    });

    const guestLabel = document.createElement('label');
    guestLabel.htmlFor = 'tandem-guest-toggle';
    guestLabel.textContent = 'Let guests control';
    this._guestControlWrap.appendChild(this._guestToggle);
    this._guestControlWrap.appendChild(guestLabel);

    // Leave button
    const leaveBtn = document.createElement('button');
    leaveBtn.className = 'tandem-leave-btn';
    leaveBtn.textContent = 'Leave Party';
    leaveBtn.addEventListener('click', () => {
      this.callbacks.onLeave && this.callbacks.onLeave();
    });

    footer.appendChild(this._guestControlWrap);
    footer.appendChild(leaveBtn);

    this._sidebar.appendChild(header);
    this._sidebar.appendChild(statusBar);
    this._sidebar.appendChild(this._participantList);
    this._sidebar.appendChild(footer);

    // ── Collapse tab ────────────────────────────────────────────────────────
    this._tab = document.createElement('button');
    this._tab.id = 'tandem-sidebar-tab';
    this._tab.className = 'tandem-sidebar-tab';
    this._tab.textContent = '❯';
    this._tab.title = 'Hide party panel';
    this._tab.addEventListener('click', () => this._toggleCollapse());
  }

  _injectStyles() {
    if (document.getElementById('tandem-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'tandem-sidebar-styles';
    style.textContent = `
      #tandem-sidebar.tandem-sidebar {
        position: fixed;
        top: 0;
        right: 0;
        width: ${SIDEBAR_WIDTH}px;
        height: 100vh;
        background: rgba(13, 13, 13, 0.96);
        backdrop-filter: blur(12px);
        z-index: 999998;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        border-left: 1px solid rgba(255,255,255,0.09);
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
        transform: translateX(0);
        overflow: hidden;
        box-shadow: -4px 0 24px rgba(0,0,0,0.6);
      }

      .tandem-header {
        padding: 14px 16px 12px;
        background: rgba(0,0,0,0.35);
        border-bottom: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }

      .tandem-logo {
        color: #e2e8f0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.3px;
      }

      .tandem-status-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 16px;
        background: rgba(0,0,0,0.2);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
      }

      .tandem-status-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .tandem-status-text {
        color: #94a3b8;
        font-size: 11px;
        font-weight: 500;
      }

      .tandem-participant-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .tandem-participant-list::-webkit-scrollbar { width: 4px; }
      .tandem-participant-list::-webkit-scrollbar-track { background: transparent; }
      .tandem-participant-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 4px; }

      .tandem-participant {
        border-radius: 10px;
        overflow: hidden;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.07);
        transition: border-color 0.15s ease;
      }

      .tandem-participant:hover {
        border-color: rgba(255,255,255,0.14);
      }

      .tandem-video-wrap {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        background: #0e0e1a;
        overflow: hidden;
      }

      .tandem-video-wrap video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .tandem-no-cam {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .tandem-avatar-lg {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        font-weight: 700;
        color: white;
        letter-spacing: -0.5px;
        user-select: none;
      }

      .tandem-connecting {
        position: absolute;
        inset: 0;
        background: rgba(0,0,0,0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2;
      }

      .tandem-connecting span {
        color: #94a3b8;
        font-size: 12px;
        font-weight: 500;
      }

      .tandem-participant-info {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        min-height: 38px;
      }

      .tandem-avatar-sm {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        color: white;
        flex-shrink: 0;
        user-select: none;
      }

      .tandem-participant-name {
        flex: 1;
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .tandem-host-badge {
        font-size: 13px;
        flex-shrink: 0;
        line-height: 1;
      }

      .tandem-transfer-btn {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 13px;
        opacity: 0;
        padding: 2px 4px;
        border-radius: 4px;
        flex-shrink: 0;
        line-height: 1;
        transition: opacity 0.15s ease, background 0.15s ease;
      }

      .tandem-participant:hover .tandem-transfer-btn[style*="block"] {
        opacity: 0.45;
      }

      .tandem-transfer-btn:hover {
        opacity: 1 !important;
        background: rgba(255,255,255,0.1);
      }

      .tandem-footer {
        padding: 12px 16px;
        background: rgba(0,0,0,0.3);
        border-top: 1px solid rgba(255,255,255,0.07);
        display: flex;
        flex-direction: column;
        gap: 10px;
        flex-shrink: 0;
      }

      .tandem-guest-control {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .tandem-guest-control input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: #0ea5e9;
        flex-shrink: 0;
      }

      .tandem-guest-control label {
        color: #94a3b8;
        font-size: 12px;
        cursor: pointer;
      }

      .tandem-leave-btn {
        width: 100%;
        padding: 9px;
        background: rgba(239,68,68,0.12);
        color: #f87171;
        border: 1px solid rgba(239,68,68,0.22);
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        font-family: inherit;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .tandem-leave-btn:hover {
        background: rgba(239,68,68,0.26);
        border-color: rgba(239,68,68,0.4);
      }

      #tandem-sidebar-tab.tandem-sidebar-tab {
        position: fixed;
        right: ${SIDEBAR_WIDTH}px;
        top: 50%;
        transform: translateY(-50%);
        width: 22px;
        height: 56px;
        background: rgba(13,13,13,0.96);
        border: 1px solid rgba(255,255,255,0.09);
        border-right: none;
        border-radius: 8px 0 0 8px;
        z-index: 999997;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #64748b;
        font-size: 10px;
        box-shadow: -2px 0 10px rgba(0,0,0,0.4);
        transition: right 0.3s cubic-bezier(0.4,0,0.2,1), background 0.15s ease, color 0.15s ease;
      }

      #tandem-sidebar-tab.tandem-sidebar-tab:hover {
        background: rgba(25,25,25,0.98);
        color: #e2e8f0;
      }
    `;
    document.head.appendChild(style);
  }
}
