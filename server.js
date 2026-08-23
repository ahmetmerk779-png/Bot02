const express = require('express');
const path = require('path');

function startWebServer(botController) {
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.use(express.json());
    app.use(express.static(__dirname));

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'ui.html'));
    });

    app.get('/api/status', (req, res) => {
        if (botController && typeof botController.getStatus === 'function') {
            return res.json(botController.getStatus());
        }
        res.json({
            online: false,
            statusText: 'Kapalı',
            ping: '-',
            tps: '-',
            chatLogs: [],
            radar: 'Yakında kimse yok.'
        });
    });

    app.post('/api/start', (req, res) => {
        if (botController && botController.start) {
            botController.start(req.body);
        }
        res.json({ success: true });
    });

    app.post('/api/stop', (req, res) => {
        if (botController && botController.stop) {
            botController.stop();
        }
        res.json({ success: true });
    });

    app.post('/api/command', (req, res) => {
        const { action } = req.body;
        if (botController && botController.handleCommand) {
            botController.handleCommand(action);
        }
        res.json({ success: true });
    });

    app.post('/api/chat', (req, res) => {
        const { message } = req.body;
        if (botController && botController.sendChat) {
            botController.sendChat(message);
        }
        res.json({ success: true });
    });

    app.listen(PORT, () => {
        console.log(`[PANEL] Arayüz ${PORT} portunda aktif.`);
    });
}

module.exports = startWebServer;
