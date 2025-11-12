const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: () => ipcRenderer.invoke('force-go-live'),
  getPendingCount: () => {
    try {
      return document.querySelectorAll('form[data-pending="true"]').length;
    } catch (e) {
      return 0;
    }
  }
});

// --- Unified renderer-side network/offline helper ---
(function() {
  // Toast helper
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
      if (autoHide) {
        setTimeout(() => {
          try { t.style.opacity = '0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); } catch (e) {}
        }, 2000);
      }
    } catch (e) {}
  }

  function hideToast() {
    try {
      const t = document.getElementById('__sp_net_toast');
      if (t) { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); }
    } catch (e) {}
  }

  // --- Form pending handling ---
  function markFormPending(form) {
    try {
      form.dataset.pending = 'true';
      try {
        const fd = new FormData(form);
        const entries = {};
        for (const [k, v] of fd.entries()) entries[k] = v;
        form.__sp_pending_serialized = entries;
      } catch (e) { form.__sp_pending_serialized = null; }
      showToast('Offline — your action will resume when online', '#ff4d4f');
    } catch (e) {}
  }

  function tryResubmitForm(form) {
    try {
      form.dataset.pending = 'false';
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);
      if (typeof form.submit === 'function') {
        try { form.submit(); } catch (e) {}
      }
      hideToast();
      showToast('Back online — resumed', '#22c55e', true);
    } catch (e) { console.warn('Resubmit failed for form', e); }
  }

  // --- Intercept all forms ---
  function attachFormInterceptor() {
    document.addEventListener('submit', (ev) => {
      try {
        const form = ev.target;
        if (!navigator.onLine) {
          ev.preventDefault();
          markFormPending(form);
        }
      } catch (e) {}
    }, true);
  }

  // --- Online/offline event handlers ---
  function attachOnlineHandler() {
    window.addEventListener('online', () => {
      try {
        const pending = Array.from(document.querySelectorAll('form[data-pending="true"]'));
        if (pending.length === 0) {
          showToast('Back online', '#22c55e', true);
          return;
        }
        showToast('Back online — resuming actions...', '#22c55e');
        pending.forEach(f => tryResubmitForm(f));
      } catch (e) {}
    });
  }

  function attachOfflineHandler() {
    window.addEventListener('offline', () => {
      showToast('Offline — actions will be resumed when connection returns', '#ff4d4f');
    });
  }

  // --- Initialize on DOM ready ---
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    attachFormInterceptor();
    attachOnlineHandler();
    attachOfflineHandler();
  } else {
    window.addEventListener('DOMContentLoaded', () => {
      attachFormInterceptor();
      attachOnlineHandler();
      attachOfflineHandler();
    }, { once: true });
  }

  // --- Debug helpers ---
  try {
    window.__sp_network_helpers = {
      forceGoLive: () => ipcRenderer.invoke('force-go-live'),
      markPendingForAllForms: () => {
        document.querySelectorAll('form').forEach(f => markFormPending(f));
      }
    };
  } catch (e) {}
})();
