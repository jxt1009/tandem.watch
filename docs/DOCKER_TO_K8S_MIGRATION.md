# Migrating tandem.watch from Docker to Kubernetes

Your personal guide for moving from Docker Compose to Kubernetes on your Ubuntu server.

---

## 📋 Your Current Setup

**Running Services:**
- tandem.watch signaling server in Docker (port 4001)
- PostgreSQL 18 (used by TeslaMate, tandem.watch)
- Redis 6 (internal to signaling)
- Other tools: TeslaMate, Home Assistant, Jellyfin, qBittorrent, Portainer, ComfyUI, Factorio

**Docker services to migrate to K8s:**
1. Signaling server (tandem.watch)
2. Redis (or skip and use existing)
3. PostgreSQL for tandem.watch (or skip and use TeslaMate's DB)

---

## ✅ Pre-Migration Checklist

### 1. Backup Everything
```bash
# Backup your PostgreSQL
pg_dump -U postgres -h localhost tandem_watch > tandem_watch_backup.sql

# Backup Redis (if needed)
docker exec tandem-redis redis-cli BGSAVE
docker cp tandem-redis:/data/dump.rdb ./redis_backup.rdb

# Verify backups exist
ls -lh tandem_watch_backup.sql redis_backup.rdb
```

### 2. Note Current Configuration
Your current `.env` (if you have one):
```bash
cat /path/to/signaling_server/.env
```

Or from docker-compose, these are your values:
- POSTGRES_USER: `tandem`
- POSTGRES_PASSWORD: `postgres`
- POSTGRES_DB: `tandem_watch`
- REDIS_HOST: `tandem-redis`
- POSTGRES_HOST: `tandem-postgres`

---

## 🚀 Migration Steps

### Step 1: Install Kubernetes (One-time setup)

Follow the main [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md) guide:

```bash
# 1. Install Docker (already done)
# 2. Install kubeadm, kubelet, kubectl
# 3. Initialize cluster: kubeadm init
# 4. Install Flannel networking
# 5. Remove control-plane taint
```

**Stop here and verify K8s is working:**
```bash
kubectl get nodes
# Should show your node in Ready state

kubectl get pods --all-namespaces
# Should see kube-system pods running
```

### Step 2: Create K8s Namespace & Storage

```bash
# Create namespace for tandem.watch
kubectl create namespace tandem-watch

# Create storage directories (if using local storage)
sudo mkdir -p /mnt/tandem-watch/{postgres,redis}
sudo chown $USER:$USER /mnt/tandem-watch/{postgres,redis}
chmod 755 /mnt/tandem-watch/{postgres,redis}
```

### Step 3: Create K8s Secrets with Your Current Credentials

```bash
# Use YOUR current credentials
kubectl create secret generic tandem-watch-secrets \
  --from-literal=postgres-user=tandem \
  --from-literal=postgres-password=postgres \
  --from-literal=postgres-db=tandem_watch \
  --from-literal=redis-password="" \
  -n tandem-watch
```

### Step 4: Update ConfigMap

Create `k8s/configmap.yaml` with your settings:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tandem-watch-config
  namespace: tandem-watch
data:
  PORT: "4001"
  HOST: "0.0.0.0"
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  
  # Database
  POSTGRES_HOST: "postgres"
  POSTGRES_PORT: "5432"
  POSTGRES_DB: "tandem_watch"
  POSTGRES_USER: "tandem"
  POSTGRES_POOL_SIZE: "20"
  
  # Redis
  REDIS_HOST: "redis"
  REDIS_PORT: "6379"
  REDIS_DB: "0"
```

Apply it:
```bash
kubectl apply -f k8s/configmap.yaml
```

### Step 5: Deploy PostgreSQL to K8s

```bash
kubectl apply -f k8s/postgres.yaml -n tandem-watch

# Wait for it to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n tandem-watch --timeout=300s

# Verify
kubectl get pods -n tandem-watch
```

**One-time setup: Initialize database**
```bash
# Get pod name
POD=$(kubectl get pods -n tandem-watch -l app=postgres -o jsonpath='{.items[0].metadata.name}')

# Create schema (if needed)
kubectl exec -it $POD -n tandem-watch -- psql -U tandem -d tandem_watch -c "CREATE TABLE IF NOT EXISTS rooms (id SERIAL PRIMARY KEY);"

# Verify
kubectl exec -it $POD -n tandem-watch -- psql -U tandem -d tandem_watch -c "\dt"
```

### Step 6: Deploy Redis to K8s

```bash
kubectl apply -f k8s/redis.yaml -n tandem-watch

# Wait for it
kubectl wait --for=condition=ready pod -l app=redis -n tandem-watch --timeout=300s

# Verify
kubectl get pods -n tandem-watch
```

### Step 7: Deploy Signaling Server

First, update the image in `k8s/deployment.yaml` to use your Docker image:

```bash
# Build your image (on your machine)
cd chrome-extension
npm run build
cd ../signaling_server

# Tag it
docker build -t tandem-watch-signaling:latest .
docker tag tandem-watch-signaling:latest localhost:5000/tandem-watch-signaling:latest

# Push to registry (or use local registry)
# For now, just build locally so K8s can use it
```

Update deployment to use your image:
```yaml
# k8s/deployment.yaml
image: tandem-watch-signaling:latest
imagePullPolicy: Never  # Use local image
```

Deploy:
```bash
kubectl apply -f k8s/deployment.yaml -n tandem-watch

# Monitor rollout
kubectl rollout status deployment/signaling-server -n tandem-watch

# Check logs
kubectl logs -f -l app=signaling-server -n tandem-watch
```

### Step 8: Verify Everything Works

```bash
# Check all pods are running
kubectl get pods -n tandem-watch

# Check service is exposed
kubectl get svc -n tandem-watch

# Test WebSocket connection (from your machine)
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  http://your-server-ip:4001/ws

# Check container logs
kubectl logs -n tandem-watch -l app=signaling-server --tail=50
```

---

## ⏹️ Stop Current Docker Services

**Only do this after K8s is fully working:**

```bash
# Stop tandem.watch Docker services
cd /path/to/signaling_server
docker-compose down

# This removes: tandem-postgres, tandem-redis, signaling containers
# Other Docker services (TeslaMate, etc.) remain running

# Verify tandem services are down
docker ps | grep tandem
# Should show nothing
```

---

## 🔄 Rollback Plan

If something goes wrong, you can quickly restore:

```bash
# Kill K8s deployment
kubectl delete deployment signaling-server -n tandem-watch

# Restart Docker services
cd /path/to/signaling_server
docker-compose up -d

# Restore from backup if needed
psql -U tandem tandem_watch < tandem_watch_backup.sql
```

---

## 📊 Side-by-Side Comparison

**Before (Docker):**
```
docker-compose up -d
├── postgres:15-alpine
├── redis:7-alpine
└── signaling-server
```

**After (Kubernetes):**
```
kubectl apply -k k8s/
├── StatefulSet: postgres
├── Deployment: redis
└── Deployment: signaling-server
```

---

## 🔍 Troubleshooting Migration

### K8s can't connect to PostgreSQL
```bash
# Check if pod is running
kubectl get pods -n tandem-watch -l app=postgres

# Check logs
kubectl logs -n tandem-watch postgres-0

# Test connection from signaling pod
kubectl exec -it -n tandem-watch deployment/signaling-server -- \
  psql -h postgres -U tandem -d tandem_watch -c "SELECT 1"
```

### Signaling server won't start
```bash
# Check logs
kubectl logs -n tandem-watch -l app=signaling-server --tail=100

# Check events
kubectl describe pod -n tandem-watch <pod-name>

# Common issues:
# - Image not found: build and push locally
# - Port already in use: check with `lsof -i :4001`
# - Missing env vars: verify ConfigMap and Secrets
```

### Port 4001 already in use
```bash
# Kill old Docker container (if still running)
docker kill signaling

# Or use different port in service.yaml
# Change nodePort to 4002
```

### Database connection timeout
```bash
# Verify DB is running
kubectl exec -it -n tandem-watch postgres-0 -- pg_isready

# Check network between pods
kubectl exec -it -n tandem-watch deployment/signaling-server -- \
  nc -zv postgres 5432
```

---

## 📈 After Migration

### Monitor K8s Cluster
```bash
# Watch resource usage
watch kubectl top pods -n tandem-watch

# View logs in real-time
kubectl logs -f -n tandem-watch -l app=signaling-server

# Check pod status
kubectl get pods -n tandem-watch -w
```

### Update DNS/Proxy

If you're using nginx reverse proxy:

```nginx
# Update to point to K8s service
upstream signaling {
    server localhost:4001;  # Same as before
}

server {
    listen 80;
    server_name watch.toper.dev;
    
    location / {
        proxy_pass http://signaling;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### Scaling (if needed)
```bash
# Scale to 2 replicas
kubectl scale deployment signaling-server --replicas=2 -n tandem-watch

# Scale back to 1
kubectl scale deployment signaling-server --replicas=1 -n tandem-watch
```

---

## ✨ Benefits After Migration

- ✅ Self-healing (pod restarts on failure)
- ✅ Rolling updates (zero downtime deployments)
- ✅ Resource limits (prevents runaway processes)
- ✅ Better monitoring (native K8s metrics)
- ✅ Cleaner orchestration (replaces docker-compose)

---

## Next Steps

1. **Install Kubernetes**: Follow KUBERNETES_DEPLOYMENT.md steps 1-4
2. **Backup current services**: Commands above
3. **Deploy to K8s**: Follow steps 1-7
4. **Test thoroughly**: WebSocket connection, database, Redis
5. **Stop Docker services**: Only after confirming K8s works
6. **Monitor logs**: Watch for any issues in first few hours

Need help with any step? Check the troubleshooting section above or refer to main [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md).
