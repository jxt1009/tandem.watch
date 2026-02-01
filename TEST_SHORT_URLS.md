# Short URL Testing Guide

## How the Short URL System Works

### User Flow:
1. User opens tandem.watch extension on Netflix
2. Clicks "Start Party"
3. Gets a short URL like: `https://watch.toper.dev/room/a939jfa`
4. Shares that URL with friends
5. Friends click the link and are automatically redirected to Netflix with the tandemRoom parameter
6. Extension auto-joins the party

### Technical Flow:

#### Step 1: Room Creation
```
Extension: starts party, gets roomId (UUID)
Example: roomId = "550e8400-e29b-41d4-a716-446655440000"
```

#### Step 2: Short ID Generation
```
Popup: calls buildShareLink(roomId)
  → fetches https://watch.toper.dev/api/short-id/{roomId}
  → Server generates/retrieves short ID (base36)
  → Server stores mapping in Redis:
    - shortid:550e8400... = "a939jfa"
    - shortid:rev:a939jfa = "550e8400..."
  → Returns { shortId: "a939jfa", shortUrl: "https://watch.toper.dev/room/a939jfa" }
```

#### Step 3: Short URL Display
```
Popup shows: "https://watch.toper.dev/room/a939jfa" in copy-able field
User copies and shares this link
```

#### Step 4: Friend Clicks Link
```
Browser navigates to: https://watch.toper.dev/room/a939jfa
Server:
  1. Matches route /room/a939jfa
  2. Looks up roomId: "shortid:rev:a939jfa" → "550e8400..."
  3. Redirects (302) to: "https://www.netflix.com/?tandemRoom=550e8400..."
  4. Browser loads Netflix with tandemRoom parameter
```

#### Step 5: Auto-Join
```
Netflix page loads with ?tandemRoom=550e8400...
Content script's checkJoinFromLink() detects param
Sends START_PARTY message to background service with roomId
Extension connects to WebSocket and joins the room
```

### Benefits Over Previous System:

| Aspect | Old (Long URL) | New (Short URL) |
|--------|---|---|
| URL Length | ~80+ chars | 7-8 chars |
| Example | `https://www.netflix.com/browse?tandemRoom=550e8400-e29b-41d4-a716-446655440000` | `https://watch.toper.dev/room/a939jfa` |
| Shareability | Unwieldy | Much better for chat/messaging |
| QR Code Friendly | Large QR code | Compact QR code |
| Memorable | Not memorable | Easier to remember 7-char code |

## Testing Checklist

- [ ] Extension builds without errors
- [ ] Start a party and check popup displays a short URL
- [ ] Copy the short URL to clipboard
- [ ] Paste and open the short URL in a browser
- [ ] Verify redirect to Netflix with tandemRoom param
- [ ] Verify content script detects param and connects
- [ ] Test in multiple browser windows
- [ ] Check Redis has short ID mappings after testing
  - `redis-cli get shortid:{roomId}`
  - `redis-cli get shortid:rev:{shortId}`

## Server Endpoints Added

### 1. GET /room/:shortId
- **Purpose**: Redirect handler for short URLs
- **Returns**: 302 redirect to Netflix with tandemRoom param
- **Example**: `GET /room/a939jfa` → redirects to `https://www.netflix.com/?tandemRoom=550e8400...`

### 2. GET /api/short-id/:roomId
- **Purpose**: Get or create a short ID for a room
- **Returns**: JSON with shortId and short URL
- **Example Response**:
```json
{
  "shortId": "a939jfa",
  "roomId": "550e8400-e29b-41d4-a716-446655440000",
  "shortUrl": "https://watch.toper.dev/room/a939jfa"
}
```

## Implementation Details

### Server Changes (signaling_server/server.js):
- Added `generateShortId()` - creates random 6-8 char base36 strings
- Added `getOrCreateShortId(roomId)` - handles persistence in Redis
- Added `getRoomIdFromShortId(shortId)` - reverse lookup
- Added `/room/:shortId` HTTP route
- Added `/api/short-id/:roomId` HTTP route

### Config Changes (signaling_server/config.js):
- Added `keys.shortId(roomId)` - stores short ID for room
- Added `keys.shortIdReverse(shortId)` - stores reverse mapping

### Extension Changes (chrome-extension/src/ui/popup.main.js):
- Updated `buildShareLink()` to call server API instead of building Netflix URL
- Now returns `https://watch.toper.dev/room/{shortId}` instead of long Netflix URL

### Storage:
- Redis TTL: 7 days (automatically cleaned up)
- Memory cache: in-memory backup for fast lookup
