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
        msg.includes('EPIPE') ||
        msg.includes('write') ||
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
let systemLogs = [];

const defaultRandomChats = ['sa', 'as', 'selam', 'heyy', 'naber', 'gg', 'kolay gelsin', 'bot degilim', 'mrb'];

function getTimestamp() {
    return new Date().toTimeString().split(' ')[0];
}

function addSystemLog(tag, message, color = 'info') {
    systemLogs.push({ time: getTimestamp(), tag, message, color });
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
    if (botObj.authTimer1) clearTimeout(botObj.authTimer1);
    if (botObj.authTimer2) clearTimeout(botObj.authTimer2);
    botObj.moveTimer = null;
    botObj.chatTimer = null;
    botObj.reconnectTimer = null;
    botObj.authTimer1 = null;
    botObj.authTimer2 = null;
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
        if (!botObj.instance || !botObj.instance.entity || botObj.inQueue) return;
        emulateHumanBehavior(botObj.instance);

        const controls = ['forward', 'back', 'left', 'right', 'jump'];
        const randomControl = controls[Math.floor(Math.random() * controls.length)];
        
        try {
            botObj.instance.setControlState(randomControl, true);
            setTimeout(() => {
                if (botObj.instance) botObj.instance.setControlState(randomControl, false);
            }, 600 + Math.random() * 1000);
        } catch (e) {}
    }, 5000 + Math.random() * 3000);
}

function startBotChat(botObj) {
    if (!botObj.enableChat) return;
    botObj.chatTimer = setInterval(() => {
        if (!botObj.instance || !botObj.instance.entity || botObj.inQueue) return;
        const msg = botObj.customChat || defaultRandomChats[Math.floor(Math.random() * defaultRandomChats.length)];
        try { botObj.instance.chat(msg); } catch (e) {}
    }, 20000 + Math.random() * 10000);
}

function spawnSingleMultiBot(botObj) {
    if (botObj.stoppedExplicitly) return;

    if (!botObj.host) {
        botObj.status = 'IP Eksik!';
        addSystemLog('HATA', `[${botObj.username}] Sunucu adresi girilmedi!`, 'error');
        return;
    }

    clearBotTimers(botObj);
    botObj.status = 'Bağlanıyor...';
    botObj.inQueue = false;
    botObj.authDone = false;
    addSystemLog('BAĞLANTI', `${botObj.username} (${botObj.host}) sunucusuna bağlanıyor...`, 'info');

    try {
        const mb = mineflayer.createBot({
            host: botObj.host,
            port: 25565,
            username: botObj.username,
            version: botObj.version || '1.21.11',
            fakeHost: botObj.host,
            checkTimeoutInterval: 120 * 1000,
            brand: 'vanilla',
            viewDistance: 'tiny',
            physicsEnabled: false, // 🛡️ İlk girişte fizik kapalı
            hideErrors: true
        });

        if (mb._client) {
            mb._client.on('error', () => {});
            mb._client.on('end', () => {});
            if (mb._client.socket) mb._client.socket.on('error', () => {});
        }
        botObj.instance = mb;

        const handleAuthAction = () => {
            if (botObj.authDone || !botObj.password) return;
            botObj.authDone = true;
            
            botObj.authTimer1 = setTimeout(() => {
                if (mb && mb.entity) mb.chat(`/register ${botObj.password} ${botObj.password}`);
            }, 2000);

            botObj.authTimer2 = setTimeout(() => {
                if (mb && mb.entity) mb.chat(`/login ${botObj.password}`);
            }, 4500);
        };

        mb.on('spawn', () => {
            botObj.status = 'Bağlı';
            addSystemLog('BAŞARILI', `🟢 ${botObj.username} sunucuya girdi!`, 'success');
            
            // 🛡️ Sunucuya tamamen oturduktan sonra fiziği aç
            setTimeout(() => {
                if (mb && !botObj.inQueue) mb.physicsEnabled = true;
            }, 3000);

            if (!botObj.inQueue) handleAuthAction();
            startBotMovement(botObj);
            startBotChat(botObj);
        });

        // 🔄 Aktarım anında fiziği dondur
        mb.on('respawn', () => {
            botObj.inQueue = false;
            botObj.status = 'Sunucuya Aktarıldı';
            mb.physicsEnabled = false;
            try { mb.clearControlStates(); } catch (e) {}

            setTimeout(() => {
                if (mb) mb.physicsEnabled = true;
                handleAuthAction();
            }, 3500);
        });

        mb.on('messagestr', (msg) => {
            const cleaned = cleanText(msg);
            if (!cleaned) return;

            if (cleaned.includes('sırasına girdiniz') || cleaned.includes('Sıranız:')) {
                botObj.inQueue = true;
                botObj.status = 'Sırada Bekliyor';
                mb.physicsEnabled = false; // Sıradayken fizik yok
                try { mb.clearControlStates(); } catch (e) {}
            }

            if (cleaned.toLowerCase().includes('/register') || cleaned.toLowerCase().includes('/login')) {
                handleAuthAction();
            }
        });

        const handleDisconnect = (reasonText, type = 'error') => {
            clearBotTimers(botObj);
            if (botObj.stoppedExplicitly) return;

            addSystemLog('KOPMA', `🔴 [${botObj.username}] ${reasonText}`, type);

            if (botObj.autoReconnect) {
                botObj.status = 'Oto Bağlanıyor...';
                const reconnectDelay = 12000 + Math.random() * 6000;
                botObj.reconnectTimer = setTimeout(() => {
                    spawnSingleMultiBot(botObj);
                }, reconnectDelay);
            } else {
                botObj.status = reasonText || 'Kapalı';
            }
        };

        mb.on('kicked', (reason) => handleDisconnect(`Atıldı: ${cleanText(reason)}`, 'error'));
        mb.on('error', (err) => handleDisconnect(`Hata: ${err ? err.message : 'Bağlantı kesildi'}`, 'error'));
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
    
    if (!host) {
        addChatLog('[HATA] Sunucu adresi boş bırakılamaz!');
        return res.json({ success: false, message: 'IP boş' });
    }

    if (bot) { 
        try { bot.end(); } catch (e) {} 
        bot = null;
    }

    botStatus = 'Bağlanıyor...';
    addChatLog('[SİSTEM] Bot başlatılıyor...');
    let singleInQueue = false;
    let authSent = false;

    try {
        bot = mineflayer.createBot({
            host: host,
            port: 25565,
            username: username || 'OtonomBot',
            version: version || '1.21.11',
            fakeHost: host,
            checkTimeoutInterval: 120 * 1000,
            brand: 'vanilla',
            viewDistance: 'tiny',
            physicsEnabled: false, // 🛡️ Aktarım sırasında atılmayı önlemek için başlangıçta kapalı
            hideErrors: true
        });

        if (bot._client) {
            bot._client.on('error', () => {});
            bot._client.on('end', () => {});
            if (bot._client.socket) bot._client.socket.on('error', () => {});
        }

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        const executeSingleAuth = () => {
            if (authSent || !password) return;
            authSent = true;
            setTimeout(() => { if (bot && bot.entity) bot.chat(`/register ${password} ${password}`); }, 2000);
            setTimeout(() => { if (bot && bot.entity) bot.chat(`/login ${password}`); }, 4500);
        };

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Sunucuya girildi!');
            
            // 🛡️ Harita yüklendikten sonra hareket serbest
            setTimeout(() => {
                if (bot && !singleInQueue) bot.physicsEnabled = true;
            }, 3000);

            if (!singleInQueue) executeSingleAuth();
        });

        // 🔄 Aktarım anı (Proxy Switch)
        bot.on('respawn', () => {
            singleInQueue = false;
            botStatus = 'Aktarıldı';
            if (bot) bot.physicsEnabled = false; // Aktarım esnasında fiziki dondur
            try { bot.clearControlStates(); } catch (e) {}

            setTimeout(() => {
                if (bot) bot.physicsEnabled = true;
                executeSingleAuth();
            }, 3500);
        });

        bot.on('death', () => setTimeout(() => { try { if (bot) bot.respawn(); } catch (e) {} }, 1000));
        
        bot.on('messagestr', (message) => {
            const cleaned = cleanText(message);
            addChatLog(cleaned);

            if (cleaned.includes('sırasına girdiniz') || cleaned.includes('Sıranız:')) {
                singleInQueue = true;
                botStatus = 'Sırada';
                if (bot) bot.physicsEnabled = false;
                try { bot.clearControlStates(); } catch (e) {}
            }

            if (cleaned.toLowerCase().includes('/register') || cleaned.toLowerCase().includes('/login')) {
                executeSingleAuth();
            }
        });

        bot.on('kicked', (reason) => { botStatus = 'Atıldı'; addChatLog(`[KICK] ${cleanText(reason)}`); });
        bot.on('error', (err) => { 
            const msg = err ? err.message || '' : '';
            if (msg.includes('Read') || msg.includes('partial') || msg.includes('ECONNRESET') || msg.includes('EPIPE')) return;
            botStatus = 'Hata'; 
            addChatLog(`[HATA] ${msg}`); 
        });
        bot.on('end', () => { botStatus = 'Kapalı'; addChatLog('[SİSTEM] Bağlantı kesildi.'); });
    } catch (err) { botStatus = 'Hata'; }
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    if (bot) { try { bot.end(); } catch (e) {} bot = null; }
    botStatus = 'Kapalı';
    res.json({ success: true });
});

app.post('/api/command', (req, res) => {
    const { action } = req.body;
    if (!bot) return res.json({ success: false });
    if (action === 'jump') { bot.setControlState('jump', true); setTimeout(() => { if(bot) bot.setControlState('jump', false); }, 500); }
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

    const connectedCount = multiBots.filter(b => b.status === 'Bağlı' || b.status === 'Sunucuya Aktarıldı').length;
    const connectingCount = multiBots.filter(b => b.status.includes('Bağlanıyor') || b.status.includes('Sırada') || b.status.includes('Oto')).length;
    const failedCount = multiBots.filter(b => b.status.includes('Atıldı') || b.status.includes('Hata') || b.status.includes('Eksik')).length;

    res.json({ 
        bots: list, 
        logs: systemLogs,
        stats: { connected: connectedCount, connecting: connectingCount, failed: failedCount, total: multiBots.length }
    });
});

app.post('/api/multibot/start', (req, res) => {
    const { host, version, count, prefix, password, customChat, enableMove, enableChat, autoReconnect } = req.body;
    const botCount = Math.max(parseInt(count) || 1, 1);

    if (!host) {
        addSystemLog('HATA', `Lütfen geçerli bir IP / Sunucu Adresi girin!`, 'error');
        return res.json({ success: false, message: 'IP gerekli' });
    }

    addSystemLog('SİSTEM', `🚀 ${botCount} bot kademeli bağlantı kuyruğuna alındı...`, 'info');

    for (let i = 0; i < botCount; i++) {
        const delay = i * (7000 + Math.random() * 5000);
        
        setTimeout(() => {
            const username = getRandomName(prefix || 'Bot');
            const botObj = {
                id: Date.now() + Math.random(),
                username: username,
                host: host,
                version: version || '1.21.11',
                password: password || '',
                customChat: customChat || '',
                enableMove: enableMove !== false,
                enableChat: enableChat !== false,
                autoReconnect: autoReconnect !== false,
                instance: null,
                status: 'Sıraya Alındı',
                inQueue: false,
                authDone: false,
                stoppedExplicitly: false,
                moveTimer: null,
                chatTimer: null,
                reconnectTimer: null,
                authTimer1: null,
                authTimer2: null
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

    addSystemLog('TOPLU KOMUT', `Gönderildi: ${command}`, 'warning');

    multiBots.forEach(b => {
        try {
            if (b.instance && b.instance.entity) {
                b.instance.chat(command);
            }
        } catch (e) {}
    });

    res.json({ success: true });
});

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

    addSystemLog('TOPLU EYLEM', `Eylem uygulandı: ${action}`, 'info');
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
