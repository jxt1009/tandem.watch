import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || '4001'),
  host: process.env.HOST || '0.0.0.0',
  nodeId: process.env.NODE_ID || `node-${process.pid}-${Date.now()}`,
  environment: process.env.NODE_ENV || 'production',
  
  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    retryStrategy: (times) => Math.min(times * 50, 2000),
    reconnectOnError: (err) => err.code !== 'READONLY',
  },
  
  // PostgreSQL
  postgres: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'tandem_watch',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    max: parseInt(process.env.POSTGRES_POOL_SIZE || '20'),
  },
  
  // Connection timeouts
  heartbeatInterval: 30000,      // Send heartbeat every 30s
  heartbeatTimeout: 60000,        // Disconnect if no response for 60s
  connectionTimeout: 10000,       // WebSocket handshake timeout
  
  // Room cleanup
  roomCleanupInterval: 60000,     // Check for empty rooms every 60s
  roomTTL: 14400000,              // 4 hours before room is archived
  
  // Redis key prefixes
  keys: {
    room: (roomId) => `room:${roomId}`,
    user: (userId) => `user:${userId}`,
    roomUsers: (roomId) => `room:${roomId}:users`,
    activeRooms: 'active:rooms',
    activeUsers: 'active:users',
    pubsub: (roomId) => `room:${roomId}:pubsub`,
    shortId: (roomId) => `shortid:${roomId}`,
    shortIdReverse: (shortId) => `shortid:rev:${shortId}`,
    roomPin: (roomId) => `room:${roomId}:pin`,
  },
};

export default config;
