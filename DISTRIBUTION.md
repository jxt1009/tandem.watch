# tandem.watch Distribution Guide

Since you're only sharing with you and your girlfriend, here are the easiest options:

---

## 🎯 Recommended: Share the dist/ Folder (No Warnings!)

**Best for non-technical users** ✨

1. **Send her the folder**: `dist/` 
   - Zip it (`dist.zip`) if easier
   - Email, Dropbox, Google Drive, AirDrop, etc.

2. **She installs it** (see INSTALL_GUIDE.md):
   - Open Chrome → `chrome://extensions/`
   - Turn on "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder
   - Click "Select Folder"

**Pros:**
- No Chrome warnings ✨
- Simple installation
- Works offline
- Easy to update (just replace folder)

**Cons:**
- Slightly larger file size (multiple files vs single .crx)

---

## Alternative: Share the .crx File

If you prefer a single file:

1. **Send her the file**: `dist.crx` 
   - Email, Dropbox, Google Drive, AirDrop, etc.

2. **She installs it**:
   - Open Chrome → `chrome://extensions/`
   - Turn on "Developer mode"
   - Drag `dist.crx` onto the page
   - Click "Add extension"

**Pros:**
- Single file (47KB)
- One-click installation (drag & drop)

**Cons:**
- Chrome shows "not listed in Chrome Web Store" warning (harmless, just ignore it)

---

## Chrome Web Store (No Warnings, Auto-Updates)

If you wait for Chrome Web Store approval:

1. Share the link to your extension on Chrome Web Store
2. She clicks "Add to Chrome"
3. Done! No warnings, automatic updates

**Pros:**
- No warnings
- One-click installation
- Automatic updates

**Cons:**
- Wait for approval (can take a few days)

---

---

## FAQ

**Q: Can I just send her a link?**
- Not directly, but you can upload `dist.crx` to Dropbox/Drive and share the link

**Q: What if I update the extension?**
- Rebuild with `npm run build` → `./build-crx.sh` → share the new `dist.crx`

**Q: Do we both need to run the signaling server?**
- No, just one person runs it (you can run it on your server at `10.0.0.102`)
- She just needs the extension installed

**Q: Why not just submit to Chrome Web Store?**
- Chrome Web Store reviews all extensions and may take time
- For personal use with friends, the .crx method is way faster
- You already submitted for review anyway, so either way works!

---

**Ready to share? Just send her the `.crx` file + INSTALL_GUIDE.md** 🎉
