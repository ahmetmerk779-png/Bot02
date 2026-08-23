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

// --- ÇOKLU BOT VE LOG DEĞİŞKENLERİ ---
let multiBots = [];
let systemLogs = []; // Terminal log hafızası

const defaultRandomChats = ['sa', 'as', 'selam', 'heyy', 'naber', 'gg', 'kolay gelsin', 'bot degilim', 'mrb'];
const clientBrands = ['vanilla', 'lunarclient:v2.16.0', 'fabric', 'forge'];

function getTimestamp() {
    const now = new Date();
    return now.toTimeString().split(' ')[0];
}

function addSystemLog(tag, message, color = 'info') {
    const time = getTimestamp();
    const logEntry = { time, tag, message, color };
    systemLogs.push(logEntry);
    if (systemLogs.length > 150) systemLogs.shift();
}

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

function emulateHumanBehavior(instance) {
    if (!instance || !instance.entity) return;
    try {
        const yaw = (Math.random() * 360 - 180) * (Math.PI / 180);
        const pitch = (Math.random() * 60 - 30) * (Math.PI / 180);
        instance.look(yaw, pitch, true);
        if (Math.random() > 0.5) instance.swingArm('right');
    } catch (e) {}
}

function startBotMovement(botObj) {
    if (!botObj.enableMove) return;
    botObj.moveTimer = setInterval(() => {
        if (!botObj.instance || !botObj.instance.entity) return;
        emulateHumanBehavior(botObj.instance);

        const controls = ['forward', 'back', 'left', 'right', 'jump'];
        const randomControl = controls[Math.floor(Math.random() * controls.length)];
        
        try {
            botObj.instance.setControlState(randomControl, true);
            setTimeout(() => {
                if (botObj.instance) botObj.instance.setControlState(randomControl, false);
            }, 600 + Math.random() * 1000);
        } catch (e) {}
    }, 3500 + Math.random() * 3000);
}

function startBotChat(botObj) {
    if (!botObj.enableChat) return;
    botObj.chatTimer = setInterval(() => {
        if (!botObj.instance || !botObj.instance.entity) return;
        const msg = botObj.customChat || defaultRandomChats[Math.floor(Math.random() * defaultRandomChats.length)];
        try { botObj.instance.chat(msg); } catch (e) {}
    }, 15000 + Math.random() * 15000);
}

function spawnSingleMultiBot(botObj) {
    if (botObj.stoppedExplicitly) return;

    clearBotTimers(botObj);
    botObj.status = 'Bağlanıyor...';
    addSystemLog('BAĞLANTI', `${botObj.username} sunucuya bağlanıyor... (${botObj.host})`, 'info');

    const randomBrand = clientBrands[Math.floor(Math.random() * clientBrands.length)];

    try {
        const mb = mineflayer.createBot({
            host: botObj.host || 'play.aesirmc.com',
            port: 25565,
            username: botObj.username,
            version: botObj.version || '1.21.11',
            fakeHost: botObj.host || 'play.aesirmc.com',
            checkTimeoutInterval: 120 * 1000,
            brand: randomBrand,
            viewDistance: 'normal',
            physicsEnabled: true,
            hideErrors: true
        });

        if (mb._client) mb._client.on('error', () => {});
        botObj.instance = mb;

        mb.once('spawn', () => {
            botObj.status = 'Bağlı';
            addSystemLog('BAŞARILI', `🟢 ${botObj.username} sunucuya giriş yaptı!`, 'success');

            // Otomatik Giriş / Kayıt İşlemi
            if (botObj.password) {
                setTimeout(() => {
                    mb.chat(`/register ${botObj.password} ${botObj.password}`);
                    mb.chat(`/login ${botObj.password}`);
                    addSystemLog('AUTH', `${botObj.username} için otogiriş/kayıt komutları gönderildi.`, 'info');
                }, 1500);
            }

            setTimeout(() => emulateHumanBehavior(mb), 600);
            startBotMovement(botObj);
            startBotChat(botObj);
        });

        mb.on('messagestr', (msg) => {
            const cleaned = cleanText(msg);
            if (cleaned && (cleaned.toLowerCase().includes('register') || cleaned.toLowerCase().includes('login') || cleaned.toLowerCase().includes('captcha') || cleaned.toLowerCase().includes('güvenlik'))) {
                addSystemLog('CHAT/DURUM', `[${botObj.username}] ${cleaned}`, 'warning');
            }
        });

        const handleDisconnect = (reasonText, type = 'error') => {
            clearBotTimers(botObj);
            if (botObj.stoppedExplicitly) return;

            addSystemLog('KOPMA', `🔴 [${botObj.username}] ${reasonText}`, type);

            if (botObj.autoReconnect) {
                botObj.status = 'Oto Yeniden Bağlanıyor...';
                const reconnectDelay = 6000 + Math.random() * 5000;
                botObj.reconnectTimer = setTimeout(() => {
                    spawnSingleMultiBot(botObj);
                }, reconnectDelay);
            } else {
                botObj.status = reasonText || 'Kapalı';
            }
        };

        mb.on('kicked', (reason) => handleDisconnect(`Atıldı: ${cleanText(reason)}`, 'error'));
        mb.on('error', (err) => handleDisconnect(`Hata: ${err ? err.message : 'Bilinmeyen Hata'}`, 'error'));
        mb.on('end', () => handleDisconnect('Bağlantı Kesildi', 'warning'));

    } catch (e) {
        botObj.status = 'Başlatma Hatası';
        addSystemLog('HATA', `[${botObj.username}] Başlatma hatası: ${e.message}`, 'error');
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
    const { host, username, password, version } = req.body;
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
            brand: 'lunarclient:v2.16.0',
            viewDistance: 'normal',
            physicsEnabled: true,
            hideErrors: true
        });

        if (bot._client) bot._client.on('error', () => {});

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Sunucuya girildi!');
            setTimeout(() => emulateHumanBehavior(bot), 600);
            if (password) setTimeout(() => bot.chat(`/login ${password}`), 1200);
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

// --- ÇOKLU BOT VE TERMINAL ENDPOINTLERİ ---
app.get('/api/multibot/status', (req, res) => {
    const list = multiBots.map(b => ({
        username: b.username,
        status: b.status
    }));

    const connectedCount = multiBots.filter(b => b.status === 'Bağlı').length;
    const connectingCount = multiBots.filter(b => b.status.includes('Bağlanıyor') || b.status === 'Sıraya Alındı').length;
    const failedCount = multiBots.filter(b => b.status.includes('Atıldı') || b.status.includes('Hata')).length;

    res.json({ 
        bots: list, 
        logs: systemLogs,
        stats: { connected: connectedCount, connecting: connectingCount, failed: failedCount, total: multiBots.length }
    });
});

app.post('/api/multibot/start', (req, res) => {
    const { host, version, count, prefix, password, customChat, enableMove, enableChat, autoReconnect } = req.body;
    const botCount = Math.max(parseInt(count) || 1, 1);

    addSystemLog('SİSTEM', `🚀 ${botCount} adet çoklu bot kuyruğa ekleniyor...`, 'info');

    for (let i = 0; i < botCount; i++) {
        const delay = i * (3500 + Math.random() * 3500);
        
        setTimeout(() => {
            const username = getRandomName(prefix || 'Bot');
            const botObj = {
                id: Date.now() + Math.random(),
                username: username,
                host: host || 'play.aesirmc.com',
                version: version || '1.21.11',
                password: password || '',
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
        }, delay);
    }

    res.json({ success: true });
});

app.post('/api/multibot/command', (req, res) => {
    const { command } = req.body;
    if (!command) return res.json({ success: false });

    addSystemLog('TOPLU KOMUT', `Tüm botlara gönderildi: ${command}`, 'warning');

    multiBots.forEach(b => {
        try {
            if (b.instance && b.instance.entity) {
                b.instance.chat(command);
            }
        } catch (e) {}
    });

    res.json({ success: true });
});

// TOPLU AKSİYONLAR (Toplu Zıpla, Eğil, Respawn vb.)
app.post('/api/multibot/action', (req, res) => {
    const { action } = req.body;
    
    multiBots.forEach(b => {
        if (!b.instance || !b.instance.entity) return;
        try {
            if (action === 'jump') {
                b.instance.setControlState('jump', true);
                setTimeout(() => { if (b.instance) b.instance.setControlState('jump', false); }, 500);
            } else if (action === 'sneak') {
                const current = b.instance.getControlState('sneak');
                b.instance.setControlState('sneak', !current);
            } else if (action === 'respawn') {
                b.instance.respawn();
            }
        } catch (e) {}
    });

    addSystemLog('TOPLU EYLEM', `Tüm botlara eylem uygulandı: ${action}`, 'info');
    res.json({ success: true });
});

app.post('/api/multibot/stop', (req, res) => {
    addSystemLog('SİSTEM', `⛔ Tüm çoklu botlar durduruluyor...`, 'warning');
    multiBots.forEach(b => {
        b.stoppedExplicitly = true;
        clearBotTimers(b);
        try { if (b.instance) b.instance.end(); } catch (e) {}
    });
    multiBots = [];
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`[RENDER] Sunucu ${PORT} portunda aktif.`));
