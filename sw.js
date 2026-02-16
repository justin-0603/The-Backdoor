self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : { title: '알림', body: '메시지가 도착했습니다.' };
    event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon.png' }));
});
