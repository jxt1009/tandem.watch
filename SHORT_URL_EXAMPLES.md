# Short URL Examples & Usage

## Real-World Examples

### Before (Old System)
User would share:
```
https://www.netflix.com/browse?tandemRoom=550e8400-e29b-41d4-a716-446655440000
```
- 80+ characters
- Hard to type
- Breaks in some chat apps due to length

### After (New System)
User now shares:
```
https://watch.toper.dev/room/a939jfa
```
- Only 35 characters
- Easy to remember and type
- QR-code friendly
- Looks clean in messages

## Sample Short IDs Generated

The server generates random 6-8 character IDs:
- `a939jfa`
- `k2m9xpq`
- `w5r8nzt`
- `c3b7vsd`
- `p1q4jhx`

## What Happens Behind the Scenes

### Extension Popup Display

```
┌─────────────────────────────────────┐
│  Tandem Watch Party                 │
├─────────────────────────────────────┤
│                                     │
│  🟢 Connected                       │
│                                     │
│  Share Link:                        │
│  https://watch.toper.dev/room/a939jfa
│                                     │
│  [Copy]                             │
│                                     │
│  Your ID: 550e8400-e29b-41d4-a716   │
│                                     │
└─────────────────────────────────────┘
```

### Network Flow

```
Browser #1 (Host)
├─ Starts party
├─ Gets roomId: 550e8400-e29b-41d4-a716-446655440000
├─ Popup requests: /api/short-id/550e8400...
├─ Server returns: {shortId: "a939jfa", shortUrl: "..."}
├─ User copies: https://watch.toper.dev/room/a939jfa
└─ Shares with friend

Browser #2 (Guest)
├─ Clicks link: https://watch.toper.dev/room/a939jfa
├─ Server sees /room/a939jfa
├─ Looks up roomId: 550e8400-e29b-41d4-a716-446655440000
├─ Redirects to: netflix.com/?tandemRoom=550e8400...
├─ Netflix loads, content script detects param
├─ Sends START_PARTY with roomId to background service
├─ WebSocket connects to signaling server
└─ Party started! ✅
```

## Server Endpoints Usage

### Endpoint 1: Generate/Retrieve Short ID
```
GET https://watch.toper.dev/api/short-id/550e8400-e29b-41d4-a716-446655440000

Response (200 OK):
{
  "shortId": "a939jfa",
  "roomId": "550e8400-e29b-41d4-a716-446655440000",
  "shortUrl": "https://watch.toper.dev/room/a939jfa"
}
```

### Endpoint 2: Redirect Short URL
```
GET https://watch.toper.dev/room/a939jfa

Response (302 Found):
Location: https://www.netflix.com/?tandemRoom=550e8400-e29b-41d4-a716-446655440000
```

## Redis Storage Details

### When a room is created:

```
Host creates party → roomId = "550e8400-e29b-41d4-a716-446655440000"
                  ↓
Popup calls /api/short-id/550e8400...
                  ↓
Server generates shortId = "a939jfa"
                  ↓
Redis stores:
  SET shortid:550e8400-e29b-41d4-a716-446655440000 "a939jfa" EX 604800
  SET shortid:rev:a939jfa "550e8400-e29b-41d4-a716-446655440000" EX 604800
                  ↓
Returns shortId to extension
                  ↓
Popup displays: https://watch.toper.dev/room/a939jfa
```

### When a guest opens the short URL:

```
Guest clicks: https://watch.toper.dev/room/a939jfa
                  ↓
Server receives: GET /room/a939jfa
                  ↓
Redis lookup: GET shortid:rev:a939jfa
                  ↓
Returns: "550e8400-e29b-41d4-a716-446655440000"
                  ↓
Server redirects: 302 → netflix.com/?tandemRoom=550e8400...
```

## Sharing Methods

### Via Text Message
```
Hey, join my watch party! https://watch.toper.dev/room/a939jfa
```

### Via QR Code
Much smaller QR code since URL is shorter ✨

### Via Email
Cleaner and more professional looking

### Via Slack
```
@friend join my watch party: https://watch.toper.dev/room/a939jfa
```

## Browser Compatibility

- ✅ Chrome (primary)
- ✅ Edge
- ✅ Firefox (with WebRTC)
- ✅ Opera

All will work with the short URL system since it relies on standard HTTP redirects.

## Error Handling

### Room not found (404)
```
GET https://watch.toper.dev/room/invalid123

Response (404 Not Found):
Room not found
```

### Server error (500)
```
If short ID lookup fails, server returns:
{
  "error": "Failed to create short ID"
}
```

The popup has fallback logic that will notify the user if the short URL can't be generated.
