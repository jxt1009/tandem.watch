import { CONFIG } from '../config.js';

export class BackgroundService {
  constructor() {
    this.ws = null;
    this.localStream = null;
    this.isConnected = false;
    this.roomId = null;
    this.userId = this.generateUserId();
    this.username = null; // Store the display username
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = CONFIG.WS.MAX_RECONNECT_ATTEMPTS;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.missedHeartbeats = 0;
    this.reconnectDelayMs = CONFIG.WS.RECONNECT_DELAY_MS;
    this.wsUrl = CONFIG.WS.URL;
    this.statusMonitorInterval = null;
    this.lastKnownUserCount = 0;
  }

  generateUserId() {
    const array = new Uint32Array(2);
    crypto.getRandomValues(array);
    return 'user_' + array[0].toString(36) + array[1].toString(36).substring(0, 1);
  }

  async startParty(inputRoomId, inputUsername, inputPin) {
    this.roomId = inputRoomId || 'default_room_' + Date.now();
    this.username = inputUsername || null; // Store username if provided
    this.pin = inputPin || null; // Store PIN if provided
    this.intentionalDisconnect = false; // Reset flag so reconnection works
    return new Promise((resolve, reject) => {
      try {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          if (tabs.length === 0) {
            this.getMediaStreamInBackground()
              .then(() => this.connectToSignalingServer(resolve, reject))
              .catch(reject);
          } else {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_MEDIA_STREAM' }, (response) => {
              if (chrome.runtime.lastError) {
                console.warn('Content script not ready, trying background:', chrome.runtime.lastError);
                this.getMediaStreamInBackground()
                  .then(() => this.connectToSignalingServer(resolve, reject))
                  .catch(reject);
                return;
              }
              if (response && response.success) {
                this.connectToSignalingServer(resolve, reject);
              } else {
                this.getMediaStreamInBackground()
                  .then(() => this.connectToSignalingServer(resolve, reject))
                  .catch(reject);
              }
            });
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  async getMediaStreamInBackground() {
    console.log('Note: Media stream will be obtained from Netflix page');
    return;
  }

  connectToSignalingServer(resolve, reject) {
    try {
      console.log('[BackgroundService] Connecting to signaling server:', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        console.log('[BackgroundService] Connected to signaling server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.missedHeartbeats = 0;
        this.ws.send(JSON.stringify({ type: 'JOIN', userId: this.userId, roomId: this.roomId, username: this.username || null, pin: this.pin || null, timestamp: Date.now() }));
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STARTED', userId: this.userId, roomId: this.roomId }).catch(() => {});
            chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_INITIAL_SYNC_AND_PLAY' }).catch(() => {});
            // Start with "waiting" status - will update when others join
            chrome.tabs.sendMessage(tab.id, { type: 'CONNECTION_STATUS', status: 'waiting' }).catch(() => {});
          });
        });
        this.startHeartbeat();
        this.startStatusMonitor();
        resolve();
      };
      this.ws.onmessage = (event) => this.handleSignalingMessage(event.data);
      this.ws.onerror = (error) => {
        console.warn('[BackgroundService] WebSocket error:', error);
        if (this.reconnectAttempts === 0) {
          reject(new Error('Failed to connect to signaling server'));
        }
      };
      this.ws.onclose = () => {
        console.log('[BackgroundService] WebSocket closed');
        this.isConnected = false;
        // Notify content scripts of disconnection
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'CONNECTION_STATUS', status: 'disconnected' }).catch(() => {});
          });
        });
        if (!this.intentionalDisconnect && this.roomId) {
          this.attemptReconnection();
        } else {
          this.cleanup();
        }
      };
    } catch (err) {
      reject(err);
    }
  }

  stopParty(sendLeaveSignal = true) {
    this.intentionalDisconnect = true;
    this.stopHeartbeat();
    this.stopStatusMonitor();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      if (sendLeaveSignal) {
        try {
          this.ws.send(JSON.stringify({ type: 'LEAVE', userId: this.userId, roomId: this.roomId, timestamp: Date.now() }));
        } catch (e) {}
      }
      this.ws.close();
      this.ws = null;
    }
    this.cleanup();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    
    // Only fully tear down if this is a real stop (not a reconnection)
    if (sendLeaveSignal) {
      this.roomId = null;
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'PARTY_STOPPED' }).catch(() => {});
        });
      });
    }
  }

  cleanup() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
      this.localStream = null;
    }
  }

  async handleSignalingMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('[BackgroundService] Received signaling message:', message.type);
      
      // Handle PONG response to reset heartbeat
      if (message.type === 'PONG') {
        if (this.heartbeatTimeout) {
          clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = null;
        }
        this.missedHeartbeats = 0;
        console.log('[BackgroundService] Heartbeat acknowledged');
        return;
      }
      
      chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'SIGNAL', message }).catch(() => {});
        });
      });
      if (message.type === 'ROOM_STATE') {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'ROOM_STATE', hostUserId: message.hostUserId }).catch(() => {});
          });
        });
      }
      if (message.type === 'PLAY_PAUSE' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding PLAY_PAUSE to content:', message.control, 'at', message.currentTime, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_PLAYBACK_CONTROL', control: message.control, currentTime: message.currentTime, eventTimestamp: message.eventTimestamp, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'SYNC_PLAYBACK' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SYNC_PLAYBACK', currentTime: message.currentTime, isPlaying: message.isPlaying, timestamp: message.timestamp, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'SEEK' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding SEEK to content:', message.currentTime, 'playing:', message.isPlaying, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SEEK', currentTime: message.currentTime, isPlaying: message.isPlaying, eventTimestamp: message.eventTimestamp, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'SEEK_PAUSE' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding SEEK_PAUSE to content:', message.currentTime, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SEEK_PAUSE', currentTime: message.currentTime, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'HOST_HEARTBEAT' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'HOST_HEARTBEAT', currentTime: message.currentTime, isPlaying: message.isPlaying, eventTimestamp: message.eventTimestamp, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'URL_CHANGE' && message.userId !== this.userId) {
        console.log('[BackgroundService] Forwarding URL_CHANGE to content:', message.url, 'time:', message.currentTime, 'from', message.userId);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_URL_CHANGE', url: message.url, currentTime: message.currentTime, fromUserId: message.userId }).catch(() => {});
          });
        });
      }
      if (message.type === 'REQUEST_SYNC' && message.userId !== this.userId) {
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'HANDLE_REQUEST_SYNC', fromUserId: message.userId, respectAutoPlay: message.respectAutoPlay || false }).catch(() => {});
          });
        });
      }
      if (message.type === 'SYNC_RESPONSE' && (!message.to || message.to === this.userId)) {
        console.log('[BackgroundService] Received SYNC_RESPONSE for me, forwarding to content with URL:', message.url);
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'APPLY_SYNC_RESPONSE', currentTime: message.currentTime, isPlaying: message.isPlaying, fromUserId: message.fromUserId || message.from || 'server', url: message.url, respectAutoPlay: message.respectAutoPlay || false }).catch(() => {});
          });
        });
      }
    } catch (err) {
      console.error('Error handling signaling message:', err);
    }
  }

  attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[BackgroundService] Max reconnection attempts reached. Party disconnected.');
      this.stopParty(false);
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
    console.log(`[BackgroundService] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);
    
    // Notify content scripts that we're reconnecting
    chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'CONNECTION_STATUS', status: 'reconnecting' }).catch(() => {});
      });
    });
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnect();
    }, delay);
  }

  reconnect() {
    console.log('[BackgroundService] Reconnecting to signaling server:', this.wsUrl);
    this.intentionalDisconnect = false;
    try {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => {
        console.log('[BackgroundService] Reconnected successfully');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.missedHeartbeats = 0;
        this.ws.send(JSON.stringify({ 
          type: 'JOIN', 
          userId: this.userId, 
          roomId: this.roomId,
          username: this.username || null,
          pin: this.pin || null,
          timestamp: Date.now() 
        }));
        this.startHeartbeat();
        console.log('[BackgroundService] Rejoined room after reconnection');
        
        // Notify content scripts about reconnection and request sync
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { 
              type: 'RECONNECTED', 
              userId: this.userId, 
              roomId: this.roomId 
            }).catch(() => {});
            
            chrome.tabs.sendMessage(tab.id, { 
              type: 'CONNECTION_STATUS', 
              status: 'connected' 
            }).catch(() => {});
            
            // Request sync after reconnection if on /watch page
            chrome.tabs.sendMessage(tab.id, { 
              type: 'REQUEST_SYNC_AFTER_RECONNECT' 
            }).catch(() => {});
          });
        });
      };
      this.ws.onmessage = (event) => this.handleSignalingMessage(event.data);
      this.ws.onerror = (error) => {
        console.warn('[BackgroundService] Reconnection WebSocket error:', error);
      };
      this.ws.onclose = () => {
        console.log('[BackgroundService] Reconnected WebSocket closed');
        this.isConnected = false;
        // Notify content scripts of disconnection
        chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: 'CONNECTION_STATUS', status: 'disconnected' }).catch(() => {});
          });
        });
        if (!this.intentionalDisconnect && this.roomId) {
          this.attemptReconnection();
        }
      };
    } catch (err) {
      console.error('[BackgroundService] Reconnection failed:', err);
      this.attemptReconnection();
    }
  }

  broadcastMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[BackgroundService] Broadcasting message:', message.type, message);
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[BackgroundService] Cannot broadcast - WebSocket not open:', this.ws ? this.ws.readyState : 'no ws');
    }
  }

  updateUsername(username) {
    this.username = username || this.username;
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.roomId) {
      this.ws.send(JSON.stringify({
        type: 'UPDATE_USERNAME',
        userId: this.userId,
        roomId: this.roomId,
        username: this.username,
        timestamp: Date.now(),
      }));
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    console.log('[BackgroundService] Starting heartbeat monitoring');
    
    // Send ping every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'PING', userId: this.userId, timestamp: Date.now() }));
          
          // Set timeout to detect if we don't get a response
          this.heartbeatTimeout = setTimeout(() => {
            this.missedHeartbeats++;
            console.warn('[BackgroundService] Missed heartbeat response. Count:', this.missedHeartbeats);
            
            // If we miss 3 heartbeats (45 seconds), assume connection is dead
            if (this.missedHeartbeats >= 3) {
              console.error('[BackgroundService] Connection appears dead, forcing reconnection');
              this.stopHeartbeat();
              if (this.ws) {
                this.ws.close();
              }
            }
          }, 10000); // 10 second timeout for response
        } catch (e) {
          console.error('[BackgroundService] Error sending ping:', e);
        }
      } else {
        console.warn('[BackgroundService] WebSocket not open, stopping heartbeat');
        this.stopHeartbeat();
      }
    }, 15000); // Every 15 seconds
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
    this.missedHeartbeats = 0;
  }

  startStatusMonitor() {
    if (this.statusMonitorInterval) {
      clearInterval(this.statusMonitorInterval);
    }
    
    this.statusMonitorInterval = setInterval(async () => {
      if (!this.isConnected || !this.roomId) return;
      
      try {
        const httpUrl = this.wsUrl.replace(/^wss?:\/\//, 'http://').replace(/\/ws$/, '');
        const response = await fetch(`${httpUrl}/status`);
        if (!response.ok) return;
        
        const serverStatus = await response.json();
        const room = serverStatus.rooms?.find(r => r.roomId === this.roomId);
        if (!room) return;
        
        const userCount = room.users?.length || 0;
        
        // Update status if user count changed
        if (userCount !== this.lastKnownUserCount) {
          this.lastKnownUserCount = userCount;
          const newStatus = userCount > 1 ? 'connected' : 'waiting';
          
          chrome.tabs.query({ url: 'https://www.netflix.com/*' }, (tabs) => {
            tabs.forEach(tab => {
              chrome.tabs.sendMessage(tab.id, { type: 'CONNECTION_STATUS', status: newStatus }).catch(() => {});
            });
          });
        }
      } catch (error) {
        console.error('[BackgroundService] Error monitoring status:', error);
      }
    }, 2000);
  }

  stopStatusMonitor() {
    if (this.statusMonitorInterval) {
      clearInterval(this.statusMonitorInterval);
      this.statusMonitorInterval = null;
    }
    this.lastKnownUserCount = 0;
  }

  getStatus() {
    return { isConnected: this.isConnected, roomId: this.roomId, userId: this.userId, hasLocalStream: !!this.localStream, pin: this.pin };
  }
}
