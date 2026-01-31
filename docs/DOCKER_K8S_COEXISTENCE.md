# Running Kubernetes Alongside Existing Docker Stack

A guide for deploying tandem.watch on a server with existing Docker/Docker Compose services.

---

## ⚠️ Potential Conflicts & Solutions

### 1. **Container Runtime & Networking**

**Issue**: Both Docker and Kubernetes use the Docker daemon, but they manage networking differently.

**Impact**: ⚠️ Minor (manageable)

**Solution**:
- Kubernetes creates its own virtual network (overlay network via Flannel)
- Docker Compose uses bridge networks (default `docker0` bridge)
- Keep them **isolated**—they operate independently as long as port mappings don't conflict

**Action**: Just ensure they use different network ranges:
```bash
# Your existing Docker Compose likely uses: 172.17.x.x (docker0)
# Kubernetes will use: 10.244.x.x (Flannel network, configured in kubeadm init)
# No conflict expected
```

---

### 2. **Port Conflicts** ⚠️ **CRITICAL**

Your k8s config tries to expose the signaling server on **port 80**. If any of your existing Docker services are already using common ports, you'll have issues.

**Your tandem.watch needs:**
- **Port 80 or 443** (HTTP/HTTPS for signaling server WebSocket)
- **Port 4001** (internal, only if using NodePort)

**Common ports that could conflict:**
- Port 80 (web servers, reverse proxies)
- Port 443 (HTTPS)
- Port 3000, 8000, 8080 (common dev ports)

**Check your existing services:**
```bash
# See what Docker services are using ports
docker ps --format "table {{.Names}}\t{{.Ports}}"

# Check all listening ports on the server
sudo netstat -tlnp | grep LISTEN

# Check which services own the ports
sudo lsof -i -P -n | grep LISTEN
```

**Solution**: Update k8s service to use a different port or clean approach:

Option A: **Use different port for tandem.watch** (recommended)
```yaml
# Update k8s/service.yaml
ports:
  - name: ws
    port: 4001          # External port on server
    targetPort: 4001    # Internal container port
    protocol: TCP
```

Option B: **Stop conflicting services temporarily** (not recommended for production)

Option C: **Use reverse proxy** (recommended for production)
```bash
# nginx can route traffic to both Docker and K8s based on URL path
# docker services: /app1, /app2
# tandem.watch: /ws
```

---

### 3. **Database Conflicts** 🔴 **MOST CRITICAL**

**Your existing PostgreSQL is running on port 5432** (default). If the k8s deployment also tries to run PostgreSQL on 5432, there will be a conflict.

**You have three options:**

#### **Option 1: Use your existing PostgreSQL** (Recommended) ✅
Skip the k8s PostgreSQL and connect the signaling server to your existing DB.

**Steps:**
1. Create a database in your existing PostgreSQL for tandem.watch:
```bash
# Connect to your existing PostgreSQL
psql -U <your_user> -h localhost

# Create database and user
CREATE DATABASE tandem_watch;
CREATE USER tandem_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE tandem_watch TO tandem_user;
```

2. Update k8s ConfigMap to point to your external PostgreSQL:
```yaml
# k8s/configmap.yaml
data:
  DB_HOST: "172.17.0.1"        # Docker host IP (accessible from k8s)
  DB_PORT: "5432"
  DB_NAME: "tandem_watch"
  DB_USER: "tandem_user"
  POSTGRES_PASSWORD: "secure_password"
```

3. **Remove postgres.yaml from k8s deployment**:
```bash
# Edit k8s/kustomization.yaml
# Remove or comment out the postgres resource
```

**Pros**: Simpler, reuses existing DB infrastructure, lower resource usage
**Cons**: Single point of failure if your existing DB goes down

#### **Option 2: Run k8s PostgreSQL on different port**
If you want isolated databases, expose k8s PostgreSQL on a different port.

```yaml
# k8s/postgres-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: tandem-watch
spec:
  type: NodePort
  ports:
    - port: 5432
      targetPort: 5432
      nodePort: 5433        # Different port on host
  selector:
    app: postgres
```

**Pros**: Isolation, independent backups
**Cons**: Uses more resources, two PostgreSQL instances

#### **Option 3: Use managed database** (Best for prod)
PostgreSQL as a separate managed service (AWS RDS, DigitalOcean, etc.)

---

### 4. **Redis Conflicts**

**Your k8s redis.yaml tries to use port 6379** (default Redis port).

**Check if you're already running Redis:**
```bash
docker ps | grep redis
sudo lsof -i :6379
```

**Solutions** (same as PostgreSQL):
1. Use existing Redis if you have it
2. Run k8s Redis on port 6380
3. Remove Redis from k8s if not needed

---

## 🎯 Recommended Setup for Your Machine

Given you already have Docker + PostgreSQL running:

### **Step 1: Audit Current Services**
```bash
# See all running Docker containers
docker ps

# See all listening ports
sudo netstat -tlnp | grep LISTEN

# Check PostgreSQL status
sudo systemctl status postgresql
# or
docker ps | grep postgres
```

### **Step 2: Plan Port Allocation**
```
Your existing services:
- PostgreSQL: 5432
- Other tools: ???

tandem.watch (k8s) will need:
- Signaling server WebSocket: 4001 (or different if needed)
- PostgreSQL: (reuse existing on 5432, or 5433 if separate)
- Redis: 6379 (or 6380 if separate)
```

### **Step 3: Choose Integration Strategy**

**Recommended: Hybrid Approach**
```
┌─ Your Existing Services (Docker Compose) ─┐
│ - PostgreSQL:5432                          │
│ - Other apps                               │
└────────────────────────────────────────────┘

┌─ Kubernetes (Single-node) ─────────────────┐
│ - tandem.watch signaling server: 4001      │
│ - (uses existing PostgreSQL on 5432)       │
│ - Redis (internal to k8s or reused)        │
└────────────────────────────────────────────┘
```

**Config changes needed:**
```yaml
# k8s/configmap.yaml
data:
  DB_HOST: "172.17.0.1"        # Docker gateway (external DB)
  DB_PORT: "5432"
  DB_NAME: "tandem_watch"
  
# k8s/overlays/prod/kustomization.yaml
# Remove postgres.yaml and redis.yaml references
```

---

## 🔧 Implementation Checklist

- [ ] Check existing services: `docker ps` and `sudo netstat -tlnp | grep LISTEN`
- [ ] Confirm PostgreSQL version and capacity
- [ ] Decide: reuse existing DB or separate k8s DB?
- [ ] Update k8s configmap with correct DB host/credentials
- [ ] Remove unused k8s manifests (postgres.yaml, redis.yaml)
- [ ] Verify port 4001 is available (or change in k8s)
- [ ] Test k8s PostgreSQL connectivity from container
- [ ] Deploy and monitor resource usage

---

## 📊 Resource Expectations

With **i5-9600K, 32GB RAM**, running both Docker Compose + Kubernetes:

| Component | Memory | CPU | Notes |
|-----------|--------|-----|-------|
| Docker daemon | ~200MB | low | Baseline |
| Existing services | varies | varies | Your apps |
| PostgreSQL (existing) | ~500MB-2GB | moderate | Depends on queries |
| Kubernetes | ~1-2GB | low | (overlay network, etcd) |
| tandem.watch pods (3x) | ~300MB (100 each) | moderate | Node/signaling server |
| **Total** | **~3-5GB** | **low** | Plenty of headroom |

**Verdict**: ✅ No resource issues expected. Your 32GB is plenty.

---

## ⚠️ Important: Backup Your Existing PostgreSQL

Before running Kubernetes on this machine:

```bash
# Create a full backup
pg_dump -U <your_user> --all --verbose > backup-$(date +%Y%m%d-%H%M%S).sql

# Or if running in Docker
docker exec <postgres_container> pg_dump -U <user> --all > backup.sql

# Verify backup
ls -lh backup*.sql
```

**Keep this backup safe in case of any issues.**

---

## Troubleshooting Mixed Environments

### K8s pods can't reach external PostgreSQL
```bash
# From inside a pod, test connectivity
kubectl exec -it -n tandem-watch <pod-name> -- nc -zv 172.17.0.1 5432

# Check if firewall allows it
sudo ufw allow 5432/tcp

# Verify DB user permissions
# Connect locally and run: SELECT * FROM pg_stat_connections;
```

### Port already in use errors
```bash
# Kill process using port
sudo lsof -i :4001
sudo kill -9 <PID>

# Or use different port in k8s service
```

### Resource contention issues
```bash
# Monitor both Docker and Kubernetes
docker stats
kubectl top nodes
kubectl top pods -n tandem-watch

# Reduce replicas or resource limits if needed
```

---

## Migration Path (If Desired)

If you later want to move your existing services INTO Kubernetes:

1. Create k8s manifests for existing services
2. Test in parallel (no downtime)
3. Migrate data incrementally
4. Switch DNS/traffic to k8s services
5. Decommission Docker Compose stack

For now, **coexistence is fine and recommended** for stability.

---

## Next Steps

1. **Run the audit**: Check what ports/services are currently in use
2. **Get your current PostgreSQL details**: User, version, size
3. **Update k8s config**: Point to external DB or create separated DB
4. **Deploy**: Follow main [KUBERNETES_DEPLOYMENT.md](KUBERNETES_DEPLOYMENT.md) guide
5. **Monitor**: Watch resource usage and logs for the first few days

Need help with specific conflicts? Check existing services first with the commands above.
