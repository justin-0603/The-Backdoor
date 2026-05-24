/**
 * THE BACKDOOR - MAIN SERVER CORE
 * Version: v2
 * Port Configuration: Strictly locked to 5000 as mandated.
 * Language Directive: All terminal logs and API structures are fully in English.
 */

// ====================================================================
// MODULE DEPENDENCIES & REQUIRE MATRIX
// Role: Imports core engines for Discord API, Supabase DB, WebSockets, and Web Server layout.
// ====================================================================
const { Client, GatewayIntentBits, PermissionsBitField } = require("discord.js");
const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");
const express = require("express");
const session = require("express-session");
const path = require("path");

// ====================================================================
// EXPRESS EXPRESS APPLICATION INITIALIZATION
// Role: Initializes the framework instance and injects standard JSON body parsing middleware.
// ====================================================================
const app = express();
app.use(express.json());

// ====================================================================
// SESSION MANAGEMENT MATRIX
// Role: Configures signed cookie storage lasting 24 hours to secure client state logs.
// ====================================================================
app.use(
    session({
        secret: "backdoor-omega-v14-ultra-secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 },
    }),
);

// ====================================================================
// ENVIRONMENT CONFIGURATION INGESTION
// Role: Extracts configuration tokens safely from Replit Secrets and strips whitespaces.
// ====================================================================
const SUPABASE_URL = (process.env["SUPABASE_URL"] || process.env["SUPBASE_URL"])?.trim();
const SUPABASE_KEY = (process.env["SUPABASE_KEY"] || process.env["SUPBASE_KEY"])?.trim();
const DISCORD_TOKEN = process.env["DISCORD_TOKEN"]?.trim();

// ====================================================================
// ENVIRONMENT DIAGNOSTIC MATRIX
// Role: Validates the presence of crucial infrastructure keys before executing boot sequence.
// ====================================================================
if (!SUPABASE_URL || !SUPABASE_KEY || !DISCORD_TOKEN) {
    console.error("\n❌ [CRITICAL ERROR] Missing configuration in Replit Secrets!");
    console.error("====== SECRETS DIAGNOSTIC REPORT ======");
    console.error(`> SUPABASE_URL: ${SUPABASE_URL ? "🟢 LOADED SUCCESS" : "❌ MISSING OR EMPTY"}`);
    console.error(`> SUPABASE_KEY: ${SUPABASE_KEY ? "🟢 LOADED SUCCESS" : "❌ MISSING OR EMPTY"}`);
    console.error(`> DISCORD_TOKEN: ${DISCORD_TOKEN ? "🟢 LOADED SUCCESS" : "❌ MISSING OR EMPTY"}`);
    console.error("=======================================\n");
    process.exit(1); 
}

// Target Guild Identification lock pointer
const FIXED_SERVER_ID = "1464312221591933014";

// ====================================================================
// EXTERNAL SERVICES INITIALIZATION
// Role: Configures Supabase client with WebSocket overrides and instantiates Discord gateway listener.
// ====================================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { transport: ws },
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// ====================================================================
// DISCORD GATEWAY INTERCEPTOR: MESSAGE CREATE EVENT
// Role: Monitors live guild text flows, resolves priority display nicknames, and inserts logs into DB.
// ====================================================================
client.on("messageCreate", async (message) => {
    if (message.author.bot && message.webhookId === null) return;
    if (message.guildId !== FIXED_SERVER_ID) return;

    try {
        let finalSenderName = message.author.username;
        if (message.member && message.member.displayName) {
            finalSenderName = message.member.displayName;
        } else if (message.author.displayName) {
            finalSenderName = message.author.displayName;
        }

        await supabase.from("messages").insert({
            message_id: message.id,
            channel_id: message.channelId,
            username: finalSenderName,
            content: message.content || (message.attachments.size > 0 ? message.attachments.first().url : ""),
            is_discord: true,
            avatar_url: message.author.displayAvatarURL({ extension: "png", size: 128 }),
            created_at: new Date(message.createdTimestamp).toISOString(),
        });
    } catch (e) {
        console.error("Database Sync Error:", e.message);
    }
});

// ====================================================================
// SECURITY WALL MIDDLEWARE (ROUTE GUARD)
// Role: Intercepts inbound traffic; forces unauthenticated traffic to slide back into login gate.
// ====================================================================
const requireLogin = (req, res, next) => {
    if (req.session && req.session.user) return next();
    if (req.path === "/login.html" || req.path === "/auth/login" || req.path === "/auth/signup") return next();
    res.redirect("/login.html");
};

// ====================================================================
// STATIC CONTENT & HOMEPAGE ROUTING
// Role: Binds route access points to stream index layout files and shared assets securely.
// ====================================================================
app.get("/", requireLogin, (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.use(requireLogin, express.static(path.join(__dirname)));

// ====================================================================
// API ENDPOINT: ACCOUNT REGISTRATION (/auth/signup)
// Role: Registers unique operator profiles into remote table grids after identity duplicate check.
// ====================================================================
app.post("/auth/signup", async (req, res) => {
    const { username, password, displayName, discordId } = req.body;
    if (!username || !password || !displayName || !discordId) {
        return res.status(400).json({ error: "Missing required registration parameters." });
    }

    try {
        const { data: existingUser } = await supabase
            .from("users")
            .select("username")
            .eq("username", username.toLowerCase())
            .maybeSingle();

        if (existingUser) {
            return res.status(400).json({ error: "Identity profile already registered." });
        }

        const { error } = await supabase.from("users").insert({
            username: username.toLowerCase(),
            password: password, 
            display_name: displayName,
            discord_id: discordId
        });

        if (error) throw error;
        res.json({ success: true, message: "Operator registered successfully." });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====================================================================
// API ENDPOINT: CREDENTIAL VALIDATION (/auth/login)
// Role: Validates user identity parameters, fetches live avatar maps, and builds cookie tracking payloads.
// ====================================================================
app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Missing authorization credentials." });
    }

    try {
        const { data: user, error } = await supabase
            .from("users")
            .select("*")
            .eq("username", username.toLowerCase())
            .eq("password", password)
            .maybeSingle();

        if (error || !user) {
            return res.status(401).json({ error: "Access denied. Invalid credentials." });
        }

        let avatarURL = "https://cdn.discordapp.com/embed/avatars/0.png";
        try {
            const discordUser = await client.users.fetch(user.discord_id);
            avatarURL = discordUser.displayAvatarURL({ extension: "png", size: 128 });
        } catch (_) {}

        req.session.user = {
            username: user.username,
            displayName: user.display_name,
            id: user.discord_id,
            avatarURL: avatarURL
        };

        req.session.save(() => res.json({ success: true }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====================================================================
// API ENDPOINT: SESSION DESTRUCTION (/auth/logout)
// Role: Terminates persistent operator cookie trails and routes back to authentication root.
// ====================================================================
app.get("/auth/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/login.html"));
});

// ====================================================================
// API ENDPOINTS: CONFIGURATION & IDENTITY UTILITIES
// Role: Exposes active login tokens and infrastructure variables safely to internal scripts.
// ====================================================================
app.get("/session", (req, res) => res.json(req.session.user || null));
app.get("/supabase-config", (req, res) => res.json({ url: SUPABASE_URL, key: SUPABASE_KEY }));

// ====================================================================
// API ENDPOINT: CHANNEL LIST EXTRACTION (/get-channels)
// Role: Cross-references target server structures with active user permissions to expose legible text channels.
// ====================================================================
app.get("/get-channels", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ channels: [] });
    try {
        const guild = await client.guilds.fetch(FIXED_SERVER_ID);
        const member = await guild.members.fetch(req.session.user.id);
        const channels = await guild.channels.fetch();
        const filtered = channels
            .filter((c) => c && c.type === 0 && c.permissionsFor(member).has(PermissionsBitField.Flags.ViewChannel))
            .map((c) => ({ id: c.id, name: c.name }));
        res.json({ channels: filtered });
    } catch (e) {
        res.json({ channels: [] });
    }
});

// ====================================================================
// API ENDPOINT: FULL HISTORY INGESTION (/get-messages)
// Role: Pulls complete structural index records ordered sequentially upon channel focus transitions.
// ====================================================================
app.get("/get-messages", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Unauthorized access." });
    const { channelId } = req.query;
    const { data: msgs } = await supabase
        .from("messages")
        .select("*")
        .eq("channel_id", channelId)
        .order("id", { ascending: true });
    res.json({ messages: msgs || [] });
});

// ====================================================================
// API ENDPOINT: INCREMENTAL STREAM POLLING (/get-new-messages)
// Role: Provides a zero-latency fetch core by extracting only data logs sitting beyond the last row ID pointer.
// ====================================================================
app.get("/get-new-messages", async (req, res) => {
    if (!req.session.user) return res.status(401).json({ error: "Unauthorized access." });
    const { channelId, lastId } = req.query;

    if (!channelId || !lastId) {
        return res.status(400).json({ error: "Missing required tracking parameters." });
    }

    const { data: freshMsgs } = await supabase
        .from("messages")
        .select("*")
        .eq("channel_id", channelId)
        .gt("id", parseInt(lastId))
        .order("id", { ascending: true });

    res.json({ messages: freshMsgs || [] });
});

// ====================================================================
// API ENDPOINT: CHAT WEBHOOK TRANSMISSION (/send)
// Role: Resolves channel webhooks to cast text/image payloads under the user's custom layout display identity.
// ====================================================================
app.post("/send", async (req, res) => {
    if (!req.session.user) return res.status(401).send();
    const { content, channelId, imageUrl } = req.body;
    try {
        const channel = await client.channels.fetch(channelId);
        const webhooks = await channel.fetchWebhooks();
        let webhook = webhooks.find((wh) => wh.owner.id === client.user.id) || await channel.createWebhook({ name: "Backdoor" });

        const payload = {
            username: req.session.user.displayName,
            avatarURL: req.session.user.avatarURL,
        };

        if (imageUrl) {
            payload.content = content || "";
            payload.files = [imageUrl];
        } else {
            payload.content = content;
        }

        await webhook.send(payload);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ====================================================================
// SERVICE INITIATION SEQUENCES
// Role: Wakes up the Discord client instance gateway and binds the Express server engine to local port 5000.
// ====================================================================
client.once("ready", () => console.log("THE BACKDOOR - Bot status: ONLINE"));
client.login(DISCORD_TOKEN);

app.listen(5000, "0.0.0.0", () => console.log("Server running on port 5000"));
