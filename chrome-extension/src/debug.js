// Debug helper - Add this to extension to test initialization
// Run in console: chrome.runtime.sendMessage({type: 'DEBUG_STATUS'}, console.log)

export function addDebugCommands() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'DEBUG_STATUS') {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        url: window.location.href,
        isNetflix: window.location.origin.includes('netflix'),
        hasBGService: !!window.backgroundService,
        contentScriptReady: !!window.__tandemWatchReady,
        wsConnected: window.wsConnected || false,
        partyActive: window.partyActive || false,
      };
      console.log('[Debug]', debugInfo);
      sendResponse(debugInfo);
    }
  });
}

addDebugCommands();
