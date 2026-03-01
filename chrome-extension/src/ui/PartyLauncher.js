/**
 * PartyLauncher — floating in-page widget on Netflix.
 * Shows a small pill button that expands to a start/join panel.
 * Replaces the browser popup for initiating parties.
 */
export class PartyLauncher {
  constructor({ onStartParty, onJoinParty } = {}) {
    this.callbacks = { onStartParty, onJoinParty };
    this._el = null;
    this._expanded = false;
    this._visible = true;
  }

  mount() {
    if (this._el) return;
    this._injectStyles();
    this._buildDOM();
    document.body.appendChild(this._el);
  }

  destroy() {
    if (this._el) { this._el.remove(); this._el = null; }
    const s = document.getElementById('tandem-launcher-styles');
    if (s) s.remove();
  }

  show() {
    this._visible = true;
    if (this._el) this._el.style.display = 'flex';
  }

  hide() {
    this._visible = false;
    if (this._el) this._el.style.display = 'none';
    this._setExpanded(false);
  }

  toggle() {
    if (!this._el) return;
    if (!this._visible) {
      this.show();
      this._setExpanded(true);
    } else {
      this._setExpanded(!this._expanded);
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _setExpanded(val) {
    this._expanded = val;
    if (!this._el) return;
    const panel = this._el.querySelector('.tandem-lnch-panel');
    const btn = this._el.querySelector('.tandem-lnch-pill');
    if (panel) panel.style.display = val ? 'flex' : 'none';
    if (btn) btn.dataset.active = val ? 'true' : 'false';
  }

  _buildDOM() {
    const wrap = document.createElement('div');
    wrap.id = 'tandem-launcher';
    wrap.className = 'tandem-lnch-wrap';

    // ── Pill toggle button ────────────────────────────────────────────────
    const pill = document.createElement('button');
    pill.className = 'tandem-lnch-pill';
    pill.title = 'tandem.watch – Start or join a party';
    pill.innerHTML = `<span class="tandem-lnch-icon">🎬</span><span class="tandem-lnch-label">Start a Party?</span>`;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this._setExpanded(!this._expanded);
    });

    // ── Expanded panel ────────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'tandem-lnch-panel';
    panel.style.display = 'none';

    // Header
    const header = document.createElement('div');
    header.className = 'tandem-lnch-header';
    header.innerHTML = `<span>🎬 tandem.watch</span>`;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tandem-lnch-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this._setExpanded(false));
    header.appendChild(closeBtn);

    // Username
    const usernameRow = document.createElement('div');
    usernameRow.className = 'tandem-lnch-row';
    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.className = 'tandem-lnch-input';
    usernameInput.placeholder = 'Your name';
    usernameInput.maxLength = 30;
    // Load persisted username
    try {
      chrome.storage.local.get(['tandemUsername'], (result) => {
        if (result.tandemUsername) usernameInput.value = result.tandemUsername;
      });
    } catch (e) {}
    usernameRow.appendChild(usernameInput);

    // Start party button
    const startBtn = document.createElement('button');
    startBtn.className = 'tandem-lnch-btn primary';
    startBtn.textContent = '🎉 Start Party';
    startBtn.addEventListener('click', () => {
      const name = usernameInput.value.trim();
      if (name) {
        try { chrome.storage.local.set({ tandemUsername: name }); } catch (e) {}
      }
      if (this.callbacks.onStartParty) {
        this.callbacks.onStartParty(name || null);
      }
      this._setExpanded(false);
    });

    // Divider
    const divider = document.createElement('div');
    divider.className = 'tandem-lnch-divider';
    divider.innerHTML = `<span>or join existing party</span>`;

    // Join row
    const joinRow = document.createElement('div');
    joinRow.className = 'tandem-lnch-row';
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.className = 'tandem-lnch-input';
    codeInput.placeholder = 'Room code (e.g. abc123)';
    codeInput.maxLength = 12;

    const pinInput = document.createElement('input');
    pinInput.type = 'text';
    pinInput.className = 'tandem-lnch-input';
    pinInput.placeholder = 'PIN (optional)';
    pinInput.maxLength = 8;
    pinInput.inputMode = 'numeric';

    joinRow.appendChild(codeInput);
    joinRow.appendChild(pinInput);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'tandem-lnch-btn secondary';
    joinBtn.textContent = '🔗 Join Party';
    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim();
      if (!code) { codeInput.focus(); return; }
      const pin = pinInput.value.trim() || null;
      const name = usernameInput.value.trim();
      if (name) {
        try { chrome.storage.local.set({ tandemUsername: name }); } catch (e) {}
      }
      if (this.callbacks.onJoinParty) {
        this.callbacks.onJoinParty(code, pin, name || null);
      }
      this._setExpanded(false);
    });

    // Allow Enter key on inputs
    [codeInput, pinInput].forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') joinBtn.click();
      });
    });
    usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startBtn.click();
    });

    // Status / error message area
    const statusEl = document.createElement('div');
    statusEl.className = 'tandem-lnch-status';
    statusEl.style.display = 'none';
    this._statusEl = statusEl;
    this._startBtn = startBtn;
    this._joinBtn = joinBtn;

    panel.appendChild(header);
    panel.appendChild(usernameRow);
    panel.appendChild(startBtn);
    panel.appendChild(divider);
    panel.appendChild(joinRow);
    panel.appendChild(joinBtn);
    panel.appendChild(statusEl);

    wrap.appendChild(panel);
    wrap.appendChild(pill);
    this._el = wrap;
  }

  showStatus(msg, isError = false) {
    if (!this._statusEl) return;
    this._statusEl.textContent = msg;
    this._statusEl.style.display = 'block';
    this._statusEl.style.color = isError ? '#f87171' : '#86efac';
    setTimeout(() => {
      if (this._statusEl) this._statusEl.style.display = 'none';
    }, 3000);
  }

  setLoading(isLoading) {
    if (this._startBtn) this._startBtn.disabled = isLoading;
    if (this._joinBtn) this._joinBtn.disabled = isLoading;
    if (this._startBtn) this._startBtn.textContent = isLoading ? '⏳ Connecting…' : '🎉 Start Party';
  }

  _injectStyles() {
    if (document.getElementById('tandem-launcher-styles')) return;
    const s = document.createElement('style');
    s.id = 'tandem-launcher-styles';
    s.textContent = `
      #tandem-launcher {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483640;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-family: 'Netflix Sans', 'Helvetica Neue', Arial, sans-serif;
      }
      .tandem-lnch-pill {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 8px 18px;
        background: rgba(20, 20, 20, 0.85);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 999px;
        color: #e5e7eb;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        backdrop-filter: blur(10px);
        box-shadow: 0 2px 12px rgba(0,0,0,0.4);
        transition: background 0.15s, opacity 0.15s;
        letter-spacing: 0.2px;
        white-space: nowrap;
      }
      .tandem-lnch-pill:hover { background: rgba(35,35,35,0.95); opacity: 1 !important; }
      .tandem-lnch-pill[data-active="true"] { border-color: rgba(229,9,20,0.5); }
      /* Fade the pill slightly when not hovered so it doesn't distract during viewing */
      .tandem-lnch-pill { opacity: 0.7; }
      .tandem-lnch-icon { font-size: 15px; line-height: 1; }
      .tandem-lnch-label { color: #fff; }
      .tandem-lnch-panel {
        flex-direction: column;
        gap: 10px;
        background: #141414;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 14px;
        width: 270px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        backdrop-filter: blur(12px);
      }
      .tandem-lnch-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #e5e7eb;
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 2px;
      }
      .tandem-lnch-close {
        background: none;
        border: none;
        color: #6b7280;
        cursor: pointer;
        font-size: 13px;
        padding: 2px 4px;
        line-height: 1;
      }
      .tandem-lnch-close:hover { color: #e5e7eb; }
      .tandem-lnch-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tandem-lnch-input {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        color: #e5e7eb;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        width: 100%;
        box-sizing: border-box;
      }
      .tandem-lnch-input::placeholder { color: #6b7280; }
      .tandem-lnch-input:focus { border-color: rgba(229,9,20,0.6); }
      .tandem-lnch-btn {
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        padding: 9px;
        cursor: pointer;
        width: 100%;
        transition: opacity 0.15s;
      }
      .tandem-lnch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .tandem-lnch-btn.primary { background: #e50914; color: #fff; }
      .tandem-lnch-btn.primary:hover:not(:disabled) { background: #c40812; }
      .tandem-lnch-btn.secondary { background: rgba(255,255,255,0.1); color: #e5e7eb; }
      .tandem-lnch-btn.secondary:hover:not(:disabled) { background: rgba(255,255,255,0.16); }
      .tandem-lnch-divider {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #4b5563;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .tandem-lnch-divider::before,
      .tandem-lnch-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: rgba(255,255,255,0.08);
      }
      .tandem-lnch-status {
        font-size: 12px;
        text-align: center;
        padding: 4px 0;
      }
    `;
    document.head.appendChild(s);
  }
}
