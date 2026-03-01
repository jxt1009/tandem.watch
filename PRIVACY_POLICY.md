# Privacy Policy for tandem.watch

**Last Updated:** February 2026

## Overview

tandem.watch is a Chrome extension that enables synchronized Netflix watching with peer-to-peer video and audio chat. This privacy policy explains what data we collect and how we handle it.

## Data We Collect

### 1. Real-Time Playback Activity
- **What:** Netflix playback events (play, pause, seek, current timestamp)
- **Why:** To synchronize playback across all viewers in a watch party
- **Where:** Transmitted via WebSocket to our signaling server, then relayed to other participants
- **Retention:** Not stored persistently; discarded when the watch party ends

### 2. Peer-to-Peer Video and Audio
- **What:** Live video stream from your webcam and audio from your microphone
- **Why:** To enable face-to-face communication during watch parties
- **How:** Streamed directly peer-to-peer using WebRTC with DTLS-SRTP encryption
- **Storage:** Never transmitted to or stored on our central servers—data goes directly between participants only

### 3. Room Identification
- **What:** Room ID used to join a watch party
- **Why:** To organize viewers into separate watch parties and prevent unauthorized access
- **Retention:** Maintained only while the room is active

## Data We Do NOT Collect

- ❌ Personal information (name, email, address, etc.)
- ❌ Your Netflix account credentials
- ❌ Your IP address or location
- ❌ Browsing history outside of Netflix
- ❌ Payment or financial information
- ❌ Health or biometric data

## How Your Data is Protected

1. **P2P Encryption:** Video and audio streams use DTLS-SRTP encryption end-to-end
2. **No Central Storage:** Media streams never touch our servers—they go directly between peers
3. **Minimal Server Data:** Our signaling server only stores temporary metadata (room IDs, connection states)
4. **Browser Sandbox:** The extension runs within Chrome's security sandbox

## Third-Party Services

Our signaling server may use STUN/TURN services to help establish peer connections:
- **STUN:** Used to discover your public IP for direct connections
- **TURN:** Used only as a fallback if a direct connection cannot be established
- These services do not log your data

## Data Sharing

We **do not** sell, transfer, or share your data with third parties. Data is only shared:
- Between peers in your watch party (directly via P2P)
- With our signaling server (temporarily, for connection management)
- Where required by law (if legally compelled)

## Your Controls

- **Camera/Microphone:** You grant permission when prompted; you can revoke permissions in Chrome settings
- **Room Participation:** You control who joins your watch party by sharing the room ID
- **Extension Removal:** Uninstall the extension anytime to stop all data collection

## Contact

For questions about this privacy policy, contact: **privacy@toper.dev**

## Changes to This Policy

We may update this policy occasionally. We will notify you by updating the "Last Updated" date and posting the new version at privacy.toper.dev.

---

**For Chrome Web Store:** This extension does not use personal data for advertising, marketing, or any purpose unrelated to synchronized watching.
