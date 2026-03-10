/**
 * BACKDOOR SERVICE WORKER
 * Role: Manages background life-cycles and handles user interaction with desktop notifications.
 */
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    console.log('Service Worker: ACTIVE');
});

// [NOTIFICATION HANDLER] Focuses the messenger tab when a notification is clicked
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(clientsArr => {
            // Find existing tab and focus it, or open a new one
            if (clientsArr.length > 0) return clientsArr[0].focus();
            return clients.openWindow('/');
        })
    );
});
