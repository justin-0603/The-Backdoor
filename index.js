const { Client, GatewayIntentBits, Partials, PermissionFlagsBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Replit 세션 설정
app.use(session({ 
    secret: 'replit-backdoor-auth-v1', 
    resave: false, 
    saveUninitialized: false,
    cookie: { 
        secure: false, // Replit 무료 티어는 HTTP 환경일 수 있어 false 권장
        maxAge: 1000 * 60 * 60 * 24 
    } 
}));

const SUPABASE_URL = process.env['SUPABASE_URL']?.trim();
const SUPABASE_KEY = process.env['SUPABASE_KEY']?.trim();
const DISCORD_TOKEN = process.env['DISCORD_TOKEN']?.trim();
const CLIENT_ID = process.env['DISCORD_CLIENT_ID']?.trim();
const CLIENT_SECRET = process.env['DISCORD_CLIENT_SECRET']?.trim();

// [중요] Replit 주소로 변경 필요 (예: https://프로젝트이름.본인아이디.repl.co/auth/callback)
const REDIRECT_URI = `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/auth/callback`;
const FIXED_SERVER_ID = '1464312221591933014'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
    ]
});

const formatName = (n) => n ? n.trim().toLowerCase() : "";

app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

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
        await supabase.from('users').upsert({ username: finalUser, discord_id: userRes.data.id, avatar: userRes.data.avatar });

        req.session.user = { username: finalUser, id: userRes.data.id, avatar: userRes.data.avatar };
        req.session.save(() => res.redirect('/'));
    } catch (e) {
        res.status(500).send("Login Failed.");
    }
});

app.get('/session', (req, res) => res.json(req.session.user || null));
app.get('/supabase-config', (req, res) => res.json({ url: SUPABASE_URL, key: SUPABASE_KEY }));

app.get('/get-channels', async (req, res) => {
    if (!req.session.user) return res.json({ channels: [] });
    const myName = formatName(req.session.user.username);
    const { data: permissions } = await supabase.from('channel_permissions').select('channel_id').eq('username', myName);
    if (!permissions) return res.json({ channels: [] });
    
    const guild = await client.guilds.fetch(FIXED_SERVER_ID);
    const allChannels = await guild.channels.fetch();
    const filtered = allChannels.filter(c => c && c.type === 0 && permissions.some(p => p.channel_id === c.id)).map(c => ({ id: c.id, name: c.name }));
    res.json({ channels: filtered });
});

app.get('/get-messages', async (req, res) => {
    const { channelId } = req.query;
    const { data: msgs } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: true });
    const { data: users } = await supabase.from('users').select('username, avatar, discord_id');
    const userMap = {};
    if (users) users.forEach(u => userMap[u.username] = u);
    res.json({ messages: (msgs || []).map(m => ({ ...m, avatar: userMap[m.username]?.avatar, discord_id: userMap[m.username]?.discord_id })) });
});

app.post('/send', async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { content, channelId } = req.body;
    const { username, id: discordId, avatar } = req.session.user;
    
    const channel = await client.channels.fetch(channelId);
    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.owner.id === client.user.id) || await channel.createWebhook({ name: 'Backdoor' });
    
    const avatarURL = avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png` : null;
    const sentMsg = await webhook.send({ content, username, avatarURL });
    
    await supabase.from('messages').insert({ message_id: sentMsg.id, username, content, channel_id: channelId, is_discord: false });
    res.json({ success: true });
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    await supabase.from('messages').upsert({ message_id: m.id, username: formatName(m.author.username), content: m.content, is_discord: true, channel_id: m.channel.id });
});

client.login(DISCORD_TOKEN);
app.listen(8080, () => console.log('Replit Server Running...'));
