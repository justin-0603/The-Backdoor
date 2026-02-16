const { Client, GatewayIntentBits, Partials, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// [날카로운 지적] Render 배포 시 이 설정이 없으면 세션(로그인 유지)이 작동하지 않습니다.
app.set('trust proxy', 1);

app.use(session({ 
    secret: 'backdoor-production-secure-v2', 
    resave: false,           // 불필요한 세션 저장 방지
    saveUninitialized: false, // 빈 세션 저장 방지
    cookie: { 
        secure: true,        // HTTPS 환경이므로 true 필수
        sameSite: 'lax',     // Discord OAuth2 리디렉션 호환성
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7일간 로그인 유지
    } 
}));

const SUPABASE_URL = process.env['SUPABASE_URL']?.trim();
const SUPABASE_KEY = process.env['SUPABASE_KEY']?.trim();
const DISCORD_TOKEN = process.env['DISCORD_TOKEN']?.trim();
const CLIENT_ID = process.env['DISCORD_CLIENT_ID']?.trim();
const CLIENT_SECRET = process.env['DISCORD_CLIENT_SECRET']?.trim();

// [중요] 개인 도메인 주소로 확정
const REDIRECT_URI = 'https://the-backdoor.kro.kr/auth/callback'; 
const FIXED_SERVER_ID = '1464312221591933014'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildWebhooks
    ],
    partials: [Partials.Message, Partials.Channel] 
});

const formatName = (n) => n ? n.trim().toLowerCase() : "";

// 로그인 시작
app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

// OAuth2 콜백
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided.");

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, 
            client_secret: CLIENT_SECRET, 
            grant_type: 'authorization_code', 
            code, 
            redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } 
        });
        
        const finalUser = formatName(userRes.data.username);
        
        // Supabase 유저 정보 업데이트
        await supabase.from('users').upsert({ 
            username: finalUser, 
            discord_id: userRes.data.id, 
            avatar: userRes.data.avatar 
        });

        // 세션에 유저 저장
        req.session.user = { 
            username: finalUser, 
            id: userRes.data.id, 
            avatar: userRes.data.avatar 
        };
        
        req.session.save((err) => {
            if (err) return res.status(500).send("Session Save Error");
            res.redirect('/');
        });
    } catch (e) {
        console.error("Login Error Details:", e.response?.data || e.message);
        res.status(500).send("Login Failed. Check logs for details.");
    }
});

app.get('/session', (req, res) => res.json(req.session.user || null));
app.get('/supabase-config', (req, res) => res.json({ url: SUPABASE_URL, key: SUPABASE_KEY }));

// 채널 목록 가져오기
app.get('/get-channels', async (req, res) => {
    if (!req.session.user) return res.json({ channels: [] });
    const myName = formatName(req.session.user.username);
    const { data: permissions } = await supabase.from('channel_permissions').select('channel_id').eq('username', myName);
    if (!permissions) return res.json({ channels: [] });
    
    const allowedIds = permissions.map(p => p.channel_id);
    const guild = await client.guilds.fetch(FIXED_SERVER_ID);
    const allChannels = await guild.channels.fetch();
    const filtered = allChannels.filter(c => c && c.type === 0 && allowedIds.includes(c.id)).map(c => ({ id: c.id, name: c.name }));
    res.json({ channels: filtered });
});

// 메시지 내역 가져오기
app.get('/get-messages', async (req, res) => {
    const { channelId } = req.query;
    try {
        const { data: msgs } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: true });
        const { data: users } = await supabase.from('users').select('username, avatar, discord_id');
        const userMap = {};
        if (users) users.forEach(u => { userMap[u.username] = u; });
        
        const formatted = (msgs || []).map(m => ({
            ...m,
            avatar: userMap[m.username]?.avatar || null,
            discord_id: userMap[m.username]?.discord_id || null
        }));
        res.json({ messages: formatted });
    } catch (e) {
        res.json({ messages: [] });
    }
});

// 메시지 전송 (Webhook 활용)
app.post('/send', async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { content, channelId } = req.body;
    const { username, id: discordId, avatar } = req.session.user;
    
    try {
        const channel = await client.channels.fetch(channelId);
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner.id === client.user.id);
        if (!webhook) webhook = await channel.createWebhook({ name: 'Backdoor' });
        
        const avatarURL = avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png` : null;
        const sentMsg = await webhook.send({ content, username, avatarURL });
        
        await supabase.from('messages').insert({ 
            message_id: sentMsg.id, username, content, channel_id: channelId, is_discord: false 
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 터널(비밀 채널) 생성
app.post('/link-tunnel', async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { targetUsers } = req.body;
    const creatorName = formatName(req.session.user.username);
    
    try {
        const guild = await client.guilds.fetch(FIXED_SERVER_ID);
        const members = await guild.members.fetch();
        
        let overwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel] },
            { id: req.session.user.id, allow: [PermissionFlagsBits.ViewChannel] }
        ];
        
        let dbEntries = [{ username: creatorName, server_id: FIXED_SERVER_ID }];
        
        targetUsers.forEach(u => {
            const formatted = formatName(u);
            const member = members.find(m => m.user.username.toLowerCase() === formatted);
            if (member) {
                overwrites.push({ id: member.id, allow: [PermissionFlagsBits.ViewChannel] });
                dbEntries.push({ username: formatted, server_id: FIXED_SERVER_ID });
            }
        });

        const channel = await guild.channels.create({ 
            name: targetUsers.join('-').substring(0, 100), 
            type: 0, 
            permissionOverwrites: overwrites 
        });
        
        await supabase.from('channel_permissions').insert(
            dbEntries.map(e => ({ ...e, channel_id: channel.id }))
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 디스코드 메시지 실시간 수집
client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    try {
        await supabase.from('messages').upsert({ 
            message_id: m.id, 
            username: formatName(m.author.username), 
            content: m.content, 
            is_discord: true, 
            channel_id: m.channel.id 
        });
    } catch (e) {
        console.error("Msg Sync Error:", e.message);
    }
});

client.once('ready', () => {
    console.log(`Bot Ready: ${client.user.tag}`);
    console.log(`Production URL: ${REDIRECT_URI}`);
});

client.login(DISCORD_TOKEN);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
