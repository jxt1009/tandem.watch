import { createClient } from 'redis';
import pkg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import config from './config.js';
import logger from './logger.js';

const { Pool } = pkg;

// PostgreSQL connection pool
export const pgPool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
  max: config.postgres.max,
});

pgPool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

// Redis clients
export const redis = {
  client: null,
  subscriber: null,
};

export async function initializeRedis() {
  const redisConfig = {
    socket: {
      host: config.redis.host,
      port: config.redis.port,
    },
    db: config.redis.db,
  };

  if (config.redis.password) {
    redisConfig.password = config.redis.password;
  }

  redis.client = createClient(redisConfig);
  redis.subscriber = createClient(redisConfig);

  redis.client.on('error', (err) => {
    logger.error({ err }, 'Redis client error');
  });

  redis.subscriber.on('error', (err) => {
    logger.error({ err }, 'Redis subscriber error');
  });

  await redis.client.connect();
  await redis.subscriber.connect();
  logger.info('Redis connected');
}

// Initialize PostgreSQL schema
export async function initializeDatabase() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(50) PRIMARY KEY,
        host_user_id VARCHAR(100),
        current_url TEXT,
        current_time FLOAT,
        is_playing BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(100) PRIMARY KEY,
        room_id VARCHAR(50),
        current_time FLOAT,
        is_playing BOOLEAN,
        connection_quality VARCHAR(20),
        last_heartbeat TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS room_events (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(50),
        event_type VARCHAR(50),
        user_id VARCHAR(100),
        data JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_users_room_id ON users(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_events_room_id ON room_events(room_id);
      CREATE INDEX IF NOT EXISTS idx_room_events_created_at ON room_events(created_at);
    `);
    logger.info('Database schema initialized');
  } catch (err) {
    logger.error({ err }, 'Failed to initialize database');
    throw err;
  }
}

// ============= ROOM REPOSITORY =============

export const RoomRepository = {
  async create(roomId, hostUserId) {
    try {
      // Save to PostgreSQL
      await pgPool.query(
        `INSERT INTO rooms (id, host_user_id, is_playing, current_time)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET host_user_id = $2`,
        [roomId, hostUserId, false, 0]
      );

      // Store in Redis for quick access
      await redis.client.hSet(config.keys.room(roomId), {
        id: roomId,
        host_user_id: hostUserId,
        current_url: '',
        current_time: '0',
        is_playing: 'false',
        updated_at: new Date().toISOString(),
      });

      await redis.client.sAdd(config.keys.activeRooms, roomId);

      logger.debug({ roomId, hostUserId }, 'Room created');
      return { id: roomId, hostUserId, currentUrl: '', currentTime: 0, isPlaying: false };
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to create room');
      throw err;
    }
  },

  async getById(roomId) {
    try {
      // Try Redis first
      const cached = await redis.client.hGetAll(config.keys.room(roomId));
      if (cached && Object.keys(cached).length > 0) {
        return {
          id: cached.id,
          hostUserId: cached.host_user_id,
          currentUrl: cached.current_url,
          currentTime: parseFloat(cached.current_time),
          isPlaying: cached.is_playing === 'true',
          updatedAt: cached.updated_at,
        };
      }

      // Fall back to PostgreSQL
      const result = await pgPool.query(
        'SELECT * FROM rooms WHERE id = $1 AND archived_at IS NULL',
        [roomId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const room = result.rows[0];
      
      // Restore to Redis
      await redis.client.hSet(config.keys.room(roomId), {
        id: room.id,
        host_user_id: room.host_user_id,
        current_url: room.current_url || '',
        current_time: String(room.current_time),
        is_playing: String(room.is_playing),
        updated_at: room.updated_at.toISOString(),
      });

      return {
        id: room.id,
        hostUserId: room.host_user_id,
        currentUrl: room.current_url,
        currentTime: room.current_time,
        isPlaying: room.is_playing,
      };
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to get room');
      throw err;
    }
  },

  async update(roomId, updates) {
    try {
      const fields = [];
      const values = [];
      let paramCount = 1;

      if (updates.currentUrl !== undefined) {
        fields.push(`current_url = $${paramCount++}`);
        values.push(updates.currentUrl);
      }
      if (updates.currentTime !== undefined) {
        fields.push(`current_time = $${paramCount++}`);
        values.push(updates.currentTime);
      }
      if (updates.isPlaying !== undefined) {
        fields.push(`is_playing = $${paramCount++}`);
        values.push(updates.isPlaying);
      }
      if (updates.hostUserId !== undefined) {
        fields.push(`host_user_id = $${paramCount++}`);
        values.push(updates.hostUserId);
      }

      if (fields.length === 0) return;

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(roomId);

      // Update PostgreSQL
      await pgPool.query(
        `UPDATE rooms SET ${fields.join(', ')} WHERE id = $${paramCount}`,
        values
      );

      // Update Redis
      const redisUpdate = {};
      if (updates.currentUrl !== undefined) redisUpdate.current_url = updates.currentUrl;
      if (updates.currentTime !== undefined) redisUpdate.current_time = String(updates.currentTime);
      if (updates.isPlaying !== undefined) redisUpdate.is_playing = String(updates.isPlaying);
      if (updates.hostUserId !== undefined) redisUpdate.host_user_id = updates.hostUserId;
      redisUpdate.updated_at = new Date().toISOString();

      await redis.client.hSet(config.keys.room(roomId), redisUpdate);

      logger.debug({ roomId, updates }, 'Room updated');
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to update room');
      throw err;
    }
  },

  async delete(roomId) {
    try {
      // Archive in PostgreSQL instead of hard delete
      await pgPool.query(
        'UPDATE rooms SET archived_at = CURRENT_TIMESTAMP WHERE id = $1',
        [roomId]
      );

      // Remove from Redis
      await redis.client.del(config.keys.room(roomId));
      await redis.client.sRem(config.keys.activeRooms, roomId);

      logger.debug({ roomId }, 'Room deleted');
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to delete room');
      throw err;
    }
  },

  async getActive() {
    try {
      const roomIds = await redis.client.sMembers(config.keys.activeRooms);
      return Promise.all(roomIds.map(id => this.getById(id)));
    } catch (err) {
      logger.error({ err }, 'Failed to get active rooms');
      throw err;
    }
  }
};

// ============= USER REPOSITORY =============

export const UserRepository = {
  async create(userId, roomId) {
    try {
      // PostgreSQL
      await pgPool.query(
        `INSERT INTO users (id, room_id, current_time, is_playing, last_heartbeat)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET room_id = $2, last_heartbeat = CURRENT_TIMESTAMP`,
        [userId, roomId, 0, false]
      );

      // Redis
      await redis.client.hSet(config.keys.user(userId), {
        id: userId,
        room_id: roomId,
        current_time: '0',
        is_playing: 'false',
        connection_quality: 'good',
        last_heartbeat: new Date().toISOString(),
      });

      await redis.client.sAdd(config.keys.activeUsers, userId);
      await redis.client.sAdd(config.keys.roomUsers(roomId), userId);

      logger.debug({ userId, roomId }, 'User created');
    } catch (err) {
      logger.error({ err, userId, roomId }, 'Failed to create user');
      throw err;
    }
  },

  async getById(userId) {
    try {
      const cached = await redis.client.hGetAll(config.keys.user(userId));
      if (cached && Object.keys(cached).length > 0) {
        return {
          id: cached.id,
          roomId: cached.room_id,
          currentTime: parseFloat(cached.current_time),
          isPlaying: cached.is_playing === 'true',
          connectionQuality: cached.connection_quality,
          lastHeartbeat: new Date(cached.last_heartbeat),
        };
      }
      return null;
    } catch (err) {
      logger.error({ err, userId }, 'Failed to get user');
      throw err;
    }
  },

  async update(userId, updates) {
    try {
      const redisUpdate = {};
      if (updates.currentTime !== undefined) redisUpdate.current_time = String(updates.currentTime);
      if (updates.isPlaying !== undefined) redisUpdate.is_playing = String(updates.isPlaying);
      if (updates.connectionQuality !== undefined) redisUpdate.connection_quality = updates.connectionQuality;
      if (updates.lastHeartbeat !== undefined) {
        redisUpdate.last_heartbeat = updates.lastHeartbeat.toISOString();
      } else {
        redisUpdate.last_heartbeat = new Date().toISOString();
      }

      await redis.client.hSet(config.keys.user(userId), redisUpdate);

      // Async update to PostgreSQL (non-blocking)
      pgPool.query(
        `UPDATE users SET current_time = $1, is_playing = $2, last_heartbeat = $3 WHERE id = $4`,
        [updates.currentTime || 0, updates.isPlaying || false, new Date(), userId]
      ).catch(err => logger.error({ err, userId }, 'Failed to update user in PostgreSQL'));
    } catch (err) {
      logger.error({ err, userId }, 'Failed to update user');
      throw err;
    }
  },

  async delete(userId) {
    try {
      const user = await this.getById(userId);
      const roomId = user?.roomId;

      await redis.client.del(config.keys.user(userId));
      await redis.client.sRem(config.keys.activeUsers, userId);
      if (roomId) {
        await redis.client.sRem(config.keys.roomUsers(roomId), userId);
      }

      // Async delete from PostgreSQL
      pgPool.query('DELETE FROM users WHERE id = $1', [userId])
        .catch(err => logger.error({ err, userId }, 'Failed to delete user from PostgreSQL'));

      logger.debug({ userId }, 'User deleted');
    } catch (err) {
      logger.error({ err, userId }, 'Failed to delete user');
      throw err;
    }
  },

  async getRoomUsers(roomId) {
    try {
      const userIds = await redis.client.sMembers(config.keys.roomUsers(roomId));
      const users = await Promise.all(userIds.map(id => this.getById(id)));
      return users.filter(u => u !== null);
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to get room users');
      throw err;
    }
  }
};

// ============= EVENT REPOSITORY =============

export const EventRepository = {
  async log(roomId, eventType, userId, data) {
    try {
      await pgPool.query(
        `INSERT INTO room_events (room_id, event_type, user_id, data)
         VALUES ($1, $2, $3, $4)`,
        [roomId, eventType, userId, JSON.stringify(data)]
      );
    } catch (err) {
      logger.error({ err, roomId, eventType }, 'Failed to log event');
    }
  },

  async getRoomHistory(roomId, limit = 100) {
    try {
      const result = await pgPool.query(
        `SELECT * FROM room_events WHERE room_id = $1 
         ORDER BY created_at DESC LIMIT $2`,
        [roomId, limit]
      );
      return result.rows;
    } catch (err) {
      logger.error({ err, roomId }, 'Failed to get room history');
      return [];
    }
  }
};

// ============= CLEANUP =============

export async function closeConnections() {
  try {
    if (redis.client) await redis.client.quit();
    if (redis.subscriber) await redis.subscriber.quit();
    await pgPool.end();
    logger.info('Database connections closed');
  } catch (err) {
    logger.error({ err }, 'Error closing connections');
  }
}
