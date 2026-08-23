const express = require('express');
const path = require('path');

function startWebServer(bot) {
    const app = express();
    // Render'ın atadığı dinamik PORT veya varsayılan 3000 portu
    const PORT = process.env.PORT || 3000;

    app.use(express.json());
    app.use(express.static(__dirname));

    // Arayüz sayfası (ui.html)
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'ui.html'));
    });

    // Web paneli için canlı bot durumu (Can, Açlık, Konum)
    app.get('/api/status', (req, res) => {
        if (!bot || !bot.entity) {
            return res.json({ status: 'offline', message: 'Bot henüz doğmadı.' });
        }
        res.json({
            status: 'online',
            username: bot.username,
            health: bot.health,
            food: bot.food,
            position: {
                x: Math.round(bot.entity.position.x),
                y: Math.round(bot.entity.position.y),
                z: Math.round(bot.entity.position.z)
            }
        });
    });

    // Web panelinden oyuna mesaj gönderme uç noktası
    app.post('/api/chat', (req, res) => {
        const { message } = req.body;
        if (bot && message) {
            bot.chat(message);
            return res.json({ success: true, message: 'Mesaj sunucuya iletildi.' });
        }
        res.status(400).json({ success: false, message: 'Geçersiz istek.' });
    });

    app.listen(PORT, () => {
        console.log(`[WEB] Web Kontrol Paneli ${PORT} portunda başarıyla başlatıldı.`);
    });
}

module.exports = startWebServer;
