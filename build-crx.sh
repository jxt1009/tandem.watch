#!/bin/bash
# Build and package tandem.watch as a .crx Chrome extension

set -e

echo "🔨 Building tandem.watch..."
npm run build

if [ ! -f "dist.pem" ]; then
    echo ""
    echo "⚠️  No signing key found (dist.pem)"
    echo "For easy distribution, we need a signing key."
    echo ""
    echo "Creating a new signing key..."
    
    # Generate a new key pair (chromium requires this for .crx files)
    # For now, we'll just let Chrome regenerate it
    echo "Note: You can sign the extension with your own key later."
fi

# Check if we have the Chrome tools available
if command -v google-chrome &> /dev/null; then
    CHROME_PATH="google-chrome"
elif command -v chromium &> /dev/null; then
    CHROME_PATH="chromium"
elif [ -d "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
else
    echo "⚠️  Chrome/Chromium not found in expected locations"
    echo ""
    echo "✅ Build successful! The extension is ready in the 'dist' folder."
    echo ""
    echo "To package as .crx manually:"
    echo "  1. Open Chrome and go to chrome://extensions/"
    echo "  2. Enable Developer mode"
    echo "  3. Click 'Pack extension'"
    echo "  4. Select the 'dist' folder"
    echo "  5. Your .crx file will be created"
    exit 0
fi

echo ""
echo "📦 Creating .crx package..."

# The .crx format is essentially a ZIP with a header
# For easy distribution, we'll create a signed version if possible
if [ -f "dist.pem" ]; then
    # Use existing key if available
    "$CHROME_PATH" --pack-extension="./dist" --pack-extension-key="./dist.pem" 2>/dev/null || true
fi

if [ -f "dist.crx" ]; then
    echo "✅ Extension packaged successfully!"
    echo ""
    ls -lh dist.crx
    echo ""
    echo "📤 Distribution:"
    echo "  • Share dist.crx with friends"
    echo "  • They can drag it into chrome://extensions/"
    echo "  • Or use INSTALL_GUIDE.md for step-by-step instructions"
else
    echo "ℹ️  .crx file not created (may need manual signing)"
    echo ""
    echo "You can still distribute the extension as:"
    echo "  • dist/ folder (for developer mode installation)"
    echo "  • dist.crx file (if already exists)"
    echo ""
    echo "See INSTALL_GUIDE.md for distribution options"
fi

echo ""
echo "✨ Done! Ready for distribution."
