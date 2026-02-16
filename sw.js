// sw.js - 푸시 알림 수신 대기
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : { title: '새 메시지', body: '내용이 없습니다.' };
    
    const options = {
        body: data.body,
        icon: '/icon.png', // 아이콘이 있다면 경로 지정
        badge: '/badge.png',
        vibrate: [100, 50, 100],
        data: {
            url: data.url || '/'
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 알림 클릭 시 해당 채널이나 사이트로 이동
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});
