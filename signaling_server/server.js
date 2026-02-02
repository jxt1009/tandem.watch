import http from 'http';
import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import logger from './logger.js';
import {
  initializeRedis,
  initializeDatabase,
  closeConnections,
  RoomRepository,
  UserRepository,
  EventRepository,
  redis,
} from './db.js';

// ============= STATE =============
const wsConnections = new Map(); // WebSocket -> { userId, roomId, peerId }
const localRoomSubscribers = new Map(); // roomId -> Set of subscribed WebSockets
const roomToShortId = new Map(); // roomId -> shortId (in-memory cache)
const roomReadyStates = new Map(); // roomId -> { expectedUserIds:Set, readyUserIds:Set, targetTime, desiredPlay, createdAt, timeoutId }

function getConnectedUserIds(roomId) {
  return new Set(
    Array.from(wsConnections.values())
      .filter(info => info.roomId === roomId)
      .map(info => info.userId)
  );
}

function startReadyGate(roomId, targetTime, desiredPlay) {
  const existing = roomReadyStates.get(roomId);
  if (existing?.timeoutId) clearTimeout(existing.timeoutId);

  const expectedUserIds = getConnectedUserIds(roomId);
  const state = {
    expectedUserIds,
    readyUserIds: new Set(),
    targetTime,
    desiredPlay,
    createdAt: Date.now(),
    timeoutId: null,
  };
  roomReadyStates.set(roomId, state);

  state.timeoutId = setTimeout(async () => {
    const gate = roomReadyStates.get(roomId);
    if (!gate) return;
    if (gate.desiredPlay) {
      await RoomRepository.update(roomId, { currentTime: gate.targetTime, isPlaying: true });
      broadcastToRoom(roomId, {
        type: 'PLAY_PAUSE',
        userId: 'server',
        control: 'play',
        currentTime: gate.targetTime,
        eventTimestamp: gate.createdAt,
        timestamp: Date.now(),
      });
    }
    roomReadyStates.delete(roomId);
  }, 7000);
}

// ============= SHORT URL HELPERS =============

function generateShortId() {
  // Generate a cryptographically secure short alphanumeric ID (7 chars)
  // Using crypto.getRandomValues() for true randomness
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return array[0].toString(36).substring(0, 4) + array[1].toString(36).substring(0, 3);
}

async function getOrCreateShortId(roomId) {
  // Check in-memory cache first
  if (roomToShortId.has(roomId)) {
    return roomToShortId.get(roomId);
  }

  // Check Redis for persistence
  const key = config.keys.shortId(roomId);
  let shortId = await redis.client.get(key);
  
  if (!shortId) {
    // Generate new short ID
    shortId = generateShortId();
    
    // Store mapping both ways in Redis with 4-hour expiry
    await redis.client.set(key, shortId, 'EX', 4 * 60 * 60); // 4 hours
    await redis.client.set(config.keys.shortIdReverse(shortId), roomId, 'EX', 4 * 60 * 60);
  }
  
  // Cache in memory
  roomToShortId.set(roomId, shortId);
  
  return shortId;
}

async function getRoomIdFromShortId(shortId) {
  // Lookup in Redis
  return await redis.client.get(config.keys.shortIdReverse(shortId));
}

// ============= PUBSUB SETUP =============

async function subscribeToRoom(roomId, callback) {
  try {
    const pubsub = config.keys.pubsub(roomId);
    
    // Subscribe on the subscriber connection
    await redis.subscriber.subscribe(pubsub, (message) => {
      try {
        const data = JSON.parse(message);
        callback(data);
      } catch (err) {
        logger.error({ err, message }, 'Failed to parse pubsub message');
      }
    });
    
    logger.debug({ roomId }, 'Subscribed to room channel');
  } catch (err) {
    logger.error({ err, roomId }, 'Failed to subscribe to room');
  }
}

async function publishToRoom(roomId, message) {
  try {
    const pubsub = config.keys.pubsub(roomId);
    await redis.client.publish(pubsub, JSON.stringify(message));
  } catch (err) {
    logger.error({ err, roomId }, 'Failed to publish to room');
  }
}

// ============= HTTP SERVER =============

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Location');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.url === '/status') {
    // Collect room information
    (async () => {
      try {
        const rooms = [];
        for (const roomId of localRoomSubscribers.keys()) {
          const room = await RoomRepository.getById(roomId);
          const users = await UserRepository.getRoomUsers(roomId);
          if (room) {
            rooms.push({
              roomId,
              connectionCount: localRoomSubscribers.get(roomId).size,
              currentTime: room.currentTime,
              isPlaying: room.isPlaying,
              currentUrl: room.currentUrl,
              hostUserId: room.hostUserId,
              users: users.map(u => ({
                userId: u.id,
                username: u.username || null,
                currentTime: u.currentTime,
                isPlaying: u.isPlaying,
                connectionQuality: u.connectionQuality,
              })),
            });
          }
        }
        
        const status = {
          nodeId: config.nodeId,
          timestamp: new Date().toISOString(),
          localConnections: wsConnections.size,
          localRooms: localRoomSubscribers.size,
          rooms,
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
      } catch (err) {
        logger.error({ err }, 'Error generating status');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to generate status' }));
      }
    })();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', nodeId: config.nodeId }));
    return;
  }

  if (req.url === '/metrics') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const metrics = {
      nodeId: config.nodeId,
      localConnections: wsConnections.size,
      localRooms: localRoomSubscribers.size,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
    };
    res.end(JSON.stringify(metrics, null, 2));
    return;
  }

  // Handle short URL redirects: /room/shortId or /room/shortId/pin
  const roomMatch = req.url.match(/^\/room\/([a-z0-9]+)(?:\/([0-9]{6}))?$/i);
  if (roomMatch) {
    const shortId = roomMatch[1];
    const pin = roomMatch[2] || null;
    (async () => {
      try {
        const roomId = await getRoomIdFromShortId(shortId);
        if (!roomId) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Room not found');
          logger.warn({ shortId }, 'Short URL not found');
          return;
        }

        // Redirect to Netflix with roomId and PIN (if present) as query params
        const netflixUrl = `https://www.netflix.com/?tandemRoom=${encodeURIComponent(roomId)}${pin ? '&pin=' + pin : ''}`;
        res.writeHead(302, { Location: netflixUrl });
        res.end();

        logger.debug({ shortId, roomId, pin: pin ? '****' : 'none' }, 'Redirected short URL to Netflix');
      } catch (err) {
        logger.error({ err, shortId }, 'Error resolving short URL');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    })();
    return;
  }

  // Handle API to get or create short ID: /api/short-id/:roomId
  const shortIdMatch = req.url.match(/^\/api\/short-id\/(.+)$/);
  if (shortIdMatch) {
    const roomId = decodeURIComponent(shortIdMatch[1]);
    (async () => {
      try {
        const shortId = await getOrCreateShortId(roomId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ shortId, roomId, shortUrl: `https://watch.toper.dev/room/${shortId}` }));
        logger.debug({ roomId, shortId }, 'Created or retrieved short ID');
      } catch (err) {
        logger.error({ err, roomId }, 'Error creating short ID');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create short ID' }));
      }
    })();
    return;
  }

  // Handle API to lookup roomId from shortId: /api/room/:shortId
  const roomLookupMatch = req.url.match(/^\/api\/room\/([a-z0-9]+)$/i);
  if (roomLookupMatch) {
    const shortId = roomLookupMatch[1];
    (async () => {
      try {
        const roomId = await getRoomIdFromShortId(shortId);
        if (!roomId) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Room not found' }));
          logger.warn({ shortId }, 'Room lookup failed - short ID not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ roomId, shortId }));
        logger.debug({ shortId, roomId }, 'Room lookup successful');
      } catch (err) {
        logger.error({ err, shortId }, 'Error looking up room');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to lookup room' }));
      }
    })();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Signaling server running (${config.nodeId})\nEndpoints: /status, /health, /metrics, /room/:shortId, /api/short-id/:roomId, /api/room/:shortId`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

server.listen(config.port, config.host, () => {
  logger.info({ port: config.port, host: config.host, nodeId: config.nodeId }, 'Server listening');
});

// ============= WEBSOCKET HANDLERS =============

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  let userId = null;
  let roomId = null;
  let peerId = uuidv4();
  let hasLeft = false;

  logger.debug({ clientIp, peerId }, 'Client connected');

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      const type = data.type;

      // ===== JOIN =====
      if (type === 'JOIN') {
        roomId = data.roomId;
        userId = data.userId;
        const username = data.username || null;
        const pin = data.pin || null;

        if (!roomId || !userId) {
          ws.send(JSON.stringify({ type: 'ERROR', message: 'Missing roomId or userId' }));
          return;
        }

        // Create room if needed
        let room = await RoomRepository.getById(roomId);
        if (!room) {
          // New room - store PIN if provided
          if (pin) {
            await redis.client.set(config.keys.roomPin(roomId), pin, 'EX', 4 * 60 * 60); // 4 hour expiry
          }
          room = await RoomRepository.create(roomId, userId);
        } else {
          // Existing room - validate PIN if one was set
          const storedPin = await redis.client.get(config.keys.roomPin(roomId));
          if (storedPin) {
            if (!pin || pin !== storedPin) {
              ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid or missing PIN' }));
              logger.warn({ userId, roomId }, 'JOIN rejected - incorrect PIN');
              return;
            }
          }
        }

        // Create user
        await UserRepository.create(userId, roomId, username);

        // Store connection
        wsConnections.set(ws, { userId, roomId, peerId });

        // Subscribe to room on first connection
        if (!localRoomSubscribers.has(roomId)) {
          localRoomSubscribers.set(roomId, new Set());

          // Subscribe to Redis pubsub for this room
          await subscribeToRoom(roomId, (message) => {
            broadcastToRoom(roomId, message);
          });
        }

        localRoomSubscribers.get(roomId).add(ws);

        // Log event
        await EventRepository.log(roomId, 'USER_JOINED', userId, { peerId, username });

        // Send room state to joining user
        ws.send(JSON.stringify({
          type: 'ROOM_STATE',
          roomId,
          url: room.currentUrl,
          currentTime: room.currentTime,
          isPlaying: room.isPlaying,
          hostUserId: room.hostUserId,
          nodeId: config.nodeId,
        }));

        // Broadcast join to others in room
        broadcastToRoom(roomId, {
          type: 'USER_JOINED',
          userId,
          peerId,
          username,
          timestamp: Date.now(),
        }, ws);

        logger.debug({ userId, roomId, peerId, username }, 'User joined room');
      }

      // ===== USERNAME UPDATE =====
      else if (type === 'UPDATE_USERNAME') {
        if (!roomId || !userId) return;
        const username = data.username || null;
        await UserRepository.update(userId, { username });
        await EventRepository.log(roomId, 'USERNAME_UPDATED', userId, { username });
        broadcastToRoom(roomId, {
          type: 'USERNAME_UPDATED',
          userId,
          username,
          timestamp: Date.now(),
        });
      }

      // ===== HEARTBEAT (PING/PONG) =====
      else if (type === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        if (userId) {
          await UserRepository.update(userId, { lastHeartbeat: new Date() });
        }
      }

      // ===== PLAYBACK SYNC =====
      else if (type === 'PLAY_PAUSE') {
        if (!roomId) return;

        const control = data.control; // 'play' | 'pause'
        const isPlaying = control === 'play';
        const currentTime = Number.isFinite(data.currentTime) ? data.currentTime : null;

        const roomUpdates = { isPlaying };
        if (currentTime !== null) {
          roomUpdates.currentTime = currentTime;
        }

        await RoomRepository.update(roomId, roomUpdates);

        if (userId) {
          const userUpdates = { isPlaying };
          if (currentTime !== null) {
            userUpdates.currentTime = currentTime;
          }
          await UserRepository.update(userId, userUpdates);
        }

        await EventRepository.log(roomId, 'PLAY_PAUSE', userId, { control, currentTime });

        const payload = {
          type: 'PLAY_PAUSE',
          userId,
          control,
          timestamp: Date.now(),
        };
        if (currentTime !== null) {
          payload.currentTime = currentTime;
        }
        if (Number.isFinite(data.eventTimestamp)) {
          payload.eventTimestamp = data.eventTimestamp;
        }

        broadcastToRoom(roomId, payload);
      }

      else if (type === 'SEEK') {
        if (!roomId) return;

        const currentTime = data.currentTime || 0;
        const isPlaying = data.isPlaying || false;
        const eventTimestamp = Number.isFinite(data.eventTimestamp) ? data.eventTimestamp : null;

        await RoomRepository.update(roomId, { currentTime, isPlaying: false });
        if (userId) {
          await UserRepository.update(userId, { currentTime, isPlaying: false });
        }

        await EventRepository.log(roomId, 'SEEK', userId, { currentTime });

        startReadyGate(roomId, currentTime, isPlaying);

        broadcastToRoom(roomId, {
          type: 'SEEK_PAUSE',
          userId,
          currentTime,
          eventTimestamp,
          timestamp: Date.now(),
        });
      }

      else if (type === 'READY') {
        if (!roomId || !userId) return;
        const gate = roomReadyStates.get(roomId);
        if (!gate) return;

        gate.readyUserIds.add(userId);
        const expectedCount = gate.expectedUserIds.size || 1;
        const requiredCount = Math.max(1, Math.ceil(expectedCount * 0.6));

        if (gate.readyUserIds.size >= requiredCount) {
          if (gate.timeoutId) clearTimeout(gate.timeoutId);
          if (gate.desiredPlay) {
            await RoomRepository.update(roomId, { currentTime: gate.targetTime, isPlaying: true });
            broadcastToRoom(roomId, {
              type: 'PLAY_PAUSE',
              userId: 'server',
              control: 'play',
              currentTime: gate.targetTime,
              eventTimestamp: gate.createdAt,
              timestamp: Date.now(),
            });
          }
          roomReadyStates.delete(roomId);
        }
      }

      else if (type === 'HOST_HEARTBEAT') {
        if (!roomId || !userId) return;

        const currentTime = data.currentTime || 0;
        const isPlaying = data.isPlaying || false;

        await RoomRepository.update(roomId, { currentTime, isPlaying });
        await UserRepository.update(userId, { currentTime, isPlaying });

        broadcastToRoom(roomId, {
          type: 'HOST_HEARTBEAT',
          userId,
          currentTime,
          isPlaying,
          eventTimestamp: Number.isFinite(data.eventTimestamp) ? data.eventTimestamp : null,
          timestamp: Date.now(),
        });
      }

      else if (type === 'POSITION_UPDATE') {
        if (!roomId || !userId) return;

        const currentTime = data.currentTime || 0;
        const isPlaying = data.isPlaying || false;

        // Get room to verify this is an active party user
        const room = await RoomRepository.getById(roomId);
        if (!room) {
          console.log(`[POSITION_UPDATE] Room ${roomId} not found, ignoring update`);
          return;
        }

        // Get user's current URL to check if they're on a /watch page
        const user = await UserRepository.getById(userId);
        const userUrl = user?.currentUrl || '';
        
        // Only accept position updates from /watch pages, unless it's 0 (which means they're not actively watching)
        // This allows position updates from users actively on /watch pages, and ignores stale updates from browse pages
        if (!userUrl.includes('/watch') && currentTime > 0) {
          console.log(`[POSITION_UPDATE] Accepting update from ${userId} - has valid currentTime ${currentTime}`);
        } else if (!userUrl.includes('/watch') && currentTime === 0) {
          console.log(`[POSITION_UPDATE] Ignoring update from ${userId} - not on /watch page and currentTime is 0 (URL: ${userUrl})`);
          return;
        }

        console.log(`[POSITION_UPDATE] userId: ${userId}, roomId: ${roomId}, currentTime: ${currentTime}, isPlaying: ${isPlaying}`);

        // Update both the user and the room with current position
        await UserRepository.update(userId, { currentTime, isPlaying });
        await RoomRepository.update(roomId, { currentTime, isPlaying });
        console.log(`[POSITION_UPDATE] Updated room ${roomId} to currentTime: ${currentTime}`);
        // Don't broadcast position updates, just track them
      }

      // ===== URL CHANGES =====
      else if (type === 'URL_CHANGE') {
        if (!roomId) return;

        const url = data.url;
        const currentTime = data.currentTime;
        await RoomRepository.update(roomId, { currentUrl: url });
        await EventRepository.log(roomId, 'URL_CHANGE', userId, { url, currentTime });

        broadcastToRoom(roomId, {
          type: 'URL_CHANGE',
          userId,
          url,
          currentTime,
          timestamp: Date.now(),
        });
      }

      // ===== SYNC REQUESTS =====
      else if (type === 'REQUEST_SYNC') {
        if (!roomId) return;

        const room = await RoomRepository.getById(roomId);
        if (!room) {
          console.log(`[REQUEST_SYNC] Room not found: ${roomId}`);
          return;
        }
        ws.send(JSON.stringify({
          type: 'SYNC_RESPONSE',
          fromUserId: 'server',
          currentTime: room.currentTime,
          isPlaying: room.isPlaying,
          url: room.currentUrl,
          timestamp: Date.now(),
        }));
      }

      // ===== WEBRTC SIGNALING (pass-through) =====
      else if (['OFFER', 'ANSWER', 'ICE_CANDIDATE'].includes(type)) {
        if (!roomId || !data.to) return;

        // Send directly to target user
        const targetWs = Array.from(wsConnections.entries()).find(
          ([, info]) => info.userId === data.to && info.roomId === roomId
        )?.[0];

        if (targetWs && targetWs.readyState === 1) {
          targetWs.send(JSON.stringify({
            ...data,
            from: userId,
            nodeId: config.nodeId,
          }));
        } else {
          logger.warn({ from: userId, to: data.to, roomId }, 'Target user not found');
        }
      }

      // ===== LEAVE =====
      else if (type === 'LEAVE') {
        if (!roomId || !userId) return;

        hasLeft = true;
        logger.debug({ userId, roomId, peerId }, 'User left room');

        await UserRepository.delete(userId);

        const users = await UserRepository.getRoomUsers(roomId);
        if (users.length === 0) {
          await RoomRepository.delete(roomId);
          localRoomSubscribers.delete(roomId);
          logger.debug({ roomId }, 'Room cleaned up (empty after LEAVE)');
        }

        broadcastToRoom(roomId, {
          type: 'USER_LEFT',
          userId,
          peerId,
          timestamp: Date.now(),
        });

        await EventRepository.log(roomId, 'USER_LEFT', userId, { peerId });

        localRoomSubscribers.get(roomId)?.delete(ws);
        wsConnections.delete(ws);

        try { ws.close(1000, 'Client left'); } catch (e) {}
      }

      // ===== BROADCAST (fallback) =====
      else if (roomId) {
        broadcastToRoom(roomId, {
          ...data,
          userId,
          nodeId: config.nodeId,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      logger.error({ err, message: msg.toString() }, 'Error processing message');
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Processing error' }));
    }
  });

  ws.on('close', async () => {
    if (hasLeft) {
      localRoomSubscribers.get(roomId)?.delete(ws);
      wsConnections.delete(ws);
      return;
    }
    if (userId && roomId) {
      logger.debug({ userId, roomId, peerId }, 'User disconnected');

      // Update user state
      await UserRepository.delete(userId);

      // Check if room is empty
      const users = await UserRepository.getRoomUsers(roomId);
      if (users.length === 0) {
        await RoomRepository.delete(roomId);
        localRoomSubscribers.delete(roomId);
        logger.debug({ roomId }, 'Room cleaned up (empty)');
      }

      // Broadcast disconnect
      broadcastToRoom(roomId, {
        type: 'USER_LEFT',
        userId,
        peerId,
        timestamp: Date.now(),
      });

      await EventRepository.log(roomId, 'USER_LEFT', userId, { peerId });
    }

    // Remove from local registry
    localRoomSubscribers.get(roomId)?.delete(ws);
    wsConnections.delete(ws);
  });

  ws.on('error', (err) => {
    logger.error({ err, userId, roomId }, 'WebSocket error');
  });
});

// ============= BROADCAST HELPERS =============

function broadcastToRoom(roomId, message, excludeWs = null) {
  const clients = localRoomSubscribers.get(roomId);
  if (!clients) return;

  const msg = JSON.stringify(message);
  clients.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(msg);
    }
  });
}

// ============= PERIODIC CLEANUP =====

setInterval(async () => {
  try {
    const rooms = await RoomRepository.getActive();
    const now = Date.now();

    for (const room of rooms) {
      const users = await UserRepository.getRoomUsers(room.id);
      
      // Remove stale users (no heartbeat for 2x timeout)
      for (const user of users) {
        const staleness = now - new Date(user.lastHeartbeat).getTime();
        if (staleness > config.heartbeatTimeout * 2) {
          logger.debug({ userId: user.id, roomId: room.id }, 'Removing stale user');
          await UserRepository.delete(user.id);
        }
      }

      // Clean up empty rooms
      const updatedUsers = await UserRepository.getRoomUsers(room.id);
      if (updatedUsers.length === 0) {
        await RoomRepository.delete(room.id);
        localRoomSubscribers.delete(room.id);
        logger.debug({ roomId: room.id }, 'Cleaned up empty room');
      }
    }

    logger.debug(
      { activeRooms: rooms.length, nodeId: config.nodeId },
      'Periodic cleanup completed'
    );
  } catch (err) {
    logger.error({ err }, 'Periodic cleanup failed');
  }
}, config.roomCleanupInterval);

// ============= GRACEFUL SHUTDOWN =============

async function shutdown(signal) {
  logger.info({ signal }, 'Shutdown signal received');

  // Stop accepting new connections
  wss.close(() => {
    logger.info('WebSocket server closed');
  });

  // Close all existing connections
  wss.clients.forEach((ws) => {
    ws.close(1000, 'Server shutting down');
  });

  // Wait a bit then close HTTP server
  setTimeout(async () => {
    server.close(async () => {
      logger.info('HTTP server closed');
      await closeConnections();
      process.exit(0);
    });
  }, 5000);

  // Force exit after 15 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ============= INITIALIZATION =============

async function start() {
  try {
    logger.info({ nodeId: config.nodeId }, 'Starting signaling server');

    await initializeRedis();
    await initializeDatabase();

    logger.info('Server initialized successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize server');
    process.exit(1);
  }
}

start();

export default server;
