#!/bin/bash
# Easy Installation Script for tandem.watch Chrome Extension
# Usage: Run this script and it will guide you through installation

echo "================================"
echo "  tandem.watch Installation"
echo "================================"
echo ""
echo "This will install the extension into your Chrome browser."
echo ""

# Check if the .crx file exists
CRX_FILE="$(dirname "$0")/dist.crx"

if [ ! -f "$CRX_FILE" ]; then
    echo "❌ Error: Could not find dist.crx"
    echo "Make sure you're running this from the tandem.watch directory"
    exit 1
fi

echo "✓ Found extension file: $CRX_FILE"
echo ""
echo "Follow these steps to install:"
echo ""
echo "1. Open Chrome/Chromium browser"
echo "2. Go to: chrome://extensions/"
echo "3. Enable 'Developer mode' (toggle in top right)"
echo ""
echo "Option A - Drag & Drop (Easiest):"
echo "  • Open File Explorer/Finder"
echo "  • Navigate to: $(dirname "$CRX_FILE")"
echo "  • Drag 'dist.crx' onto the chrome://extensions/ tab"
echo ""
echo "Option B - Manual Installation:"
echo "  • Click 'Load unpacked'"
echo "  • Navigate to: $(dirname "$CRX_FILE")/dist/"
echo "  • Click 'Select Folder'"
echo ""
echo "Option C - Command Line (macOS/Linux):"
echo "  • Close Chrome completely"
CHROME_PATH=""
if [ -d "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    echo "  • Run: \"$CHROME_PATH\" --load-extension=\"$(dirname "$CRX_FILE")/dist/\""
elif command -v google-chrome &> /dev/null; then
    echo "  • Run: google-chrome --load-extension=\"$(dirname "$CRX_FILE")/dist/\""
else
    echo "  • Manually load the extension using Option A or B above"
fi

echo ""
echo "================================"
echo "Done! The extension is ready to use."
echo "Go to netflix.com and click the tandem.watch icon."
echo "================================"
