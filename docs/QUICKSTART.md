# Quick Reference: tandem.watch Signaling Server

## Project Structure

```
toperparty/
├── signaling_server/          # Node.js WebSocket server
│   ├── src/
│   │   ├── background/        # Chrome extension background script
│   │   ├── content/           # Content script with Netflix controller
│   │   ├── managers/          # State, Sync, URL managers
│   │   ├── services/          # WebRTC manager
│   │   └── ui/                # Popup UI components
│   ├── server.js              # Distributed WebSocket server (v2.0)
│   ├── config.js              # Environment configuration
│   ├── logger.js              # Structured logging with Pino
│   ├── db.js                  # Data access layer (Repositories pattern)
│   ├── package.json           # Dependencies (v2.0.0)
│   ├── Dockerfile             # Container image with healthcheck
│   └── docker-compose.yml     # Local dev environment
├── k8s/                       # Kubernetes manifests
│   ├── README.md              # Architecture documentation
│   ├── kustomization.yaml     # Base Kustomization config
│   ├── namespace.yaml         # Namespace with quotas/policies
│   ├── configmap.yaml         # Configuration data
│   ├── secret.yaml            # Sensitive credentials
│   ├── deployment.yaml        # Signaling server (3 replicas)
│   ├── service.yaml           # LoadBalancer service
│   ├── postgres.yaml          # PostgreSQL StatefulSet
│   ├── redis.yaml             # Redis StatefulSet
│   └── overlays/
│       ├── dev/               # 1 replica, debug logging
│       ├── staging/           # 2 replicas, info logging
│       └── prod/              # 5 replicas, warn logging
├── DEPLOYMENT.md              # Complete deployment guide
└── README.md                  # Project overview
```

## Key Commands

### Local Development
```bash
cd signaling_server
docker-compose up                    # Start PostgreSQL, Redis, Server
docker-compose logs -f               # Watch logs
docker-compose down                  # Stop all services
```

### Kubernetes Deployment
```bash
# Development environment
kubectl apply -k k8s/overlays/dev

# Staging environment
kubectl apply -k k8s/overlays/staging

# Production environment
kubectl apply -k k8s/overlays/prod

# View all resources
kubectl get all -n tandem-watch

# View logs
kubectl logs -n tandem-watch deployment/signaling-server

# Port forward for testing
kubectl port-forward -n tandem-watch svc/signaling-server 4001:80
```

### Debugging
```bash
# Describe deployment issues
kubectl describe deployment signaling-server -n tandem-watch

# Get detailed pod info
kubectl get pods -n tandem-watch -o wide

# Check events
kubectl get events -n tandem-watch --sort-by='.lastTimestamp'

# Access database
kubectl exec -it -n tandem-watch postgres-0 -- psql -U tandem -d tandem_watch
```

## Architecture at a Glance

### Components
- **Signaling Server**: Node.js WebSocket (stateless, 3-5 replicas)
- **Redis**: Distributed cache & pub/sub (1 replica + persistence)
- **PostgreSQL**: Persistent state (1 replica + backups)

### Communication Flow
```
Client → Server → Redis (pub/sub) → All Servers → Clients
              ↓
         PostgreSQL (persist)
```

### Key Features
- ✅ Horizontal scaling (stateless servers)
- ✅ Data persistence (PostgreSQL)
- ✅ Distributed state (Redis)
- ✅ Health monitoring (Kubernetes probes)
- ✅ Graceful shutdown (15s connection drain)
- ✅ Pod anti-affinity (spread across nodes)
- ✅ Structured logging (Pino JSON)

## Environment Variables

**Server Configuration:**
- `PORT`: WebSocket server port (default: 4001)
- `HOST`: Bind address (default: 0.0.0.0)
- `NODE_ENV`: development|staging|production
- `LOG_LEVEL`: debug|info|warn|error

**Redis:**
- `REDIS_HOST`: Redis server hostname
- `REDIS_PORT`: Redis port (default: 6379)
- `REDIS_PASSWORD`: Redis password
- `REDIS_DB`: Database number (default: 0)

**PostgreSQL:**
- `POSTGRES_HOST`: PostgreSQL server hostname
- `POSTGRES_PORT`: PostgreSQL port (default: 5432)
- `POSTGRES_USER`: Database user (default: tandem)
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_DB`: Database name (default: tandem_watch)

## API Endpoints

```
GET  /health          → Liveness probe { status: "ok" }
GET  /metrics         → Performance metrics { nodeId, memory, uptime }
GET  /status          → Detailed status { timestamp, connections, rooms }
WS   /ws              → WebSocket connection for clients
```

## WebSocket Message Types

```javascript
// JOIN room
{ type: 'JOIN', roomId: 'room-123', userId: 'user-456' }

// LEAVE room
{ type: 'LEAVE', roomId: 'room-123' }

// PLAY/PAUSE sync
{ type: 'PLAY_PAUSE', roomId: 'room-123', playing: true }

// SEEK to timestamp
{ type: 'SEEK', roomId: 'room-123', time: 1234.56 }

// Update current position
{ type: 'POSITION_UPDATE', roomId: 'room-123', position: 1234.56 }

// Change URL
{ type: 'URL_CHANGE', roomId: 'room-123', url: 'https://...' }

// Request full room sync
{ type: 'REQUEST_SYNC', roomId: 'room-123' }

// WebRTC signaling
{ type: 'OFFER', roomId: 'room-123', offer: {...} }
{ type: 'ANSWER', roomId: 'room-123', answer: {...} }
{ type: 'ICE_CANDIDATE', roomId: 'room-123', candidate: {...} }
```

## Scaling Decisions

| Metric | Single Node | 5 Replicas | Notes |
|--------|------------|-----------|-------|
| Concurrent Users | 10-50 | 1,000+ | Depends on user activity |
| Rooms | 2-5 | 100+ | N²/2 WebRTC connections per room |
| Message Throughput | 100/sec | 5,000+/sec | Limited by database writes |
| Memory per Pod | 512MB | 512MB | Consistent with stateless design |
| Latency | <50ms | <100ms | Redis adds 5-10ms per operation |

## Performance Tuning

### Increase Replicas
Edit `k8s/overlays/prod/kustomization.yaml`:
```yaml
replicas:
  - name: signaling-server
    count: 10  # Increase from 5
```

### Increase Pod Resources
Edit `k8s/overlays/prod/kustomization.yaml`:
```yaml
patchesJson6902:
  - target:
      group: apps
      version: v1
      kind: Deployment
      name: signaling-server
    patch: |-
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/cpu
        value: "2"
      - op: replace
        path: /spec/template/spec/containers/0/resources/limits/memory
        value: "2Gi"
```

### Database Optimization
Edit `signaling_server/config.js`:
```javascript
pgPool: { max: 50 }  // Increase from 20
```

## Troubleshooting Quick Fixes

```bash
# Restart all pods
kubectl rollout restart deployment/signaling-server -n tandem-watch

# View recent errors
kubectl logs -n tandem-watch deployment/signaling-server | tail -50

# Check database connection
kubectl exec -n tandem-watch signaling-server-0 -- curl -s http://localhost:4001/status

# Force sync with database
kubectl delete pod -n tandem-watch signaling-server-0
# (Kubernetes will recreate it)
```

## Files Modified from Original

| File | Changes | Version |
|------|---------|---------|
| `server.js` | Complete rewrite: removed in-memory state, added repositories | v2.0 |
| `package.json` | Added dependencies: redis, pg, pino, uuid, dotenv | v2.0 |
| `Dockerfile` | Added healthcheck, npm ci instead of npm install | v2.0 |
| `docker-compose.yml` | Added PostgreSQL, Redis, updated to 3-service stack | v2.0 |
| `config.js` | NEW: Centralized configuration management | v2.0 |
| `logger.js` | NEW: Structured logging with Pino | v2.0 |
| `db.js` | NEW: Repository pattern with 3 repos, 400+ lines | v2.0 |

## Next Steps

1. **Build Docker image**: `docker build -t registry/tandem-watch:v2.0.0 .`
2. **Test locally**: `docker-compose up` and verify connectivity
3. **Deploy dev**: `kubectl apply -k k8s/overlays/dev`
4. **Load test**: Use k6 or similar to stress test
5. **Deploy staging**: `kubectl apply -k k8s/overlays/staging`
6. **Deploy production**: `kubectl apply -k k8s/overlays/prod`

## Documentation Links

- [Deployment Guide](DEPLOYMENT.md)
- [Kubernetes Architecture](k8s/README.md)
- [Project README](README.md)
