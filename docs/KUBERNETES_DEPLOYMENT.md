# Kubernetes Deployment on Ubuntu Server

A guide for deploying tandem.watch to a Kubernetes cluster on Ubuntu.

---

## Prerequisites

### System Requirements
- Ubuntu 20.04 LTS or later
- Docker installed and running
- `kubectl` installed
- `helm` (optional, for package management)

### Your Hardware Assessment
**i5-9600K, 32GB RAM, 2TB storage, 2.5G Ethernet**

✅ **Your specs are well-suited for a single-node production cluster:**
- **CPU**: 6 cores/6 threads is adequate for the signaling server + PostgreSQL + Redis
- **RAM**: 32GB provides comfortable headroom (recommended: 16GB minimum)
- **Storage**: 2TB is excellent for container images, databases, and persistent volumes
- **Network**: 2.5G ethernet gives 2.5Gbps throughput—more than sufficient for this workload

**Recommendation**: Single-node cluster is optimal for your setup. No need for multi-node complexity.

---

## Step 1: Install Kubernetes (kubeadm)

### 1.1 Install Docker
```bash
sudo apt update
sudo apt install -y docker.io
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
```
Log out and back in for group changes to take effect.

### 1.2 Install kubeadm, kubelet, kubectl
```bash
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl gpg

# Add Kubernetes GPG key
curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key add -

# Add Kubernetes repository
echo "deb https://apt.kubernetes.io/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt update
sudo apt install -y kubelet kubeadm kubectl

# Pin versions to prevent auto-updates
sudo apt-mark hold kubelet kubeadm kubectl

# Enable kubelet
sudo systemctl enable kubelet
```

### 1.3 Initialize the Cluster
```bash
# Single-node cluster with all components
sudo kubeadm init --pod-network-cidr=10.244.0.0/16

# Copy kubeconfig to your user
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config

# Verify
kubectl get nodes
```

### 1.4 Install a Pod Network Add-on (Flannel)
```bash
kubectl apply -f https://raw.githubusercontent.com/coreos/flannel/master/Documentation/kube-flannel.yml

# Remove taint from control plane (allows workloads on single-node)
kubectl taint nodes --all node-role.kubernetes.io/control-plane-
```

---

## Step 2: Set Up Storage

### 2.1 Create Persistent Volume (PV)
The k8s cluster needs persistent storage for PostgreSQL and Redis. Create local storage:

```bash
# Create directories for persistent data
sudo mkdir -p /mnt/tandem-watch/{postgres,redis}
sudo chown $(id -u):$(id -g) /mnt/tandem-watch/{postgres,redis}
sudo chmod 755 /mnt/tandem-watch/{postgres,redis}
```

### 2.2 Create Namespace
```bash
kubectl create namespace tandem-watch
```

---

## Step 3: Deploy the Application

### 3.1 Create ConfigMap
Update `k8s/configmap.yaml` with your environment:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: tandem-watch-config
  namespace: tandem-watch
data:
  DB_HOST: "postgres"
  DB_PORT: "5432"
  DB_NAME: "tandem_watch"
  REDIS_HOST: "redis"
  REDIS_PORT: "6379"
  WS_PORT: "4001"
  NODE_ENV: "production"
```

### 3.2 Create Secrets
```bash
# Generate secure passwords
DB_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)

# Create secrets
kubectl create secret generic tandem-watch-secrets \
  --from-literal=db-password=$DB_PASSWORD \
  --from-literal=redis-password=$REDIS_PASSWORD \
  -n tandem-watch
```

### 3.3 Deploy with Kustomize
```bash
# Deploy with production overlay
kubectl apply -k k8s/overlays/prod

# Verify deployments
kubectl get deployments -n tandem-watch
kubectl get pods -n tandem-watch
```

---

## Step 4: Configure Networking

### 4.1 Expose the Service
By default, the service is internal. To expose it externally:

```bash
# Option A: Use NodePort (simple, exposes on all node IPs)
kubectl patch svc tandem-watch-api -p '{"spec":{"type":"NodePort"}}' -n tandem-watch

# Option B: Use LoadBalancer (requires external LB or MetalLB)
# For single-node, NodePort is recommended

# Get the exposed port
kubectl get svc -n tandem-watch
```

### 4.2 Set Up Port Forwarding (Development)
```bash
# Forward local port to service
kubectl port-forward -n tandem-watch svc/tandem-watch-api 4001:4001
```

### 4.3 Configure DNS/TLS (Production)
For production with a domain:

```bash
# Install cert-manager for Let's Encrypt
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create an Ingress resource (see k8s/ingress.yaml template)
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tandem-watch-ingress
  namespace: tandem-watch
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  tls:
    - hosts:
        - watch.toper.dev
      secretName: tandem-watch-tls
  rules:
    - host: watch.toper.dev
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: tandem-watch-api
                port:
                  number: 4001
EOF
```

---

## Step 5: Monitor & Maintain

### 5.1 View Logs
```bash
# View deployment logs
kubectl logs -n tandem-watch -l app=tandem-watch-server --tail=100 -f

# View specific pod logs
kubectl logs -n tandem-watch <pod-name> -f
```

### 5.2 Check Resource Usage
```bash
# Monitor resource usage
kubectl top nodes
kubectl top pods -n tandem-watch
```

### 5.3 Database Management
```bash
# Access PostgreSQL pod
kubectl exec -it -n tandem-watch postgres-0 -- psql -U tandem_watch

# Access Redis
kubectl exec -it -n tandem-watch redis-0 -- redis-cli
```

### 5.4 Scaling
```bash
# Scale the signaling server (for multiple instances)
kubectl scale deployment tandem-watch-server --replicas=3 -n tandem-watch
```

---

## Step 6: Backup & Recovery

### 6.1 Backup Database
```bash
# Create a backup
kubectl exec -n tandem-watch postgres-0 -- \
  pg_dump -U tandem_watch tandem_watch > backup-$(date +%Y%m%d).sql

# Restore from backup
kubectl cp backup-20260131.sql tandem-watch/postgres-0:/tmp/
kubectl exec -n tandem-watch postgres-0 -- \
  psql -U tandem_watch tandem_watch < /tmp/backup-20260131.sql
```

### 6.2 Backup Persistent Volumes
```bash
# Mount the PV locally and backup
sudo tar czf /backup/tandem-watch-pv-backup-$(date +%Y%m%d).tar.gz \
  /mnt/tandem-watch/
```

---

## Troubleshooting

### Pods not starting
```bash
# Check pod status
kubectl describe pod <pod-name> -n tandem-watch

# Check events
kubectl get events -n tandem-watch --sort-by='.lastTimestamp'
```

### Database connection issues
```bash
# Verify service discovery
kubectl exec -it -n tandem-watch <app-pod> -- nslookup postgres

# Check network policies
kubectl get networkpolicies -n tandem-watch
```

### Storage issues
```bash
# Check PV status
kubectl get pv
kubectl get pvc -n tandem-watch

# Check node disk space
df -h /mnt/tandem-watch
```

### Performance tuning
For your i5-9600K with 32GB RAM:
```yaml
# Recommended resource limits in deployment
resources:
  requests:
    memory: "256Mi"
    cpu: "250m"
  limits:
    memory: "512Mi"
    cpu: "500m"
```

---

## Security Considerations

1. **Use RBAC**: Restrict service account permissions
2. **Network Policies**: Isolate pods by namespace
3. **Secrets Management**: Never commit secrets to Git
4. **TLS/SSL**: Always use HTTPS in production
5. **Image Scanning**: Scan container images for vulnerabilities
6. **Keep Updated**: Regular `apt update` and Kubernetes patch releases

---

## Next Steps

1. Build and push your Docker image to a registry
2. Update deployment specs with your image registry
3. Deploy using `kubectl apply -k k8s/overlays/prod`
4. Monitor logs and metrics
5. Set up automated backups
6. Consider a reverse proxy (nginx) for production traffic

For more details, see [DEPLOYMENT.md](DEPLOYMENT.md).
