/**
 * Configuration for tandem.watch extension
 * 
 * Update these values based on your deployment:
 * - Local development: ws://localhost:4001
 * - K8s deployment: ws://10.0.0.102:30401
 * - Production: wss://watch.toper.dev (HTTPS)
 */

export const CONFIG = {
  // WebSocket server configuration
  WS: {
    // Production server (HTTPS)
    URL: 'wss://watch.toper.dev/ws',
    
    // Kubernetes deployment (HTTP via NodePort) - for local network testing
    // URL: 'ws://10.0.0.102:30401/ws',
    
    // Local development (HTTP)
    // URL: 'ws://localhost:4001/ws',
    
    // Reconnection settings
    MAX_RECONNECT_ATTEMPTS: 10,
    RECONNECT_DELAY_MS: 3000,
  },

  // Feature flags
  FEATURES: {
    DEBUG_LOGGING: true,
    AUTO_SYNC: true,
    P2P_FALLBACK: true,
  },

  // Logging
  LOG_LEVEL: 'info', // 'debug', 'info', 'warn', 'error'
};

// Fallback for legacy support
export const SIGNALING_SERVER_URL = CONFIG.WS.URL;
