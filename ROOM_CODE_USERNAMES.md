# New Features: Room Code Join & Persistent Usernames

## Overview

Two new user-friendly features have been added to tandem.watch:

1. **Room Code Join** - Allows users to manually enter a short room code to join an existing party
2. **Persistent Usernames** - Users can set a custom display name that persists across sessions

## Feature 1: Room Code Join

### For People Without Link Access

**Use Case:** If you can't access messages on your computer (no SMS, chat app, etc.) but can talk to friends on the phone, they can read you a short code to join their watch party.

### How to Use

#### To Share a Code (Host):
1. Click "Start Party"
2. Look at the popup and find "Room Code:"
3. Click "Copy" button next to the room code
4. Share the short code with your friend (e.g., "a939jfa")

#### To Join with a Code (Guest):
1. Make sure you're on a Netflix page
2. Click the tandem.watch extension
3. In the "Already have a room code?" section, paste or type the code
4. Click "Join" or press Enter
5. You'll automatically join the party!

### Example Flow

```
Host to Friend (via phone):
"Hey, my room code is: a-9-3-9-j-f-a"

Friend:
1. Opens Netflix
2. Clicks tandem.watch extension
3. Pastes: a939jfa
4. Presses Join
5. Connected! ✅
```

### Technical Details

- **Short codes** are 6-8 character alphanumeric strings (e.g., `a939jfa`)
- **No link needed** - just the code
- **Case insensitive** - works with uppercase or lowercase
- **Persistent** - codes stay valid for 7 days

## Feature 2: Persistent Usernames

### Replace Generic User IDs

**Previous:** Your display name was a random ID like "user_k9d3x2f1"
**Now:** Set a custom name like "Alice" that persists forever

### How to Use

1. Open the tandem.watch extension popup
2. Find "Username:" at the very top
3. Type your desired name (up to 20 characters)
4. Click "Save" or press Enter
5. Your username is now saved and will be used for all future parties

### Storage & Persistence

- **Stored in:** Chrome's local storage (chrome.storage.local)
- **Persistence:** Permanent - survives browser restart
- **Scope:** Per Chrome profile (syncs if you use Chrome sync)
- **Privacy:** Only stored on your device, never sent to external servers

### Example

```
Username field: [    Alice        ] [Save]

After saving:
Your ID: Alice (instead of "user_h3k9d2x1")
```

## UI Changes

### Updated Popup

The extension popup now has these sections:

```
┌─────────────────────────────────┐
│      🎬 tandem.watch            │
├─────────────────────────────────┤
│ Username: [________________] [S] │  ← NEW: Set your name
│                                 │
│ Status: 🔴 Disconnected         │
│                                 │
│ [Start Party] [Join Room Code] │
│                                 │
│ Already have a room code?        │  ← NEW: Join section
│ [_____________] [Join]          │
│                                 │
│ Connected to: [server URL]      │
└─────────────────────────────────┘
```

### When Connected

```
┌─────────────────────────────────┐
│      🎬 tandem.watch            │
├─────────────────────────────────┤
│ Status: 🟢 Connected            │
│                                 │
│ Share Link:                     │
│ watch.toper.dev/room/a939jfa   │
│ [Copy]                          │
│                                 │
│ Room Code:                      │  ← NEW: Easy code copy
│ a939jfa                         │
│ [Copy]                          │
│                                 │
│ Your ID: Alice                  │  ← Shows username
│ Webcam/Mic: Streaming          │
│                                 │
│ [Leave Party]                  │
└─────────────────────────────────┘
```

## Server API Endpoints

### New Endpoint: /api/room/:shortId

Reverse lookup - convert short code to room ID

**Request:**
```
GET https://watch.toper.dev/api/room/a939jfa
```

**Response (200):**
```json
{
  "roomId": "550e8400-e29b-41d4-a716-446655440000",
  "shortId": "a939jfa"
}
```

**Response (404):**
```json
{
  "error": "Room not found"
}
```

## Implementation Details

### Backend Changes

**signaling_server/server.js:**
- Added `GET /api/room/:shortId` route
- Performs Redis lookup: `shortid:rev:{shortId}` → `roomId`
- Returns JSON with roomId and shortId

### Extension Changes

**popup.html:**
- Added username input field at top
- Added room code display next to share link
- Added "Join Party" section with room code input

**popup.main.js:**
- Added `loadUsername()` - retrieves saved username from storage
- Added `saveUsername()` - persists username to chrome.storage.local
- Added `joinRoomByCode()` - joins a room by short code
- Updated `buildShareLink()` to extract and display short code
- All functions pass username when starting/joining parties

**background/BackgroundService.js:**
- Added `this.username` property to store display name
- Updated `startParty(inputRoomId, inputUsername)` to accept username
- Username is passed along when joining server

**background/main.js:**
- Updated message handler to extract `request.username`
- Passes username parameter to `startParty()`

## Usage Examples

### Scenario 1: Phone Call Party Setup

```
Alice (host):
- Clicks extension → "Start Party"
- Sees code: "m7k2xpq"
- Calls Bob: "Room code is M-7-K-2-X-P-Q"

Bob (guest):
- Clicks extension
- Enters: m7k2xpq
- Clicks Join
- Instantly connected! ✅
```

### Scenario 2: Username Setup

```
First time using extension:
1. Open extension popup
2. Type: "Charlie"
3. Click Save
4. Status shows "Your ID: Charlie" ✓

Next time:
1. Open extension
2. Username field already shows "Charlie"
3. No need to re-enter!
```

### Scenario 3: Multiple Users, Same Browser

```
User A:
- Sets username to "Alice"
- Starts party

Later, User B:
- Opens extension on same profile
- Changes username to "Bob"
- Saves
- Bob's name persists for future uses
```

## Benefits

### Room Code Join Benefits
✅ No internet bandwidth needed for sharing (just voice/phone)
✅ Works when messaging apps aren't available
✅ Easy to read aloud (7-8 characters vs 36-character UUID)
✅ Memorable during phone conversations
✅ Accessible for non-tech-savvy users

### Username Benefits
✅ Much friendlier than random user IDs
✅ Persistent - set once, use forever
✅ Appears in party info for your friends to see
✅ Stored securely in browser (never sent to third parties)
✅ Works across multiple computers via Chrome sync

## Keyboard Shortcuts

### In Popup
- **Enter** in username field → Save username
- **Enter** in room code field → Join room with code

### Copy Buttons
- Click "Copy" next to share link → Copies full URL
- Click "Copy" next to room code → Copies short code only

## Troubleshooting

### Room Code Not Found
- Check the code is exactly right (case insensitive)
- The room might have expired (older than 7 days)
- Make sure the host started the party

### Username Not Saving
- Make sure you click the "Save" button or press Enter
- You should see "✓ Saved" confirmation
- Check that third-party storage isn't blocked

### Room Code Not Displaying
- Make sure you're connected to a party
- The code appears after "Start Party" is successful
- Both "Share Link" and "Room Code" should display

## Future Enhancements

Potential improvements:
- QR codes for room codes
- Share buttons for direct messaging apps
- Usernames displayed in video overlays
- Edit username without resetting party
