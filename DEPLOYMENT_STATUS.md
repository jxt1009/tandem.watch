# 🚀 Deployment Status: tandem.watch v2.0 on Kubernetes

**Date**: February 1, 2026  
**Status**: ✅ **LIVE AND OPERATIONAL**  
**Cluster**: Single-node Kubernetes (10.0.0.102)

---

## 📊 Current Deployment

### Services Running
| Service | Status | Location | Port | Access |
|---------|--------|----------|------|--------|
| **Signaling Server** | ✅ Running | K8s Pod | 30401 (NodePort) | `http://10.0.0.102:30401` |
| **PostgreSQL** | ✅ Running | K8s StatefulSet | 5432 (internal) | `postgres.tandem-watch.svc.cluster.local:5432` |
| **Redis** | ✅ Running | K8s StatefulSet | 6379 (internal) | `redis-cluster.tandem-watch.svc.cluster.local:6379` |

### Health Status
```bash
# Check all pods
kubectl get pods -n tandem-watch

# Output:
# NAME                                    READY   STATUS    RESTARTS   AGE
# postgres-0                              1/1     Running   0          2h
# redis-cluster-0                         1/1     Running   0          2h
# signaling-server-6bfcd45c7f-vnt7q       1/1     Running   0          1h
```

### Health Check
```bash
# Test signaling server
curl -I http://10.0.0.102:30401/health
# HTTP/1.1 200 OK

# Test database connectivity (from pod)
kubectl exec -it -n tandem-watch postgres-0 -- pg_isready -U postgres
# accepting connections
```

---

## 🔑 Key Configuration

### Internal Ports (Container)
- **Signaling Server**: 4001 (EXPOSE in Dockerfile)
- **PostgreSQL**: 5432
- **Redis**: 6379

### External Access
- **Signaling Server**: 30401 (NodePort)
  - Reason: Kubernetes enforces NodePort range 30000-32767
  - Direct access: `ws://10.0.0.102:30401/ws`
  - Local port-forward available: `kubectl port-forward -n tandem-watch svc/signaling-server 4001:4001`

### Storage
- **PostgreSQL Data**: `/mnt/k8s/postgres` (hostPath PV)
- **Redis Data**: `/mnt/k8s/redis` (hostPath PV)

### Environment Variables
See [k8s/configmap.yaml](k8s/configmap.yaml) for all configuration:
```
POSTGRES_HOST=postgres.tandem-watch.svc.cluster.local
POSTGRES_PORT=5432
POSTGRES_DB=tandem_watch
POSTGRES_USER=postgres
REDIS_HOST=redis-cluster.tandem-watch.svc.cluster.local
REDIS_PORT=6379
PORT=4001
NODE_ENV=production
LOG_LEVEL=info
```

---

## 🔧 Common Operations

### View Logs
```bash
# Signaling server logs
kubectl logs -n tandem-watch -l app=signaling-server -f

# PostgreSQL logs
kubectl logs -n tandem-watch postgres-0 -f

# Redis logs
kubectl logs -n tandem-watch redis-cluster-0 -f
```

### Scale Replicas
```bash
# Scale signaling server to 3 replicas
kubectl scale deployment -n tandem-watch signaling-server --replicas=3
```

### Port Forward for Local Access
```bash
# If you need port 4001 locally instead of 30401
kubectl port-forward -n tandem-watch svc/signaling-server 4001:4001 &

# Then: ws://localhost:4001/ws
```

### Check Resource Usage
```bash
# Pod resources
kubectl top pods -n tandem-watch

# Node resources
kubectl top nodes
```

---

## 📝 Recent Changes

### Docker Image
- Built: `tandem-watch-signaling:latest`
- Base: `node:20-alpine`
- Fixed: npm ci deprecation → npm install --omit=dev

### K8s Manifests Updated
- ✅ deployment.yaml: Removed ConfigMap volume mount (code in image)
- ✅ service.yaml: NodePort 30401 (was 4001, outside valid range)
- ✅ postgres.yaml: Added PersistentVolume with hostPath
- ✅ redis.yaml: Added PersistentVolume with hostPath
- ✅ namespace.yaml: Fixed NetworkPolicy API version (v1 → networking.k8s.io/v1)

### CNI Configuration
- ✅ Installed CNI plugins (/opt/cni/bin/)
- ✅ Fixed Flannel CNI config (added bridge plugin type)
- ✅ Added kubelet config: cniBinDir, cniConfDir, containerRuntimeEndpoint

---

## 🛠️ Kubernetes Cluster Setup

### Infrastructure
- **OS**: Ubuntu 20.04 LTS
- **Kernel**: 5.15.0-168
- **Hardware**: i5-9600K, 32GB RAM, 2TB storage
- **CRI**: cri-dockerd (socket: /var/run/cri-dockerd.sock)
- **CNI**: Flannel (10.244.0.0/16 CIDR)
- **kubeadm**: v1.32.11

### System Pods (All Running ✅)
```bash
kubectl get pods -n kube-system
# etcd, kube-apiserver, kube-controller-manager, kube-scheduler, kube-proxy all 1/1 Running
```

### System Pods (All Running ✅)
```bash
kubectl get pods -n kube-flannel
# kube-flannel-ds Running
```

---

## 📋 Pre-Deployment Fixes

These were completed before achieving this running state:

1. **cri-dockerd Build Issue**
   - Problem: Go 1.24.9 requirement, server had 1.23
   - Solution: Patched go.mod to Go 1.23, rebuilt successfully

2. **Kernel Module Missing**
   - Problem: br_netfilter not loaded, Flannel failed
   - Solution: `modprobe br_netfilter`, configured sysctl, persisted

3. **CNI Plugin Issue**
   - Problem: kubelet: "cni config uninitialized"
   - Solution: Installed full CNI plugin suite, updated kubelet config

4. **CNI Config Syntax**
   - Problem: Missing "type" in bridge delegate section
   - Solution: Updated config with proper plugin types

5. **Docker Image Build**
   - Problem: npm ci --only=production deprecated
   - Solution: Changed to npm install --omit=dev

---

## 🔐 Security Notes

- ✅ Service uses NodePort (no HTTPS setup yet)
- ✅ Credentials in secret.yaml (not committed to git)
- ⚠️ No TLS/mTLS between components yet
- ⚠️ No network policies restricting traffic yet
- 📌 TODO: Enable HTTPS for production use

---

## 📈 Next Steps / Future Work

1. **Monitoring & Logging**
   - [ ] Deploy Prometheus for metrics
   - [ ] Setup Grafana dashboards
   - [ ] Configure log aggregation (ELK, Loki)

2. **High Availability**
   - [ ] Add pod disruption budgets
   - [ ] Configure cluster autoscaling
   - [ ] Setup database replication

3. **Security Hardening**
   - [ ] Enable TLS for signaling server (wss://)
   - [ ] Setup network policies
   - [ ] Add RBAC rules

4. **Optimization**
   - [ ] Fine-tune resource limits based on load testing
   - [ ] Evaluate RDS/managed DB for PostgreSQL
   - [ ] Setup CDN for static assets if needed

5. **Backup & Disaster Recovery**
   - [ ] Automated database backups
   - [ ] Disaster recovery procedure
   - [ ] Test recovery scenarios

---

## 📞 Troubleshooting

### Pods not ready?
```bash
kubectl describe pod -n tandem-watch <pod-name>
kubectl logs -n tandem-watch <pod-name> --tail=50
```

### Cannot connect to service?
```bash
# Test from inside pod
kubectl exec -it -n tandem-watch signaling-server-XXX -- curl http://localhost:4001/health

# Test from host
curl http://10.0.0.102:30401/health
```

### Database connectivity issues?
```bash
# Test from signaling server pod
kubectl exec -it -n tandem-watch signaling-server-XXX -- nc -zv postgres 5432
```

---

## 📚 Documentation

- [KUBERNETES_DEPLOYMENT.md](docs/KUBERNETES_DEPLOYMENT.md) - Complete deployment guide
- [DOCKER_K8S_COEXISTENCE.md](docs/DOCKER_K8S_COEXISTENCE.md) - Running alongside Docker Compose
- [k8s/README.md](k8s/README.md) - K8s architecture deep dive
- [QUICKSTART.md](docs/QUICKSTART.md) - Quick reference

---

**Last Updated**: 2026-02-01  
**Deployed By**: GitHub Copilot & User Collaboration  
**Next Review**: When deploying to additional environments
