const express = require('express');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// 🛡️ CHUNK, PROTOKOL VE SUNUCU GEÇİŞ (BUNGEECORD / VELOCITY) ÇÖKME KORUMASI
process.on('uncaughtException', (err) => {
    const msg = err ? err.message || err.toString() : '';
    if (msg.includes('Read') || msg.includes('chunk') || msg.includes('protocol') || msg.includes('PartialReadError') || msg.includes('ECONNRESET')) {
        console.log('[KORUMA] Ağ/Paket hatası engellendi:', msg);
        return;
    }
    console.error('[SİSTEM HAKİKİ HATA]', err);
});

process.on('unhandledRejection', (reason) => {
    console.log('[KORUMA] Promise hatası engellendi:', reason);
});

let bot = null;
let botStatus = 'Kapalı';
let chatLogs = [];
let radarText = 'Yakında kimse yok.';
let ping = '-';
let tps = '-';

let lastProcessedTime = 0;
function canProcessMessage() {
    const now = Date.now();
    if (now - lastProcessedTime < 3500) return false;
    lastProcessedTime = now;
    return true;
}

// 🛡️ Derinlemesine JSON Kick ve Chat Temizleme
function cleanText(text) {
    if (!text) return '';
    
    if (typeof text === 'object') {
        try {
            if (text.text) text = text.text;
            else if (text.value) text = text.value;
            else text = JSON.stringify(text);
        } catch (e) {
            text = String(text);
        }
    }

    if (typeof text === 'string' && text.startsWith('{')) {
        try {
            const parsed = JSON.parse(text);
            if (parsed.text) text = parsed.text;
            else if (parsed.value) text = parsed.value;
            else if (parsed.extra) text = parsed.extra.map(e => e.text || e).join('');
        } catch (e) {}
    }

    return String(text).replace(/§[0-9a-fk-or]/gi, '').trim();
}

function addChatLog(msg) {
    chatLogs.push(cleanText(msg));
    if (chatLogs.length > 50) chatLogs.shift();
}

async function askGroqAI(userMessage, sender, apiKey) {
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: 'Sen bir Minecraft botusun. Sana gelen mesajlara kısa, mantıklı cevaplar ver.'
                    },
                    { role: 'user', content: `${sender} dedi ki: ${userMessage}` }
                ],
                max_tokens: 100
            })
        });

        const data = await response.json();
        return data.choices?.[0]?.message?.content || null;
    } catch (err) {
        addChatLog(`[GROQ HATA] ${err.message}`);
        return null;
    }
}

function updateRadar() {
    if (!bot || !bot.entity) {
        radarText = 'Yakında kimse yok.';
        return;
    }
    const pos = bot.entity.position;
    const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.type === 'player')
        .map(e => {
            const name = cleanText(e.username || e.displayName || 'Oyuncu');
            const dist = Math.round(pos.distanceTo(e.position));
            return `${name} [${dist}m]`;
        });

    radarText = entities.length > 0 ? entities.join('\n') : 'Yakında kimse yok.';
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui.html'));
});

app.get('/api/status', (req, res) => {
    updateRadar();
    if (bot && bot.player) {
        ping = bot.player.ping || '-';
    }
    res.json({
        online: !!(bot && bot.entity),
        statusText: botStatus,
        ping: ping,
        tps: tps,
        chatLogs: chatLogs,
        radar: radarText
    });
});

app.post('/api/start', (req, res) => {
    const { groqKey, host, username, password, version } = req.body;

    if (bot) {
        try { bot.end(); } catch (e) {}
    }

    const activeGroqKey = groqKey || process.env.GROQ_API_KEY;

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
            viewDistance: 'tiny',          // Aktarım esnasında chunk yükünü azaltır
            physicsEnabled: false          // Sunucu aktarımı bitene kadar fiziği kapalı tutuyoruz
        });

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Sunucuya girildi!');
            
            // Alt sunucuya aktarım paketleri otursun diye fiziği 3.5 sn sonra açıyoruz
            setTimeout(() => {
                if (bot && bot.physics) bot.physics.enabled = true;
            }, 3500);

            if (password) {
                setTimeout(() => {
                    bot.chat(`/login ${password}`);
                }, 1500);
            }
        });

        bot.on('death', () => {
            addChatLog('[KORUMA] Bot öldü, 1 sn sonra doğuyor...');
            setTimeout(() => { try { bot.respawn(); } catch (e) {} }, 1000);
        });

        bot.on('messagestr', async (message) => {
            addChatLog(message);
            const lowerMsg = message.toLowerCase();

            if ((lowerMsg.includes('register') || lowerMsg.includes('kayıt ol')) && password) {
                setTimeout(() => bot.chat(`/register ${password} ${password}`), 1000);
            }

            if (message.includes('fısıldıyor') || message.includes('whispers')) {
                if (!canProcessMessage()) return;

                if (activeGroqKey) {
                    const parts = message.split(':');
                    const sender = parts[0] ? parts[0].split(' ')[0] : 'Oyuncu';
                    const text = parts.slice(1).join(':').trim();

                    const aiReply = await askGroqAI(text, sender, activeGroqKey);
                    if (aiReply) {
                        bot.chat(`/r ${aiReply}`);
                        addChatLog(`[GROQ YANIT] -> ${sender}: ${aiReply}`);
                    }
                }
            }
        });

        bot.on('kicked', (reason) => {
            botStatus = 'Atıldı';
            addChatLog(`[KICK] Sunucudan atıldı: ${cleanText(reason)}`);
        });

        bot.on('error', (err) => {
            if (err.message && (err.message.includes('Read') || err.message.includes('ECONNRESET'))) return;
            botStatus = 'Hata';
            addChatLog(`[HATA] ${err.message}`);
        });

        bot.on('end', () => {
            botStatus = 'Kapalı';
            addChatLog('[SİSTEM] Bağlantı kesildi.');
        });

    } catch (err) {
        botStatus = 'Hata';
        addChatLog(`[SİSTEM] Başlatma hatası: ${err.message}`);
    }

    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    if (bot) {
        bot.end();
        bot = null;
    }
    botStatus = 'Kapalı';
    addChatLog('[SİSTEM] Bot durduruldu.');
    res.json({ success: true });
});

app.post('/api/command', (req, res) => {
    const { action } = req.body;
    if (!bot) return res.json({ success: false });

    if (action === 'jump') {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
    } else if (action === 'sneak') {
        bot.setControlState('sneak', !bot.getControlState('sneak'));
    } else if (action === 'stop') {
        bot.clearControlStates();
        try { bot.pathfinder.stop(); } catch (e) {}
        try { bot.pvp.stop(); } catch (e) {}
    } else if (action === 'attack') {
        const target = bot.nearestEntity(e => e.type === 'player' && e !== bot.entity);
        if (target) {
            try { bot.pvp.attack(target); } catch (e) {}
        }
    }

    res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (bot && message) {
        bot.chat(message);
    }
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`[RENDER] Sunucu ${PORT} portunda aktif.`);
});
