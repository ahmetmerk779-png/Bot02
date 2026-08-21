const express = require('express');
const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let bot = null;
let botStatus = "Kapalı";
let ping = "-";
let tps = "-";
let chatLogs = [];
let radarEntities = [];

// Express Rotaları / Control API
app.get('/api/status', (req, res) => {
  res.json({
    status: botStatus,
    ping: ping,
    tps: tps,
    chatLogs: chatLogs.slice(-50),
    radar: radarEntities
  });
});

// Front-end Single Page App Serve
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Kontrol Paneli</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1a1b26; color: #a9b1d6; margin: 0; padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 480px; background: #24283b; padding: 20px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    h1 { text-align: center; color: #7aa2f7; font-size: 24px; margin-bottom: 20px; }
    .input-group { margin-bottom: 12px; }
    input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #3b4261; background: #1f2335; color: #c0caf5; box-sizing: border-box; font-size: 14px; }
    input:focus { outline: none; border-color: #7aa2f7; }
    .btn-group { display: flex; gap: 10px; margin-bottom: 15px; }
    button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; transition: 0.2s; }
    .btn-start { background: #9ece6a; color: #15161e; }
    .btn-stop { background: #f7768e; color: #15161e; }
    .btn-action { background: #7aa2f7; color: #15161e; }
    .btn-warning { background: #ff9e64; color: #15161e; }
    .stats { display: flex; gap: 10px; margin-bottom: 15px; }
    .stat-box { flex: 1; background: #1f2335; padding: 10px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 11px; color: #737aa2; text-transform: uppercase; font-weight: bold; }
    .stat-val { font-size: 18px; font-weight: bold; color: #bb9af7; margin-top: 4px; }
    .status-bar { text-align: center; font-weight: bold; margin-bottom: 15px; font-size: 16px; color: #e0af68; }
    .box { background: #1f2335; border-radius: 8px; padding: 12px; margin-bottom: 15px; max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 12px; }
    .chat-box { height: 180px; }
    .chat-input { display: flex; gap: 8px; margin-top: 8px; }
    .chat-input input { flex: 1; }
    .chat-input button { flex: initial; width: 80px; background: #7aa2f7; color: #15161e; }
    .radar-box { height: 120px; color: #9ece6a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bot Kontrol Paneli</h1>
    
    <div class="input-group">
      <input type="text" id="geminiKey" placeholder="Gemini API (Boşsa Render Env Kullanır)">
    </div>
    <div class="input-group">
      <input type="text" id="host" placeholder="Sunucu IP" value="play.aesirmc.com">
    </div>
    <div class="input-group">
      <input type="text" id="username" placeholder="Bot İsmi">
    </div>
    <div class="input-group">
      <input type="password" id="password" placeholder="Sunucu Şifresi (/login)">
    </div>
    <div class="input-group">
      <input type="text" id="version" placeholder="Minecraft Sürümü (Örn: 1.21.11 - Boşsa Otomatik)" value="1.21.11">
    </div>

    <div class="btn-group">
      <button class="btn-start" onclick="startBot()">Başlat</button>
      <button class="btn-stop" onclick="stopBot()">Durdur</button>
    </div>

    <div class="status-bar" id="statusText">Durum: Kapalı (-)</div>

    <div class="stats">
      <div class="stat-box">
        <div class="stat-label">PING</div>
        <div class="stat-val" id="pingVal">- ms</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">TPS</div>
        <div class="stat-val" id="tpsVal">-</div>
      </div>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px; margin:10px 0;">Hızlı Komutlar</h3>
    <div class="btn-group">
      <button class="btn-action" onclick="sendAction('jump')">Zıpla</button>
      <button class="btn-action" onclick="sendAction('sneak')">Eğil/Kalk</button>
      <button class="btn-stop" onclick="sendAction('stop')">Dur/İptal</button>
    </div>
    <div style="margin-bottom:15px;">
      <button class="btn-warning" style="width:100%" onclick="sendAction('attack')">Yakındakine Saldır</button>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px;">Canlı Sunucu Sohbeti</h3>
    <div class="box chat-box" id="chatLogs"></div>
    <div class="chat-input">
      <input type="text" id="chatMsg" placeholder="Mesaj gönder..." onkeypress="if(event.key==='Enter') sendChat()">
      <button onclick="sendChat()">Gönder</button>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px; margin-top:15px;">Çevre Radarı</h3>
    <div class="box radar-box" id="radarLogs">Yakında kimse yok.</div>
  </div>

  <script>
    async function startBot() {
      const data = {
        host: document.getElementById('host').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        version: document.getElementById('version').value,
        geminiKey: document.getElementById('geminiKey').value
      };
      await fetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    }

    async function stopBot() {
      await fetch('/api/stop', { method: 'POST' });
    }

    async function sendChat() {
      const input = document.getElementById('chatMsg');
      const msg = input.value;
      if (!msg) return;
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      input.value = '';
    }

    async function sendAction(action) {
      await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action })
      });
    }

    setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        document.getElementById('statusText').innerText = 'Durum: ' + data.status;
        document.getElementById('pingVal').innerText = data.ping + ' ms';
        document.getElementById('tpsVal').innerText = data.tps;

        const chatBox = document.getElementById('chatLogs');
        chatBox.innerHTML = data.chatLogs.join('<br>');
        chatBox.scrollTop = chatBox.scrollHeight;

        const radarBox = document.getElementById('radarLogs');
        if (data.radar && data.radar.length > 0) {
          radarBox.innerHTML = data.radar.map(function(e) {
            return '[' + e.type + '] ' + e.name + ' (' + e.distance + 'm)';
          }).join('<br>');
        } else {
          radarBox.innerHTML = 'Yakında kimse yok.';
        }
      } catch (e) {}
    }, 1000);
  </script>
</body>
</html>
  `);
});

// Bot Başlatma / Durdurma API Endpoints
let config = {};

app.post('/api/start', (req, res) => {
  config = req.body;
  if (!config.host || !config.username) {
    return res.status(400).json({ error: 'Sunucu IP ve Bot İsmi gereklidir!' });
  }

  if (bot) {
    try { bot.quit(); } catch(e){}
  }

  initBot();
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  if (bot) {
    bot.quit();
    bot = null;
    botStatus = "Kapalı";
    chatLogs.push("[SİSTEM] Bot kullanıcı tarafından durduruldu.");
  }
  res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
  const { message } = req.body;
  if (bot && message) {
    bot.chat(message);
    chatLogs.push(`[SİZ]: ${message}`);
  }
  res.json({ success: true });
});

app.post('/api/action', (req, res) => {
  const { action } = req.body;
  if (!bot) return res.json({ success: false, message: 'Bot aktif değil' });

  if (action === 'jump') {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 500);
  } else if (action === 'sneak') {
    const isSneaking = bot.getControlState('sneak');
    bot.setControlState('sneak', !isSneaking);
  } else if (action === 'stop') {
    if (bot.pathfinder) bot.pathfinder.stop();
    bot.clearControlStates();
  } else if (action === 'attack') {
    const entity = bot.nearestEntity(e => e.type === 'mob' || e.type === 'player');
    if (entity) {
      bot.attack(entity);
      chatLogs.push(`[SİSTEM] ${entity.username || entity.name} adlı varlığa saldırıldı!`);
    } else {
      chatLogs.push(`[SİSTEM] Yakında saldırılacak hedef bulunamadı.`);
    }
  }
  res.json({ success: true });
});

// Bot Oluşturma Fonksiyonu
async function initBot() {
  botStatus = "Bağlanıyor...";
  chatLogs.push(`[SİSTEM] ${config.host} sunucusuna bağlanılıyor...`);

  // Minecraft sürüm belirleme
  let targetVersion = false;
  if (config.version && config.version.trim() !== '') {
    targetVersion = config.version.trim();
  }

  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: targetVersion,
    hideErrors: true
  });

  bot.loadPlugin(pathfinder);

  // AutoEat Dinamik Import (ESM Uyumluluğu)
  try {
    const autoEatModule = await import('mineflayer-auto-eat');
    const autoEat = autoEatModule.plugin || autoEatModule.default;
    if (autoEat) bot.loadPlugin(autoEat);
  } catch(e) {
    console.log('[SİSTEM] AutoEat yüklenemedi:', e.message);
  }

  bot.on('spawn', () => {
    botStatus = "Çalışıyor";
    chatLogs.push(`[SİSTEM] Bot sunucuya girdi!`);

    if (bot.autoEat) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: ['rotten_flesh'] };
    }

    if (bot.pathfinder) {
      bot.pathfinder.thinkTimeout = 1000;
      bot.pathfinder.tickTimeout = 20;
    }

    // OTOMATİK GİRİŞ
    if (config.password && config.password.trim() !== '') {
      setTimeout(() => {
        if (bot) bot.chat(`/login ${config.password}`);
        chatLogs.push(`[SİSTEM] Otomatik giriş (/login) gönderildi.`);
      }, 1500);
    }
  });

  // Chat Dinleyicisi & Aktarım Durdurma
  bot.on('chat', (username, message) => {
    chatLogs.push(`${username ? username + ': ' : ''}${message}`);

    const transferKeywords = ['Aktarım', 'bekleyin', 'teleport', 'Işınlanıyor', 'Aktarılıyorsunuz', 'Sıranız:'];
    if (transferKeywords.some(kw => message.includes(kw))) {
      if (bot.pathfinder) {
        bot.pathfinder.stop();
        chatLogs.push('[SİSTEM] Aktarım/Işınlanma algılandı. Pathfinder durduruldu.');
      }
    }
  });

  // Mesaj (system message) Dinleyicisi
  bot.on('messagestr', (message) => {
    chatLogs.push(message);

    const transferKeywords = ['Aktarım', 'bekleyin', 'teleport', 'Işınlanıyor', 'Aktarılıyorsunuz', 'Sıranız:'];
    if (transferKeywords.some(kw => message.includes(kw))) {
      if (bot.pathfinder) {
        bot.pathfinder.stop();
        chatLogs.push('[SİSTEM] Aktarım algılandı. Pathfinder durduruldu.');
      }
    }
  });

  // Işınlanma / Zorunlu Hareket Olunca Pathfinder'ı İptal Et
  bot.on('forcedMove', () => {
    if (bot.pathfinder) {
      bot.pathfinder.stop();
      chatLogs.push('[SİSTEM] Işınlanma tamamlandı. Yürüme hedefi sıfırlandı.');
    }
  });

  bot.on('time', () => {
    if (bot) ping = bot.player ? bot.player.ping : '-';
  });

  // Radar Bilgilerini Güncelle (Her 2 saniyede)
  setInterval(() => {
    if (bot && bot.entities) {
      const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity && (e.type === 'player' || e.type === 'mob'))
        .map(e => ({
          name: e.username || e.name || 'Bilinmeyen',
          type: e.type === 'player' ? 'Oyuncu' : 'Yaratık',
          distance: Math.round(bot.entity.position.distanceTo(e.position))
        }))
        .filter(e => e.distance <= 60)
        .sort((a, b) => a.distance - b.distance);

      radarEntities = entities.slice(0, 10);
    } else {
      radarEntities = [];
    }
  }, 2000);

  bot.on('kicked', (reason) => {
    botStatus = "Atıldı (Kicked)";
    chatLogs.push(`[SİSTEM] Bot sunucudan atıldı: ${reason}`);
    bot = null;
  });

  bot.on('end', () => {
    botStatus = "Kapalı";
    chatLogs.push(`[SİSTEM] Bot sunucudan ayrıldı.`);
    bot = null;
  });

  bot.on('error', (err) => {
    chatLogs.push(`[HATA] ${err.message}`);
    if (bot && bot.pathfinder) {
      try { bot.pathfinder.stop(); } catch(e){}
    }
  });
}

// Global Hata Yakalayıcılar
process.on('uncaughtException', (err) => {
  console.log('[ÇÖKME ÖNLENDİ] Uncaught Exception:', err.message);
  chatLogs.push(`[SİSTEM] Hata yakalandı: ${err.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('[ÇÖKME ÖNLENDİ] Unhandled Rejection:', reason);
  chatLogs.push(`[SİSTEM] Arka plan hatası önlendi.`);
});

server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});
