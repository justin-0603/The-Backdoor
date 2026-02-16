// 예시: 아래 icon.png와 badge.png는 실제 파일이 없더라도 코드가 작동하도록 경로만 예시로 넣은 것입니다.
let currentChannelId = null;
let myName = "";
let supabaseClient = null;

// 1. Service Worker 등록 및 푸시 알림 권한 요청
if ('serviceWorker' in navigator && 'PushManager' in window) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js').then(function(registration) {
            console.log('ServiceWorker 등록 성공:', registration.scope);
            
            // 알림 권한 요청
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    console.log('알림 권한 허용됨');
                } else {
                    console.warn('알림 권한이 거부되었습니다.');
                }
            });
        }, function(err) {
            console.error('ServiceWorker 등록 실패:', err);
        });
    });
}

// 2. 초기화 함수
async function init() {
    try {
        // 캐시 방지를 위해 no-store 사용
        const res = await fetch('/session', { cache: 'no-store' });
        const user = await res.json();
        
        const authCont = document.getElementById('auth-container');
        const mainCont = document.getElementById('main-container');

        if (!user || !user.username) {
            authCont.classList.remove('hidden');
            mainCont.classList.add('hidden');
            return;
        }

        myName = user.username;
        authCont.classList.add('hidden');
        mainCont.classList.remove('hidden');

        // 상단 유저 정보 표시
        const userDisplay = document.getElementById('user-display');
        const myAvatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : `https://api.dicebear.com/7.x/identicon/svg?seed=${myName}`;
        
        userDisplay.innerHTML = `
            <img src="${myAvatarUrl}" style="width:32px; height:32px; border-radius:50%; margin-right:8px;">
            <span style="font-weight:bold;">${myName}</span>
        `;

        // Supabase 설정 가져오기 및 클라이언트 초기화
        const configRes = await fetch('/supabase-config');
        const config = await configRes.json();
        supabaseClient = supabase.createClient(config.url, config.key);

        await loadChannels();
        setupRealtime();

        // 엔터키 메시지 전송 이벤트
        document.getElementById('msg-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

// 3. Supabase 실시간 구독 설정
function setupRealtime() {
    supabaseClient
        .channel('chat_realtime')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
            if (payload.new.channel_id === currentChannelId) {
                await refreshMessages();
                scrollToBottom(true);
            }
        })
        .subscribe();
}

// 4. 메시지 새로고침
async function refreshMessages() {
    if (!currentChannelId) return;
    const res = await fetch(`/get-messages?channelId=${currentChannelId}`);
    const data = await res.json();
    const chatBox = document.getElementById('chat-box');
    
    chatBox.innerHTML = (data.messages || []).map(m => {
        const avatarUrl = (m.avatar && m.discord_id) 
            ? `https://cdn.discordapp.com/avatars/${m.discord_id}/${m.avatar}.png`
            : `https://api.dicebear.com/7.x/identicon/svg?seed=${m.username}`;
        
        return `
            <div class="msg-row">
                <img src="${avatarUrl}" class="msg-avatar">
                <div class="msg-body">
                    <div class="msg-author">${m.username} ${m.is_discord ? '<span class="tag-discord">Discord</span>' : ''}</div>
                    <div class="msg-content">${m.content}</div>
                </div>
            </div>
        `;
    }).join('');
}

// 5. 채널 선택
async function selectChannel(id, name) {
    currentChannelId = id;
    document.getElementById('active-channel-name').innerText = `# ${name}`;
    
    // 활성화된 채널 표시 스타일 변경
    document.querySelectorAll('.channel-item').forEach(el => {
        el.classList.toggle('active', el.innerText.includes(name));
    });

    await refreshMessages();
    setTimeout(() => scrollToBottom(false), 50);
}

// 6. 스크롤 하단 이동
function scrollToBottom(smooth = false) {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

// 7. 메시지 전송
async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !currentChannelId) return;
    
    input.value = ""; 
    try {
        await fetch('/send', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ content: text, channelId: currentChannelId }) 
        });
    } catch (e) {
        console.error("Message send error:", e);
    }
}

// 8. 채널 목록 불러오기
async function loadChannels() {
    const res = await fetch('/get-channels');
    const data = await res.json();
    const list = document.getElementById('channel-list');
    if (data.channels && data.channels.length > 0) {
        list.innerHTML = data.channels.map(c => `
            <div class="channel-item" onclick="selectChannel('${c.id}', '${c.name}')"># ${c.name}</div>
        `).join('');
    } else {
        list.innerHTML = '<div style="padding:10px; font-size:12px; color:#888;">참여 가능한 채널이 없습니다.</div>';
    }
}

// 9. 터널(비밀 채널) 생성 팝업
async function createGroupTunnel() {
    const input = prompt("초대할 유저의 Discord 이름을 쉼표(,)로 구분해 입력하세요:");
    if (!input) return;
    
    const targetUsers = input.split(',').map(s => s.trim());
    try {
        await fetch('/link-tunnel', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ targetUsers }) 
        });
        alert("터널이 생성되었습니다. 목록을 갱신합니다.");
        setTimeout(loadChannels, 2000);
    } catch (e) {
        alert("터널 생성 실패: " + e.message);
    }
}

// 실행
init();
