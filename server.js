const express = require('express');
const path = require('path');
const botManager = require('./bot');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// Arayüzü sun
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'ui.html'));
});

// API Uç Noktaları
app.get('/api/status', (req, res) => {
  res.json(botManager.getStatus());
});

app.post('/api/start', (req, res) => {
  botManager.startBot(req.body);
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  botManager.stopBot();
  res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
  botManager.sendChat(req.body.message);
  res.json({ success: true });
});

app.post('/api/action', (req, res) => {
  botManager.sendAction(req.body.action);
  res.json({ success: true });
});

// Çökme Engelleyici
process.on('uncaughtException', err => console.log('[ÇÖKME ÖNLENDİ]', err.message));
process.on('unhandledRejection', reason => console.log('[ÇÖKME ÖNLENDİ]', reason));

app.listen(PORT, () => console.log(`Otonom AI Web Paneli ${PORT} portunda dinlemede.`));
