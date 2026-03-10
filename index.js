/**
 * BACKDOOR SERVER CORE
 * Role: Handles Discord Bot events, User Sessions, and Webhook dispatching.
 */
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// [SESSION MANAGEMENT] Keeps the user logged in for 24 hours
app.use(session({ 
    secret: 'backdoor-omega-v11-ultra-secret', 
    resave: false, 
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 } 
}));

const SUPABASE_URL = process.env['SUPABASE_URL']?.trim();
const SUPABASE_KEY = process.env['SUPABASE_KEY']?.trim();
const DISCORD_TOKEN = process.env['DISCORD_TOKEN']?.trim();
const CLIENT_ID = process.env['DISCORD_CLIENT_ID']?.trim();
const CLIENT_SECRET = process.env['DISCORD_CLIENT_SECRET']?.trim();

const REDIRECT_URI = "https://the-backdoor--choigeonhwi0603.replit.app/auth/callback";
const FIXED_SERVER_ID = '1464312221591933014'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers 
    ] 
});

// [BOT EVENT: MESSAGE SYNC] Captures Discord messages and mirrors them to Supabase DB
client.on('messageCreate', async (message) => {
    if (message.author.bot && message.webhookId === null) return;
    if (message.guildId !== FIXED_SERVER_ID) return;

    try {
        await supabase.from('messages').insert({
            message_id: message.id,
            channel_id: message.channelId,
            username: message.author.username,
            // Capture text content or the first attachment URL if text is empty
            content: message.content || (message.attachments.size > 0 ? message.attachments.first().url : ""),
            is_discord: true,
            avatar_url: message.author.displayAvatarURL({ extension: 'png', size: 128 }),
            created_at: new Date(message.createdTimestamp).toISOString()
        });
    } catch (e) { console.error("Database Sync Error:", e.message); }
});

// [AUTH: LOGIN] Redirects user to Discord Authorization page
app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

// [AUTH: CALLBACK] Handles token exchange and user profile retrieval
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID, client_secret: CLIENT_SECRET, 
            grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const userRes = await axios.get('https://discord.com/api/users/@me', { 
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` } 
        });

        const { id, username, avatar } = userRes.data;
        const avatarURL = avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : "https://cdn.discordapp.com/embed/avatars/0.png";

        req.session.user = { username: username.toLowerCase(), id, avatar, avatarURL };
        req.session.save(() => res.redirect('/'));
    } catch (e) { res.status(500).send("Login Failed: " + e.message); }
});

// [AUTH: LOGOUT] Destroys the session
app.get('/auth/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// [API: SYSTEM DATA] Provides configuration and session info to the frontend
app.get('/session', (req, res) => res.json(req.session.user || null));
app.get('/supabase-config', (req, res) => res.json({ url: SUPABASE_URL, key: SUPABASE_KEY }));

// [API: CHANNELS] Fetches available text channels from the specific Discord Server
app.get('/get-channels', async (req, res) => {
    if (!req.session.user) return res.json({ channels: [] });
    try {
        const guild = await client.guilds.fetch(FIXED_SERVER_ID);
        const member = await guild.members.fetch(req.session.user.id);
        const channels = await guild.channels.fetch();
        const filtered = channels
            .filter(c => c && c.type === 0 && c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel))
            .map(c => ({ id: c.id, name: c.name }));
        res.json({ channels: filtered });
    } catch (e) { res.json({ channels: [] }); }
});

// [API: MESSAGES] Retrieves historical messages from Supabase
app.get('/get-messages', async (req, res) => {
    const { channelId } = req.query;
    const { data: msgs } = await supabase.from('messages').select('*').eq('channel_id', channelId).order('created_at', { ascending: true });
    res.json({ messages: msgs || [] });
});

// [API: SEND] Dispatches messages via Webhooks to Discord
app.post('/send', async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { content, channelId, imageUrl } = req.body;
    try {
        const channel = await client.channels.fetch(channelId);
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find(wh => wh.owner.id === client.user.id) || await channel.createWebhook({ name: 'Backdoor' });

        const payload = { 
            username: req.session.user.username, 
            avatarURL: req.session.user.avatarURL 
        };

        if (imageUrl) {
            payload.content = content || ""; 
            payload.files = [imageUrl]; 
        } else {
            payload.content = content;
        }

        await webhook.send(payload);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

client.once('ready', () => console.log('THE BACKDOOR - Bot status: ONLINE'));
client.login(DISCORD_TOKEN);
app.listen(3000, '0.0.0.0');
