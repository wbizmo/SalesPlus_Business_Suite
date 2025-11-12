const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: () => ipcRenderer.invoke('force-go-live'),
  getPendingCount: () => {
    try { return document.querySelectorAll('form[data-pending="true"]').length; } 
    catch (e) { return 0; }
  }
});

(function() {
  let isOfflineBlocked = false;

  function showToast(message, color = '#333', autoHide = false) {
    try {
      let t = document.getElementById('__sp_net_toast');
      if (!t) {
        t = document.createElement('div');
        t.id = '__sp_net_toast';
        t.style.cssText = `
          position:fixed;top:18px;right:18px;
          padding:10px 14px;border-radius:8px;
          box-shadow:0 3px 12px rgba(0,0,0,0.18);
          z-index:2147483647;font-family:Inter, system-ui, sans-serif;
          font-weight:600;transition:opacity .15s, transform .15s;
          opacity:1;transform:translateY(0)
        `;
        document.body.appendChild(t);
      }
      t.style.background = color;
      t.style.color = '#fff';
      t.textContent = message;
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
      isOfflineBlocked = (color === '#ff4d4f'); // offline = red
      if (autoHide) {
        setTimeout(() => {
          try { t.style.opacity = '0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); isOfflineBlocked=false; } catch(e){}
        }, 2000);
      }
    } catch (e) {}
  }

  function hideToast() {
    try {
      const t = document.getElementById('__sp_net_toast');
      if (t) { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); isOfflineBlocked=false; }
    } catch (e) {}
  }

  // Block fetch/XHR while offline
  const originalFetch = window.fetch;
  window.fetch = (...args) => {
    if (isOfflineBlocked || !navigator.onLine) return Promise.reject(new Error('Offline — request blocked'));
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(...args) {
    if (isOfflineBlocked || !navigator.onLine) return;
    return originalOpen.apply(this, args);
  };

  // Block form submissions while offline
  document.addEventListener('submit', ev => {
    if (isOfflineBlocked || !navigator.onLine) {
      ev.preventDefault();
      showToast('Offline — your action will resume when online', '#ff4d4f');
    }
  }, true);

  // Online/offline events
  ipcRenderer.on('network-offline', () => showToast('Offline — your action will resume when online', '#ff4d4f'));
  ipcRenderer.on('network-online', () => showToast('Back online — resumed', '#22c55e', true));

})();
