// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: () => ipcRenderer.invoke('force-go-live'),
  // optional: check pending count (useful for UI)
  getPendingCount: () => {
    try {
      return document.querySelectorAll('form[data-pending="true"]').length;
    } catch (e) {
      return 0;
    }
  }
});

// Renderer-side helper: intercept form submissions, mark pending when offline,
// auto-resubmit on online, and show inline toast immediately.
(function() {
  // Utility: create/update inline toast (keeps consistent with main's id)
  function showToast(message, color, autoHide = false) {
    try {
      let t = document.getElementById('__sp_net_toast');
      if (!t) {
        t = document.createElement('div');
        t.id = '__sp_net_toast';
        t.style.cssText = "position:fixed;top:18px;right:18px;padding:10px 14px;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,0.18);z-index:2147483647;font-family:Inter, system-ui, sans-serif;font-weight:600;transition:opacity .15s, transform .15s;opacity:1;transform:translateY(0)";
        document.body.appendChild(t);
      }
      t.style.background = color || '#333';
      t.style.color = '#fff';
      t.textContent = message;
      t.style.opacity = '1';
      t.style.transform = 'translateY(0)';
      if (autoHide) {
        setTimeout(() => {
          try { t.style.opacity = '0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); } catch (e) {}
        }, 2000);
      }
    } catch (e) {
      // DOM might not be ready
    }
  }

  function hideToast() {
    try {
      const t = document.getElementById('__sp_net_toast');
      if (t) { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); }
    } catch (e) {}
  }

  // mark forms pending & store minimal state
  function markFormPending(form) {
    try {
      form.dataset.pending = 'true';
      // optionally store form data in memory for retry (simple approach)
      try {
        const fd = new FormData(form);
        const entries = {};
        for (const [k, v] of fd.entries()) {
          entries[k] = v;
        }
        form.__sp_pending_serialized = entries;
      } catch (e) {
        // ignore serialization errors
        form.__sp_pending_serialized = null;
      }
      showToast('⚠️ Offline — your action will resume when online', '#ff4d4f', false);
    } catch (e) {}
  }

  // try to resubmit a form element
  function tryResubmitForm(form) {
    try {
      // If the original page uses JS handlers, we attempt to dispatch native submit
      form.dataset.pending = 'false';
      const event = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(event);

      // Fallback: if the form has action and method and default submit hasn't fired,
      // attempt to programmatically submit (may be blocked by preventDefault in app logic)
      if (typeof form.submit === 'function') {
        try {
          form.submit();
        } catch (e) {
          // some frameworks override submit; ignore
        }
      }

      hideToast();
      showToast('✅ Back online — resumed', '#22c55e', true);
    } catch (e) {
      console.warn('Resubmit failed for form', e);
    }
  }

  // Intercept submits early (capture) to mark pending if offline
  function attachFormInterceptor() {
    document.addEventListener('submit', (ev) => {
      try {
        const form = ev.target;
        if (!navigator.onLine) {
          ev.preventDefault();
          // mark pending so we can resume later
          markFormPending(form);
        }
      } catch (e) {}
    }, true); // capture phase to catch early
  }

  // On online: auto-resume all pending forms
  function attachOnlineHandler() {
    window.addEventListener('online', () => {
      try {
        const pending = Array.from(document.querySelectorAll('form[data-pending="true"]'));
        if (pending.length === 0) {
          // still show toast to match main behavior
          showToast('✅ Back online', '#22c55e', true);
          return;
        }
        // show small toast and attempt to resubmit each form
        showToast('✅ Back online — resuming actions...', '#22c55e', false);
        pending.forEach(f => {
          tryResubmitForm(f);
        });
      } catch (e) {}
    });
  }

  function attachOfflineHandler() {
    window.addEventListener('offline', () => {
      showToast('⚠️ Offline — actions will be resumed when connection returns', '#ff4d4f', false);
    });
  }

  // Attach when DOM ready
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

  // Also expose a small debug helper on window (optional)
  try {
    window.__sp_network_helpers = {
      forceGoLive: () => ipcRenderer.invoke('force-go-live'),
      markPendingForAllForms: () => {
        document.querySelectorAll('form').forEach(f => markFormPending(f));
      }
    };
  } catch (e) {}
})();
