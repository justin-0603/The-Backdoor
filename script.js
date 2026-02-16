let currentChannelId = null;
let myName = "";
let supabaseClient = null;

async function init() {
    try {
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

        const userDisplay = document.getElementById('user-display');
        const myAvatarUrl = user.avatar 
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : `https://api.dicebear.com/7.x/identicon/svg?seed=${myName}`;

        userDisplay.innerHTML = `<img src="${myAvatarUrl}" style="width:32px; height:32px; border-radius:50%;"> <span>${myName}</span>`;

        const configRes = await fetch('/supabase-config');
        const config = await configRes.json();
        supabaseClient = supabase.createClient(config.url, config.key);

        await loadChannels();
        setupRealtime();

        document.getElementById('msg-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    } catch (err) {
        console.error("Initialization failed:", err);
    }
}

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
                    <div class="msg-author">${m.username}</div>
                    <div class="msg-content">${m.content}</div>
                </div>
            </div>
        `;
    }).join('');
}

async function selectChannel(id, name) {
    currentChannelId = id;
    document.getElementById('active-channel-name').innerText = `# ${name}`;
    document.querySelectorAll('.channel-item').forEach(el => el.classList.toggle('active', el.innerText.includes(name)));
    await refreshMessages();
    setTimeout(() => scrollToBottom(false), 50);
}

function scrollToBottom(smooth = false) {
    const chatBox = document.getElementById('chat-box');
    chatBox.scrollTo({ top: chatBox.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function sendMessage() {
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text || !currentChannelId) return;
    input.value = ""; 
    await fetch('/send', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ content: text, channelId: currentChannelId }) 
    });
}

async function loadChannels() {
    const res = await fetch('/get-channels');
    const data = await res.json();
    const list = document.getElementById('channel-list');
    if (data.channels) {
        list.innerHTML = data.channels.map(c => `
            <div class="channel-item" onclick="selectChannel('${c.id}', '${c.name}')"># ${c.name}</div>
        `).join('');
    }
}

async function createGroupTunnel() {
    const input = prompt("Invite users (comma separated):");
    if (!input) return;
    await fetch('/link-tunnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetUsers: input.split(',').map(s => s.trim()) }) });
    setTimeout(loadChannels, 1500);
}

init();
