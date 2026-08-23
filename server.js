const express = require('express');
const path = require('path');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;

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

function addChatLog(msg) {
    chatLogs.push(msg);
    if (chatLogs.length > 40) chatLogs.shift();
}

function updateRadar() {
    if (!bot || !bot.entity) {
        radarText = 'Yakında kimse yok.';
        return;
    }
    const pos = bot.entity.position;
    const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.type === 'player')
        .map(e => `${e.username || 'Oyuncu'} [${Math.round(pos.distanceTo(e.position))}m]`);

    radarText = entities.length > 0 ? entities.join('\n') : 'Yakında kimse yok.';
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ui.html'));
});

app.get('/api/status', (req, res) => {
    updateRadar();
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
    const { host, username, password, version } = req.body;

    if (bot) {
        try { bot.end(); } catch (e) {}
    }

    botStatus = 'Bağlanıyor...';
    addChatLog('[SİSTEM] Bot başlatılıyor...');

    try {
        bot = mineflayer.createBot({
            host: host || 'play.aesirmc.com',
            port: 25565,
            username: username || 'OtonomBot',
            version: version || '1.21.11',
            fakeHost: host || 'play.aesirmc.com', // Velocity Bypass
            checkTimeoutInterval: 60 * 1000
        });

        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);

        bot.once('spawn', () => {
            botStatus = 'Bağlı';
            addChatLog('[SİSTEM] Sunucuya başarıyla girildi!');
            if (password) {
                setTimeout(() => bot.chat(`/login ${password}`), 1500);
            }
        });

        bot.on('messagestr', (msg) => {
            addChatLog(msg);
        });

        bot.on('kicked', (reason) => {
            botStatus = 'Atıldı';
            addChatLog(`[KICK] Sunucudan atıldı: ${reason}`);
        });

        bot.on('error', (err) => {
            botStatus = 'Hata';
            addChatLog(`[HATA] ${err.message}`);
        });

        bot.on('end', () => {
            botStatus = 'Kapalı';
            addChatLog('[SİSTEM] Bağlantı kesildi.');
        });

    } catch (err) {
        botStatus = 'Hata';
        addChatLog(`[SİSTEM] Başlatma başarısız: ${err.message}`);
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

// Render'ın kapanmaması için doğrudan dinleyici açıyoruz
app.listen(PORT, () => {
    console.log(`[RENDER] Sunucu ${PORT} portunda başarıyla başlatıldı ve dinleniyor.`);
});
