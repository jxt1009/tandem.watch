# Scalable Signaling Server Architecture

This document describes the refactored signaling server architecture designed for Kubernetes deployment and horizontal scaling.

## Architecture Overview

### Key Components

1. **Node.js Signaling Server** (Clustered)
   - Runs in 3+ replicas on Kubernetes
   - Stateless design (all state in Redis/PostgreSQL)
   - WebSocket connections with automatic reconnection
   - Graceful shutdown with 15-second timeout
   - Pod anti-affinity to spread across nodes

2. **Redis** (Distributed Cache)
   - Session state caching (fast access, TTL-based cleanup)
   - Pub/Sub for inter-server room broadcasts
   - Connection pooling, automatic retry
   - Persistent storage (RDB + AOF)

3. **PostgreSQL** (Persistent State)
   - Room state and user data
   - Event audit log (history of all changes)
   - Room archival instead of hard deletes
   - Connection pooling (20 connections)

## Deployment Patterns

### Local Development (Docker Compose)

```bash
cd signaling_server
docker-compose up
```

This starts:
- PostgreSQL on `localhost:5432`
- Redis on `localhost:6379`  
- Signaling Server on `localhost:4001`

### Kubernetes Deployment

#### 1. Create Namespace

```bash
kubectl apply -f k8s/namespace.yaml
```

#### 2. Deploy Redis

```bash
kubectl apply -f k8s/redis.yaml
```

Includes:
- StatefulSet with persistent storage
- ConfigMap for redis.conf
- Service for cluster networking

#### 3. Deploy PostgreSQL

```bash
kubectl apply -f k8s/postgres.yaml
```

Includes:
- StatefulSet with persistent volume
- Automatic initialization on first run
- Service for cluster networking

#### 4. Deploy Signaling Server

```bash
# First update ConfigMap with your settings
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

This creates:
- 3 replicas of signaling server (configurable)
- LoadBalancer service for external access
- ConfigMap and Secrets for configuration
- Pod anti-affinity for distribution

## Scaling Configuration

### Horizontal Scaling

Modify `k8s/deployment.yaml`:

```yaml
spec:
  replicas: 5  # Increase this value
```

Then:

```bash
kubectl apply -f k8s/deployment.yaml
```

Kubernetes automatically:
- Spins up new pods
- Distributes across nodes
- Routes traffic via LoadBalancer
- Each node independently subscribes to room channels

### Resource Scaling

Adjust in `k8s/deployment.yaml`:

```yaml
resources:
  requests:
    cpu: "200m"          # Increase if needed
    memory: "512Mi"      # Increase based on concurrent users
  limits:
    cpu: "1"
    memory: "1Gi"
```

## How Clustering Works

### State Management

1. **Room Data** (Redis)
   ```
   room:roomId -> { id, host_user_id, current_url, current_time, is_playing }
   ```

2. **User Data** (Redis + PostgreSQL)
   ```
   user:userId -> { room_id, current_time, is_playing, connection_quality, last_heartbeat }
   ```

3. **Room Users** (Redis)
   ```
   room:roomId:users -> Set of userIds
   ```

### Message Broadcasting

1. Client sends message to any server
2. Server updates state in Redis + PostgreSQL
3. Server publishes to Redis Pub/Sub channel
4. **All servers** subscribed to that room receive the message
5. Each server broadcasts to its local WebSocket clients

```
Client (Node 1) -> Server 1 -> Redis Pub/Sub -> Server 2 -> Client (Node 2)
                 -> Database
```

### Failover & Resilience

- **User disconnects**: Removed from Redis immediately, async from PostgreSQL
- **Server crashes**: Users automatically reconnect to any other server
- **Room becomes empty**: Cleaned up after 2 heartbeat timeouts
- **Stale data**: PostgreSQL acts as source of truth for recovery
- **Connection loss**: Clients implement exponential backoff reconnection

## Monitoring

### Health Checks

Built-in endpoints:

```bash
# Liveness probe (is server alive?)
GET /health
Response: { "status": "ok", "nodeId": "signaling-server-0" }

# Readiness probe (can serve traffic?)
GET /health
Response: 200 OK

# Metrics
GET /metrics
Response: { nodeId, localConnections, localRooms, memory, uptime }

# Full status
GET /status
Response: { nodeId, timestamp, localConnections, memory, uptime }
```

### Kubernetes Probes

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 4001
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 4001
  initialDelaySeconds: 10
  periodSeconds: 5
```

### Logging

Structured JSON logging with Pino:

```
{"level":"info","nodeId":"signaling-server-0","time":"2024-01-31T12:00:00Z","message":"Server listening"}
{"level":"debug","userId":"user-123","roomId":"room-456","message":"User joined room"}
```

Export to your logging system (Datadog, Splunk, etc.) using stdout redirection.

## Environment Variables

See [.env.example](../.env.example):

```
PORT=4001
HOST=0.0.0.0
REDIS_HOST=redis-cluster.tandem-watch.svc.cluster.local
POSTGRES_HOST=postgres.tandem-watch.svc.cluster.local
POSTGRES_DB=tandem_watch
```

## Load Testing

Test cluster with `k6`:

```javascript
import ws from 'k6/ws';
import { check } from 'k6';

export const options = {
  vus: 100,
  duration: '5m',
};

export default function () {
  const url = 'ws://signaling-server.tandem-watch/ws';
  const res = ws.connect(url, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'JOIN',
        roomId: `room-${__VU}`,
        userId: `user-${__VU}-${__ITER}`
      }));
    });
    socket.on('message', (msg) => {
      check(msg, { 'received message': msg => msg.length > 0 });
    });
  });
}
```

Run: `k6 run load-test.js`

## Troubleshooting

### Pods failing to start

```bash
kubectl logs -n tandem-watch deployment/signaling-server
```

Check if Redis/PostgreSQL are healthy:
```bash
kubectl get pods -n tandem-watch
```

### High memory usage

Increase Pod memory limit in `deployment.yaml` and check:
- Number of concurrent rooms
- Size of room state in Redis
- Event log growth in PostgreSQL

### Connection timeouts

Ensure LoadBalancer external IP is accessible:
```bash
kubectl get svc -n tandem-watch signaling-server
```

Check WebSocket endpoint: `ws://EXTERNAL-IP/ws`

### PostgreSQL persistence issues

Verify PVC is bound:
```bash
kubectl get pvc -n tandem-watch
```

## Performance Targets

With this architecture:

- **Concurrent users**: 1,000+ per cluster
- **Rooms per cluster**: 100+
- **Latency**: <100ms message round-trip
- **Throughput**: 10,000+ messages/second

Limit factors:
- Network bandwidth
- PostgreSQL write capacity
- Redis memory (use Redis Cluster for >10GB)
- Kubernetes node resources

## Next Steps for Production

1. **Enable TLS**: Use Ingress with cert-manager
2. **Add monitoring**: Prometheus + Grafana
3. **Enable Redis Cluster**: For HA and larger deployments
4. **Add PostgreSQL Replication**: For HA and read scaling
5. **Implement RBAC**: Kubernetes role-based access
6. **Add Network Policies**: Restrict inter-pod communication
7. **Configure HPA**: Auto-scale based on CPU/memory
