#!/bin/bash
# Deploy privacy policy to privacy.toper.dev subdomain
# Run this on the server: ssh jtoper@10.0.0.102 'bash ~/deploy_privacy_policy.sh'

set -e

echo "Deploying privacy policy to privacy.toper.dev..."

# Copy privacy policy to web root
sudo cp /tmp/privacy_policy.html /var/www/html/privacy.html
echo "✓ Copied privacy.html to /var/www/html/"

# Create nginx config for privacy.toper.dev subdomain
sudo tee /etc/nginx/sites-available/privacy.toper.dev > /dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name privacy.toper.dev;

    root /var/www/html;
    index privacy.html;

    location / {
        try_files $uri $uri/ =404;
    }
    
    location = / {
        return 301 /privacy.html;
    }
}
NGINX
echo "✓ Created nginx config for privacy.toper.dev"

# Enable the site
sudo ln -sf /etc/nginx/sites-available/privacy.toper.dev /etc/nginx/sites-enabled/privacy.toper.dev 2>/dev/null || true
echo "✓ Enabled site in nginx"

# Test nginx config
echo "Testing nginx configuration..."
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
echo "✓ Reloaded nginx"

echo ""
echo "✅ Privacy policy deployed successfully!"
echo "   Access at: https://privacy.toper.dev"
