const express = require('express');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

let bot = null;
let botStatus = 'Kapalı';
let chatLogs = [];
let radarText = 'Yakında kimse yok.';
let ping = '-';
let tps = '-';

// 🛡️ KORUMA: 3.5 Saniyelik Mesaj / Fısıltı Spam Engeli
let lastProcessedTime = 0;
function canProcessMessage() {
    const now = Date.now();
    if (now - lastProcessedTime < 3500) return false;
    lastProcessedTime = now;
    return true;
}

// 🛡️ KORUMA: Minecraft Renk ve Format Kodlarını (§a, §c) Temizleme
function cleanText(text) {
    if (!text) return '';
    if (typeof text === 'object') {
        try { text = JSON.stringify(text); } catch (e) { text = String(text); }
    }
    return String(text).replace(/§[0-9a-fk-or]/gi, '').trim();
}

function addChatLog(msg) {
    chatLogs.push(cleanText(msg));
    if (chatLogs.length > 50) chatLogs.shift();
}

// 🤖 Groq AI Karar Motoru
async function askGroqAI(userMessage, sender, apiKey) {
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'Sen bir Minecraft botusun. Sana gelen mesajlara kısa, mantıklı cevaplar ver veya /me, /say tarzı komut yanıtı döndür. Sadece net yanıt ver.'
                },
                { role: 'user', content: `${sender} dedi ki: ${userMessage}` }
            ],
            max_tokens: 100
        }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });

        return response.data.choices[0]?.message?.content || null;
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
    addChatLog('[SİSTEM] Bot koruma protokolleriyle başlatılıyor...');

    try {
        bot = mineflayer.createBot({
            host: host || 'play.aesirmc.com',
            port: 25565,
            username: username || 'OtonomBot',
            version: version || '1.21.11',
            
            // 🛡️ ANTI-BOT & VELOCITY BYPASS KORUMALARI
            fakeHost: host || 'play.aesirmc.com',
            checkTimeoutInterval: 60 * 1000,
            brand: 'vanilla',
            physicsEnabled: true
        });

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Anti-bot koruması aşıldı, sunucuya girildi!');
            
            // 🛡️ Otomatik Giriş Koruması
            if (password) {
                setTimeout(() => {
                    bot.chat(`/login ${password}`);
                    bot.chat(`/register ${password} ${password}`);
                }, 2000);
            }
        });

        // 🛡️ Otomatik Yeniden Doğma
        bot.on('death', () => {
            addChatLog('[KORUMA] Bot öldü, 1 sn içinde respawn olunuyor...');
            setTimeout(() => { try { bot.respawn(); } catch (e) {} }, 1000);
        });

        // 💬 Sohbet ve AI Fısıltı Dinleyicisi
        bot.on('messagestr', async (message, messagePosition, jsonMsg) => {
            addChatLog(message);

            // Fısıltı Tespiti (Örn: "Oyuncu adli oyuncu size fısıldıyor: merhaba")
            if (message.includes('fısıldıyor') || message.includes('whispers')) {
                if (!canProcessMessage()) {
                    addChatLog('[KORUMA] 3.5s bekleme süresi dolmadığı için fısıltı korumaya takıldı.');
                    return;
                }

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

        // 🛡️ Kick Mesajı Ayıklama
        bot.on('kicked', (reason) => {
            botStatus = 'Atıldı';
            let parsedReason = reason;
            if (typeof reason === 'object' && reason !== null) {
                parsedReason = reason.value || reason.text || JSON.stringify(reason);
            }
            addChatLog(`[KICK] Sunucudan atıldı: ${cleanText(parsedReason)}`);
        });

        bot.on('error', (err) => {
            botStatus = 'Hata';
            addChatLog(`[HATA] ${err.message}`);
        });

        bot.on('end', () => {
            botStatus = 'Kapalı';
            addChatLog('[SİSTEM] Bağlantı sonlandı.');
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
    console.log(`[RENDER] Sunucu ve Korumalar ${PORT} portunda aktif.`);
});
