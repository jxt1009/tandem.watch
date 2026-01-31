# tandem.watch

**Skip the chatbox. Watch face-to-face.**

A Chrome extension for synchronized Netflix watch parties with built-in video chat. Watch together in real-time with automatic playback sync and peer-to-peer video streaming.

---

## ✨ Features

- 🎬 **Synchronized Playback** - Play/pause/seek automatically syncs across all viewers
- 📹 **Built-in Video Chat** - WebRTC peer-to-peer video and audio with draggable feeds
- 🔄 **Smart Navigation** - Seamlessly switch episodes together with automatic sync restoration
- 🎯 **Auto Volume** - Netflix volume automatically managed (15% during party)
- 💪 **Robust Connection** - Heartbeat monitoring with automatic reconnection and fallback
- 🌐 **Room-Based Parties** - Private synchronized rooms with room ID sharing
- ⚡ **Low Latency** - P2P direct connections bypass centralized servers
- 🔒 **Encrypted Media** - DTLS-SRTP encryption for all video/audio streams

---

## 🚀 Quick Start

### Prerequisites
- Chrome or Chromium browser
- Node.js 18+ (for running signaling server)
- SSL certificate (for production server deployment)

### Installation

1. **Clone and setup**
   ```bash
   git clone https://github.com/jxt1009/tandem.watch.git
   cd tandem.watch
   npm install
   ```

2. **Build the extension**
   ```bash
   npm run build
   ```

3. **Load in Chrome**
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist/` folder

4. **Start the signaling server**
   ```bash
   cd signaling_server
   npm install
   npm start
   ```
   Server runs on port 4001 with WebSocket at `/ws`

### Usage

1. Navigate to netflix.com
2. Click the tandem.watch extension icon
3. Enter a room ID (or generate one)
4. Click "Start Party"
5. Grant camera/microphone permissions
6. Share the room ID with friends—they join with the same ID
7. Watch together! Playback stays automatically synced

---

## 🏗️ Architecture

### Chrome Extension (Client)
- **Manifest V3** - Modern extension with service worker
- **Content Scripts** - Inject into Netflix for playback control
- **WebRTC** - Peer-to-peer video/audio streaming
- **Modular Design** - Clean separation with dedicated managers
  - `background/` - Background service worker
  - `content/` - Content scripts and Netflix controller
  - `managers/` - State, sync, and URL management
  - `services/` - WebRTC and signaling services
  - `ui/` - Popup UI components

### Signaling Server
- **Node.js + WebSocket** - Real-time message relay
- **Room-Based** - Multiple isolated watch parties
- **State Management** - Tracks rooms and handles host migration
- **Health Monitoring** - Heartbeat system and automatic cleanup

### Data Flow

**Playback Sync:**
```
Netflix Video → Content Script → Background Service → WebSocket → Server → Other Peers
```

**Media Streaming:**
```
Camera/Mic → getUserMedia() → WebRTC → STUN/TURN → Peer's WebRTC → Display
```

**Room Management:**
```
JOIN/LEAVE → WebSocket → Server → Broadcasts to Room Members
```

---

## 📁 Project Structure

```
tandem.watch/
├── chrome-extension/
│   ├── src/
│   │   ├── background/        # Service worker
│   │   ├── content/           # Netflix injection
│   │   ├── managers/          # State, sync, URL
│   │   ├── services/          # WebRTC & signaling
│   │   └── ui/                # Popup components
│   ├── images/                # Extension icons
│   ├── manifest.json
│   ├── popup.html
│   └── styles.css
├── signaling_server/
│   ├── server.js              # WebSocket server
│   ├── config.js
│   ├── db.js
│   ├── logger.js
│   └── docker-compose.yml
├── k8s/                       # Kubernetes manifests
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── postgres.yaml
│   ├── redis.yaml
│   └── overlays/              # Environment configs
├── docs/
│   ├── QUICKSTART.md
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   └── KUBERNETES_DEPLOYMENT.md
├── webpack.config.js
└── package.json
```

---

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | 30-second setup guide |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and module breakdown |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment and production setup |
| [docs/KUBERNETES_DEPLOYMENT.md](docs/KUBERNETES_DEPLOYMENT.md) | Kubernetes cluster deployment on Ubuntu |

---

## 🛠️ Development

### Build Commands
```bash
npm run build          # Production build
npm run build:dev      # Development with source maps
npm run watch          # Watch mode
npm run clean          # Clean artifacts
```

### Running Locally
```bash
# Terminal 1: Signaling server
cd signaling_server
npm start

# Terminal 2: Watch extension
npm run watch

# Then load dist/ in Chrome
```

---

## 🔧 Configuration

| Setting | File | Default | Notes |
|---------|------|---------|-------|
| Server URL | `background/index.js` | `ws://watch.toper.dev/ws` | Update for your domain |
| Video Size | `services/webrtc/ui.js` | 640×480 | Adjust for bandwidth |
| Sync Interval | `sync/SyncManager.js` | 5000ms | How often to sync position |
| Heartbeat | `BackgroundService.js` | 15s ping, 10s timeout | Connection health |

---

## 🔐 Security & Privacy

- **Encrypted Media** - DTLS-SRTP encryption on all streams
- **Room Isolation** - Private room IDs prevent unauthorized access
- **P2P Direct** - Media never touches central server
- **Browser Sandbox** - Extension runs in browser sandbox
- **STUN/TURN** - Network traversal without exposing real IPs

---

## 🐛 Troubleshooting

### Extension not connecting
- [ ] Check signaling server is running (`npm start`)
- [ ] Verify server URL in `background/index.js`
- [ ] Check browser console for errors

### Video not syncing after navigation
- [ ] Verify sync manager logs in console
- [ ] Check party state remains active
- [ ] Try refreshing the Netflix page

### WebRTC connection failing
- [ ] Grant camera/microphone permissions
- [ ] Check firewall/NAT settings
- [ ] Verify STUN server accessibility
- [ ] Consider adding TURN server for restricted networks

---

## 📊 Performance

- **Signaling Overhead** - ~40KB/sec per user (server-side)
- **Media Bandwidth** - Depends on peers (direct P2P, not metered server-side)
- **Sync Latency** - <100ms typical
- **Position Accuracy** - ±500ms tolerance

---

## 📦 Deployment

### Docker (Production)
```bash
cd signaling_server
docker-compose up -d
```

### Manual (Local/Server)
```bash
cd signaling_server
npm install
node server.js
```

---

## 📝 License

MIT

---

## 🤝 Contributing

Pull requests welcome! Please ensure:
- Code follows existing style
- All console logs use appropriate prefixes (e.g., `[SyncManager]`, `[WebRTCManager]`)
- Test with multiple users in a party
- Verify navigation and reconnection scenarios work correctly

---

## 🎉 Ready to Use!

Your Netflix Party Sync extension is fully implemented and ready to deploy. Start the signaling server, load the extension in Chrome, and begin synchronized watching today!

Questions? Check [docs/QUICKSTART.md](docs/QUICKSTART.md) for quick setup or [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for technical details. For Kubernetes deployment, see [docs/KUBERNETES_DEPLOYMENT.md](docs/KUBERNETES_DEPLOYMENT.md).
