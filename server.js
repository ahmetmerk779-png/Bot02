const express = require('express');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// 🛡️ SESSİZ PAKET VE ÇÖKME HATA FİLTRESİ
process.on('uncaughtException', (err) => {
    const msg = err ? err.message || err.toString() : '';
    if (
        msg.includes('Read') || 
        msg.includes('chunk') || 
        msg.includes('protocol') || 
        msg.includes('PartialReadError') || 
        msg.includes('ECONNRESET') ||
        msg.includes('partial packet')
    ) {
        return;
    }
    console.error('[SİSTEM HAKİKİ HATA]', err);
});

process.on('unhandledRejection', () => {});

// --- TEKLİ BOT DEĞİŞKENLERİ ---
let bot = null;
let botStatus = 'Kapalı';
let chatLogs = [];
let radarText = 'Yakında kimse yok.';
let ping = '-';
let tps = '-';

// --- ÇOKLU BOT DEĞİŞKENLERİ VE YAPISI ---
let multiBots = []; // { id, username, host, version, customChat, enableMove, enableChat, autoReconnect, instance, status, stoppedExplicitly, moveTimer, chatTimer, reconnectTimer }

const defaultRandomChats = ['sa', 'as', 'selam', 'heyy', 'naber', 'gg', 'kolay gelsin', 'bot degilim', 'mrb'];

function cleanText(text) {
    if (!text) return '';
    if (typeof text === 'object') {
        try {
            if (text.toString && typeof text.toString === 'function' && text.toString() !== '[object Object]') {
                return text.toString().replace(/§[0-9a-fk-or]/gi, '').trim();
            }
            if (text.extra && Array.isArray(text.extra)) {
                return text.extra.map(e => cleanText(e)).join('').trim();
            }
            if (text.text) return cleanText(text.text);
            if (text.value) return cleanText(text.value);
            return JSON.stringify(text);
        } catch (e) { return String(text); }
    }
    if (typeof text === 'string' && text.startsWith('{')) {
        try { return cleanText(JSON.parse(text)); } catch (e) {}
    }
    return String(text).replace(/§[0-9a-fk-or]/gi, '').trim();
}

function addChatLog(msg) {
    const cleaned = cleanText(msg);
    if (cleaned) {
        chatLogs.push(cleaned);
        if (chatLogs.length > 50) chatLogs.shift();
    }
}

function getRandomName(prefix = 'Bot') {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
        suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}_${suffix}`;
}

function clearBotTimers(botObj) {
    if (botObj.moveTimer) clearInterval(botObj.moveTimer);
    if (botObj.chatTimer) clearInterval(botObj.chatTimer);
    if (botObj.reconnectTimer) clearTimeout(botObj.reconnectTimer);
    botObj.moveTimer = null;
    botObj.chatTimer = null;
    botObj.reconnectTimer = null;
}

// Çoklu Bot Hareket Döngüsü
function startBotMovement(botObj) {
    if (!botObj.enableMove) return;
    botObj.moveTimer = setInterval(() => {
        if (!botObj.instance || !botObj.instance.entity) return;
        const controls = ['forward', 'back', 'left', 'right', 'jump'];
        const randomControl = controls[Math.floor(Math.random() * controls.length)];
        
        try {
            botObj.instance.setControlState(randomControl, true);
            setTimeout(() => {
                if (botObj.instance) botObj.instance.setControlState(randomControl, false);
            }, 800 + Math.random() * 1200);
        } catch (e) {}
    }, 4000 + Math.random() * 4000);
}

// Çoklu Bot Konuşma Döngüsü
function startBotChat(botObj) {
    if (!botObj.enableChat) return;
    botObj.chatTimer = setInterval(() => {
        if (!botObj.instance || !botObj.instance.entity) return;
        const msg = botObj.customChat || defaultRandomChats[Math.floor(Math.random() * defaultRandomChats.length)];
        try { botObj.instance.chat(msg); } catch (e) {}
    }, 12000 + Math.random() * 15000);
}

// Tekil Çoklu Bot Oluşturma ve Bağlama
function spawnSingleMultiBot(botObj) {
    if (botObj.stoppedExplicitly) return;

    clearBotTimers(botObj);
    botObj.status = 'Bağlanıyor...';

    try {
        const mb = mineflayer.createBot({
            host: botObj.host || 'play.aesirmc.com',
            port: 25565,
            username: botObj.username,
            version: botObj.version || '1.21.11',
            fakeHost: botObj.host || 'play.aesirmc.com',
            checkTimeoutInterval: 120 * 1000,
            brand: 'vanilla',
            viewDistance: 'tiny',
            physicsEnabled: true,
            hideErrors: true
        });

        if (mb._client) mb._client.on('error', () => {});
        botObj.instance = mb;

        mb.once('spawn', () => {
            botObj.status = 'Bağlı';
            startBotMovement(botObj);
            startBotChat(botObj);
        });

        const handleDisconnect = (reasonText) => {
            clearBotTimers(botObj);
            if (botObj.stoppedExplicitly) return;

            if (botObj.autoReconnect) {
                botObj.status = 'Oto Yeniden Bağlanıyor (5s)...';
                botObj.reconnectTimer = setTimeout(() => {
                    spawnSingleMultiBot(botObj);
                }, 5000 + Math.random() * 3000);
            } else {
                botObj.status = reasonText || 'Kapalı';
            }
        };

        mb.on('kicked', (reason) => handleDisconnect(`Atıldı: ${cleanText(reason)}`));
        mb.on('error', () => handleDisconnect('Hata'));
        mb.on('end', () => handleDisconnect('Bağlantı Kesildi'));

    } catch (e) {
        botObj.status = 'Başlatma Hatası';
    }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ui.html')));

app.get('/api/status', (req, res) => {
    if (bot && bot.player) ping = bot.player.ping || '-';
    res.json({
        online: !!(bot && bot.entity),
        statusText: botStatus,
        ping: ping,
        tps: tps,
        chatLogs: chatLogs,
        radar: radarText
    });
});

// --- TEKLİ BOT ENDPOINTLERİ ---
app.post('/api/start', (req, res) => {
    const { groqKey, host, username, password, version } = req.body;
    if (bot) { try { bot.end(); } catch (e) {} }

    botStatus = 'Bağlanıyor...';
    addChatLog('[SİSTEM] Bot başlatılıyor...');

    try {
        bot = mineflayer.createBot({
            host: host || 'play.aesirmc.com',
            port: 25565,
            username: username || 'OtonomBot',
            version: version || '1.21.11',
            fakeHost: host || 'play.aesirmc.com',
            checkTimeoutInterval: 120 * 1000,
            brand: 'vanilla',
            viewDistance: 'tiny',
            physicsEnabled: true,
            hideErrors: true
        });

        if (bot._client) bot._client.on('error', () => {});

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Sunucuya girildi!');
            if (password) setTimeout(() => bot.chat(`/login ${password}`), 1000);
        });

        bot.on('death', () => setTimeout(() => { try { bot.respawn(); } catch (e) {} }, 1000));
        bot.on('messagestr', (message) => addChatLog(message));
        bot.on('kicked', (reason) => { botStatus = 'Atıldı'; addChatLog(`[KICK] ${cleanText(reason)}`); });
        bot.on('error', (err) => { 
            const msg = err.message || '';
            if (msg.includes('Read') || msg.includes('partial') || msg.includes('ECONNRESET')) return;
            botStatus = 'Hata'; 
            addChatLog(`[HATA] ${msg}`); 
        });
        bot.on('end', () => { botStatus = 'Kapalı'; addChatLog('[SİSTEM] Bağlantı kesildi.'); });
    } catch (err) { botStatus = 'Hata'; }
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    if (bot) { bot.end(); bot = null; }
    botStatus = 'Kapalı';
    res.json({ success: true });
});

app.post('/api/command', (req, res) => {
    const { action } = req.body;
    if (!bot) return res.json({ success: false });
    if (action === 'jump') { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); }
    else if (action === 'sneak') { bot.setControlState('sneak', !bot.getControlState('sneak')); }
    else if (action === 'stop') { bot.clearControlStates(); try { bot.pathfinder.stop(); } catch (e) {} try { bot.pvp.stop(); } catch (e) {} }
    else if (action === 'attack') {
        const target = bot.nearestEntity(e => e.type === 'player' && e !== bot.entity);
        if (target) try { bot.pvp.attack(target); } catch (e) {}
    }
    res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
    if (bot && req.body.message) bot.chat(req.body.message);
    res.json({ success: true });
});

// --- ÇOKLU BOT ENDPOINTLERİ ---
app.get('/api/multibot/status', (req, res) => {
    const list = multiBots.map(b => ({
        username: b.username,
        status: b.status
    }));
    res.json({ bots: list });
});

app.post('/api/multibot/start', (req, res) => {
    const { host, version, count, prefix, customChat, enableMove, enableChat, autoReconnect } = req.body;
    const botCount = Math.max(parseInt(count) || 1, 1); // 🛑 SINIR KALDIRILDI!

    for (let i = 0; i < botCount; i++) {
        setTimeout(() => {
            const username = getRandomName(prefix || 'Bot');
            const botObj = {
                id: Date.now() + Math.random(),
                username: username,
                host: host || 'play.aesirmc.com',
                version: version || '1.21.11',
                customChat: customChat || '',
                enableMove: enableMove !== false,
                enableChat: enableChat !== false,
                autoReconnect: autoReconnect !== false,
                instance: null,
                status: 'Sıraya Alındı',
                stoppedExplicitly: false,
                moveTimer: null,
                chatTimer: null,
                reconnectTimer: null
            };

            multiBots.push(botObj);
            spawnSingleMultiBot(botObj);
        }, i * 1800); // Sunucu ip/rate-limit ban yememek için kademeli giriş
    }

    res.json({ success: true });
});

app.post('/api/multibot/stop', (req, res) => {
    multiBots.forEach(b => {
        b.stoppedExplicitly = true;
        clearBotTimers(b);
        try { if (b.instance) b.instance.end(); } catch (e) {}
    });
    multiBots = [];
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`[RENDER] Sunucu ${PORT} portunda aktif.`));
