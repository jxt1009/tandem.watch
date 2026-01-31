# Deployment Guide for tandem.watch

This guide covers deploying the scalable signaling server to Kubernetes and running locally.

## Local Development

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development without Docker)

### Quick Start

```bash
cd signaling_server
docker-compose up -d
```

This starts all three services:
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Signaling Server: `localhost:4001`

Verify services are running:

```bash
docker-compose ps
docker logs signaling-server
```

Access WebSocket server:
```javascript
const socket = new WebSocket('ws://localhost:4001/ws');
socket.onopen = () => {
  socket.send(JSON.stringify({
    type: 'JOIN',
    roomId: 'test-room',
    userId: 'test-user'
  }));
};
```

Stop all services:
```bash
docker-compose down
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (1.20+)
- kubectl configured for your cluster
- Storage class available (for PersistentVolumes)
- LoadBalancer support (or Ingress)

### Installation

#### Step 1: Build and Push Docker Image

```bash
docker build -t your-registry/tandem-watch-signaling-server:v2.0.0 .
docker push your-registry/tandem-watch-signaling-server:v2.0.0
```

Update image in `k8s/deployment.yaml`:
```yaml
image: your-registry/tandem-watch-signaling-server:v2.0.0
```

#### Step 2: Deploy to Development Environment

```bash
kubectl apply -k k8s/overlays/dev
```

Check deployment:
```bash
kubectl get pods -n tandem-watch
kubectl get svc -n tandem-watch
```

#### Step 3: Deploy to Staging Environment

```bash
kubectl apply -k k8s/overlays/staging
```

#### Step 4: Deploy to Production Environment

```bash
# Update secrets with real credentials first
kubectl create secret generic redis-secret \
  --from-literal=password='REAL_PASSWORD' \
  -n tandem-watch --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic postgres-secret \
  --from-literal=password='REAL_PASSWORD' \
  -n tandem-watch --dry-run=client -o yaml | kubectl apply -f -

# Deploy production configuration
kubectl apply -k k8s/overlays/prod
```

### Verify Deployment

```bash
# Check all pods are running
kubectl get pods -n tandem-watch

# Check services
kubectl get svc -n tandem-watch

# Check PersistentVolumes
kubectl get pvc -n tandem-watch

# Get LoadBalancer external IP
kubectl get svc signaling-server -n tandem-watch
# Use: ws://EXTERNAL_IP/ws for client connections

# Check logs
kubectl logs -n tandem-watch deployment/signaling-server

# Port forward for local testing
kubectl port-forward -n tandem-watch svc/signaling-server 4001:80 &
# Then connect to ws://localhost:4001/ws
```

## Environment-Specific Configuration

### Development (`k8s/overlays/dev/`)
- 1 server replica
- 128MB/50m CPU per pod
- Debug logging enabled
- Best for local testing

### Staging (`k8s/overlays/staging/`)
- 2 server replicas
- 256MB/100m CPU per pod
- Info logging
- Test high-availability scenarios

### Production (`k8s/overlays/prod/`)
- 5 server replicas (configurable)
- 512MB/200m CPU per pod (configurable)
- Warn-level logging
- Mandatory pod anti-affinity across nodes
- Zero-downtime deployments (maxSurge: 2, maxUnavailable: 0)

## Horizontal Pod Autoscaling

Optional: Add automatic scaling based on metrics.

Create `k8s/hpa.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: signaling-server-hpa
  namespace: tandem-watch
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: signaling-server
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

Deploy:
```bash
kubectl apply -f k8s/hpa.yaml -n tandem-watch
```

Monitor scaling:
```bash
kubectl get hpa -n tandem-watch -w
```

## Health Checks

All containers expose health endpoints:

```bash
# Server health
curl http://localhost:4001/health
# Response: { "status": "ok", "nodeId": "..." }

# Server metrics
curl http://localhost:4001/metrics
# Response: { "nodeId": "...", "localConnections": 5, "memory": 45.2 }

# Server detailed status
curl http://localhost:4001/status
# Response: Full server status object
```

Kubernetes automatically:
- Kills pods failing liveness probe (3 failures in 30 seconds)
- Removes pods failing readiness probe from load balancer
- Waits 15 seconds on termination for graceful shutdown

## Troubleshooting

### Pods stuck in Pending

```bash
kubectl describe pod -n tandem-watch <pod-name>
# Check: PVC not bound, node resources exhausted, storage class not found
```

### Pods crashing (CrashLoopBackOff)

```bash
kubectl logs -n tandem-watch deployment/signaling-server --tail=50
# Check: PostgreSQL/Redis connection errors, configuration issues
```

### Connection timeouts

Verify LoadBalancer is properly configured:
```bash
kubectl get svc signaling-server -n tandem-watch -o wide
# Must have EXTERNAL-IP assigned
```

For on-premises clusters without LoadBalancer:
```bash
# Option 1: Use NodePort
kubectl patch svc signaling-server -n tandem-watch -p '{"spec": {"type": "NodePort"}}'
# Connect to: ws://NODE_IP:NODE_PORT/ws

# Option 2: Use Ingress (requires ingress controller)
kubectl apply -f k8s/ingress.yaml
```

### High memory usage

Check room count and event log size:
```bash
kubectl exec -it -n tandem-watch postgres-0 -- psql -U tandem -d tandem_watch -c \
  "SELECT COUNT(*) as room_count FROM rooms; SELECT COUNT(*) as event_count FROM room_events;"
```

Consider:
- Archiving old events
- Implementing event retention policies
- Increasing Pod memory limits

## Production Checklist

- [ ] Custom container image built and pushed to registry
- [ ] Production secrets configured (not using example values)
- [ ] PostgreSQL and Redis persistence enabled and backed up
- [ ] Network policies configured if needed
- [ ] RBAC roles created for service account
- [ ] Monitoring/alerting configured
- [ ] Load testing completed to verify capacity
- [ ] Backup/restore procedures documented and tested
- [ ] Ingress/TLS configured for production endpoint
- [ ] Pod Disruption Budgets configured for high-availability

## Scaling Guidelines

### Vertical Scaling (More CPU/Memory)

Modify resource limits in appropriate overlay:

```yaml
resources:
  requests:
    cpu: "500m"
    memory: "1Gi"
  limits:
    cpu: "2"
    memory: "2Gi"
```

Apply changes:
```bash
kubectl apply -k k8s/overlays/prod
```

### Horizontal Scaling (More Replicas)

Simple method:
```bash
kubectl scale deployment signaling-server -n tandem-watch --replicas=10
```

Persistent method (through Kustomization):
```yaml
replicas:
  - name: signaling-server
    count: 10
```

Then:
```bash
kubectl apply -k k8s/overlays/prod
```

### Database Scaling

**PostgreSQL Read Scaling:**
Add read replicas for standby servers handling SELECT queries.

**Redis Scaling:**
Switch to Redis Cluster for horizontal caching (requires architectural changes).

## Backup & Recovery

### PostgreSQL Backup

```bash
# Manual backup
kubectl exec -n tandem-watch postgres-0 -- pg_dump -U tandem tandem_watch > backup.sql

# Restore from backup
kubectl exec -i -n tandem-watch postgres-0 -- psql -U tandem tandem_watch < backup.sql
```

### Redis Backup

```bash
# Backup RDB file
kubectl exec -n tandem-watch redis-0 -- cp /data/dump.rdb /tmp/dump.rdb
kubectl cp tandem-watch/redis-0:/tmp/dump.rdb ./dump.rdb
```

## Performance Tuning

### Connection Pool Settings

Edit `signaling_server/config.js`:
```javascript
pgPool: {
  max: 30,              // Increase for more connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
}
```

### Redis Configuration

Edit `k8s/redis.yaml` ConfigMap:
```yaml
maxmemory: 1gb         # Increase for more data
maxmemory-policy: allkeys-lru  # Choose eviction policy
```

### Heartbeat Tuning

Edit `signaling_server/config.js`:
```javascript
heartbeatInterval: 20000,    // Reduce for faster detection (more overhead)
userCleanupInterval: 40000,  // Reduce for faster cleanup
```

## Monitoring with Prometheus

Enable metrics collection:

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: signaling-server
  namespace: tandem-watch
spec:
  selector:
    matchLabels:
      app: tandem-watch
  endpoints:
  - port: metrics
    interval: 30s
```

## Support & Issues

For debugging:
1. Check logs: `kubectl logs -n tandem-watch <pod>`
2. Describe pod: `kubectl describe pod -n tandem-watch <pod>`
3. Check events: `kubectl get events -n tandem-watch`
4. Port-forward for local testing: `kubectl port-forward svc/signaling-server 4001:80`
