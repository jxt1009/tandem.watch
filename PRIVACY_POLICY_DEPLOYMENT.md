# Privacy Policy Deployment Complete

## Status ✅

The privacy policy for tandem.watch has been successfully deployed to your Kubernetes cluster.

**Current Status:**
- ✅ Privacy policy HTML deployed
- ✅ Kubernetes Service running (`privacy-policy-service`)
- ✅ Ingress configured for `privacy.toper.dev`
- ✅ cert-manager TLS configured (automatic HTTPS with Let's Encrypt)

## Deployment Details

**Namespace:** default

**Resources Created:**
```
ConfigMap: privacy-policy-html           (HTML content)
ConfigMap: privacy-policy-nginx-config   (Nginx configuration)
Deployment: privacy-policy-server        (Nginx container)
Service: privacy-policy-service          (Service exposing port 80)
Ingress: privacy-policy-ingress          (Ingress for privacy.toper.dev)
```

**Pod Status:**
```
privacy-policy-server-55dc574c8c-bcjfs   Running
```

## What You Need to Do

### Step 1: Update DNS (Required)
Add a DNS CNAME record pointing `privacy.toper.dev` to your ingress controller's external IP or hostname.

Check your ingress controller address:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```

Add DNS record:
```
privacy.toper.dev  CNAME  <your-ingress-controller-ip-or-hostname>
```

Or add an A record if you have your external IP:
```
privacy.toper.dev  A  <external-ip>
```

### Step 2: Verify HTTPS Certificate
Once DNS resolves, cert-manager will automatically provision an SSL certificate from Let's Encrypt.

Check certificate status:
```bash
kubectl get certificate privacy-toper-dev-tls
kubectl describe certificate privacy-toper-dev-tls
```

### Step 3: Use the URL in Chrome Web Store
Once DNS is configured and HTTPS is live, use this URL when submitting to the Chrome Web Store:

```
https://privacy.toper.dev
```

## Chrome Web Store Submission Data

When Google Chrome Web Store asks for your privacy policy URL:
- **URL:** `https://privacy.toper.dev`
- **Data Collection Summary:**
  - ✅ Personal Communications (WebRTC video/audio)
  - ✅ User Activity (Netflix playback monitoring)
  - ✅ Website Content (Netflix page interaction)
  - ❌ No personally identifiable information collected
  - ❌ No user data sold or transferred

## Updating the Privacy Policy

To update the privacy policy in the future:

1. Edit the HTML in the ConfigMap:
```bash
kubectl edit configmap privacy-policy-html
```

2. The pod will automatically pick up changes, or force a restart:
```bash
kubectl rollout restart deployment/privacy-policy-server
```

## Rollback if Needed

Remove the entire deployment:
```bash
kubectl delete -f k8s/privacy-policy.yaml
```

Or delete individual resources:
```bash
kubectl delete configmap privacy-policy-html
kubectl delete configmap privacy-policy-nginx-config
kubectl delete deployment privacy-policy-server
kubectl delete service privacy-policy-service
kubectl delete ingress privacy-policy-ingress
```

## Files Created

- `PRIVACY_POLICY.md` - Markdown version (in repo)
- `k8s/privacy-policy.yaml` - Kubernetes manifest
- `deploy_privacy_policy.sh` - Manual deployment script (if needed)

---

**Next:** Configure your DNS records, then test https://privacy.toper.dev
