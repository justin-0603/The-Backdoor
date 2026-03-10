/**
 * BACKDOOR CLIENT LOGIC
 * Role: Manages Realtime listeners, UI updates, and Service Worker registration.
 */
let currentChannelId = null;
let supabaseClient = null;
let messageSubscription = null;
let currentUser = null;

// [INITIALIZATION] Checks session and registers background workers
async function init() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }

    const res = await fetch('/session');
    const user = await res.json();

    if (user) {
        currentUser = user;
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-app').style.display = 'flex';
        document.getElementById('user-name').innerText = user.username;
        document.getElementById('user-avatar').src = user.avatarURL;

        const configRes = await fetch('/supabase-config');
        const config = await configRes.json();
        supabaseClient = supabase.createClient(config.url, config.key);

        if (Notification.permission !== "granted") Notification.requestPermission();
        loadChannels();
    }
}

// [CHANNELS] Loads channel list into the sidebar
async function loadChannels() {
    const res = await fetch('/get-channels');
    const data = await res.json();
    document.getElementById('channel-list').innerHTML = data.channels.map(ch => 
        `<li onclick="selectChannel('${ch.id}', '${ch.name}')"># ${ch.name}</li>`
    ).join('');
}

// [CHANNEL SWITCHING] Switches Realtime subscriptions when a channel is clicked
async function selectChannel(id, name) {
    if (currentChannelId === id) return;
    currentChannelId = id;
    document.getElementById('chat-header').innerText = `# ${name}`;

    if (messageSubscription) supabaseClient.removeChannel(messageSubscription);
    await loadMessages();

    // [REALTIME LISTENER] Triggers when a new row is inserted into Supabase 'messages' table
    messageSubscription = supabaseClient
        .channel(`room-${id}`)
        .on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'messages', 
            filter: `channel_id=eq.${id}` 
        }, payload => {
            appendMessage(payload.new);
            // [NOTIFICATIONS] Show push notification if user is on another tab
            if (document.hidden && payload.new.username !== currentUser.username) {
                new Notification(`#${name} - ${payload.new.username}`, {
                    body: payload.new.content,
                    icon: payload.new.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png"
                }).onclick = () => window.focus();
            }
        })
        .subscribe();
}

async function loadMessages() {
    const res = await fetch(`/get-messages?channelId=${currentChannelId}`);
    const data = await res.json();
    const container = document.getElementById('message-list');
    container.innerHTML = data.messages.map(m => createMessageHTML(m)).join('');
    container.scrollTop = container.scrollHeight;
}

// [IMAGE UPLOAD] Uploads file to Supabase Storage bucket
async function uploadToStorage(file) {
    const fileName = `${Date.now()}_${file.name}`;
    const { data, error } = await supabaseClient.storage
        .from('message-images')
        .upload(fileName, file);

    if (error) {
        alert("Upload Failed: " + error.message);
        return null;
    }
    const { data: { publicUrl } } = supabaseClient.storage.from('message-images').getPublicUrl(fileName);
    return publicUrl;
}

// [UI RENDERING] Generates HTML for chat bubbles, detecting if content is an image
function createMessageHTML(m) {
    const avatar = m.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png";
    let contentHTML = `<div class="msg-text">${m.content}</div>`;

    // Auto-render images if the content looks like a URL pointing to an image file
    if (m.content && m.content.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
        contentHTML = `<img src="${m.content}" class="chat-img" onclick="window.open('${m.content}')">`;
    }

    return `
        <div class="msg-row" id="msg-${m.id}">
            <img src="${avatar}" class="avatar-img">
            <div class="msg-detail">
                <span class="msg-author">${m.username}</span>
                ${contentHTML}
            </div>
        </div>
    `;
}

function appendMessage(m) {
    const container = document.getElementById('message-list');
    if (document.getElementById(`msg-${m.id}`)) return;
    container.insertAdjacentHTML('beforeend', createMessageHTML(m));
    container.scrollTop = container.scrollHeight;
}

// [LOGOUT UI] Toggles visibility of the logout button
function toggleLogoutMenu(e) {
    e.stopPropagation();
    document.getElementById('logout-dropdown').classList.toggle('dropdown-hidden');
}

window.onclick = () => document.getElementById('logout-dropdown').classList.add('dropdown-hidden');

// [MESSAGE SENDING] Gathers text and file data and sends to the server
async function sendMsg() {
    const input = document.getElementById('message-input');
    const imageInput = document.getElementById('image-input');

    if (!currentChannelId) return;

    let imageUrl = null;
    if (imageInput.files.length > 0) {
        imageUrl = await uploadToStorage(imageInput.files[0]);
        imageInput.value = ""; 
    }

    if (!input.value && !imageUrl) return;

    const content = input.value;
    input.value = '';

    await fetch('/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, channelId: currentChannelId, imageUrl })
    });
}

// [DRAG AND DROP] Allows dropping images directly onto the chat window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
            const url = await uploadToStorage(file);
            if (url) await fetch('/send', { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ content: "", channelId: currentChannelId, imageUrl: url }) 
            });
        }
    }
});

document.getElementById('send-btn').onclick = sendMsg;
document.getElementById('message-input').onkeypress = (e) => { if(e.key === 'Enter') sendMsg(); };
init();
