const { contextBridge, ipcRenderer } = require('electron');

function showToast(msg, duration = 3000) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #323232;
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    z-index: 9999;
    font-size: 14px;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    opacity: 0;
    transition: opacity 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => (toast.style.opacity = 1), 50);
  setTimeout(() => {
    toast.style.opacity = 0;
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

window.addEventListener('online', () => {
  showToast('Connection restored. Reconnecting...', 2500);

  // Automatically resubmit offline forms
  document.querySelectorAll('form[data-pending="true"]').forEach((form) => {
    form.removeAttribute('data-pending');
    form.submit();
  });

  ipcRenderer.invoke('force-go-live');
});

window.addEventListener('offline', () => {
  showToast('You are offline. Changes will be saved locally.', 2500);
});

window.addEventListener('submit', (e) => {
  if (!navigator.onLine) {
    e.preventDefault();
    e.target.setAttribute('data-pending', 'true');
    showToast('Offline — form will auto-submit when connection returns.');
  }
}, true);

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: async () => {
    try {
      return await ipcRenderer.invoke('force-go-live');
    } catch {
      return false;
    }
  },
});
