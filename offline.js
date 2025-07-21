// Simple offline action queue
const pendingActions = JSON.parse(localStorage.getItem('pendingActions') || '[]');

function savePendingActions() {
  localStorage.setItem('pendingActions', JSON.stringify(pendingActions));
}

export function queueAction(action) {
  pendingActions.push(action);
  savePendingActions();
}

export async function processQueue() {
  for (let i = 0; i < pendingActions.length; i++) {
    const { url, options } = pendingActions[i];
    try {
      await fetch(url, { ...options, credentials: "include" });
      pendingActions.splice(i, 1);
      i--;
    } catch (e) {
      console.warn('Offline queue failed', e);
    }
  }
  savePendingActions();
}

window.addEventListener('online', processQueue);
if (typeof window !== 'undefined') {
  window.queueAction = queueAction;
  window.processQueue = processQueue;
}

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(error => {
    console.warn('Service Worker registration failed:', error.message);
  });
}
