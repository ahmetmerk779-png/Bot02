const express = require('express');
const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const Groq = require('groq-sdk');

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
let isTransferring = false;
let humanizerTimer = null;
let armorTimer = null;

function parseChatReason(reason) {
  if (!reason) return 'Bilinmeyen sebep';
  if (typeof reason === 'string') return reason;
  try {
    const jsonStr = JSON.stringify(reason);
    const textMatch = jsonStr.match(/"text":"([^"]+)"/);
    if (textMatch && textMatch[1]) return textMatch[1];
  } catch (e) {}
  return typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
}

function equipBestArmor() {
  if (!bot || !bot.inventory || isTransferring) return;
  const slots = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
  const items = bot.inventory.items();

  for (const item of items) {
    for (const [type, slot] of Object.entries(slots)) {
      if (item.name.endsWith(type)) {
        bot.equip(item, slot).catch(() => {});
      }
    }
  }
}

// Anti-cheat paket denetimlerini aşmak için insanı taklit eden gecikmeli tıklama
async function safeClickWindow(slot, mouseButton = 0, mode = 0) {
  if (!bot || !bot.currentWindow || isTransferring) return;
  const delay = Math.floor(Math.random() * 150) + 150;
  
  setTimeout(async () => {
    try {
      if (bot && bot.currentWindow) {
        await bot.clickWindow(slot, mouseButton, mode);
      }
    } catch (err) {
      console.log('[GUI Tıklama Hatası]:', err.message);
    }
  }, delay);
}

async function askGroq(userPrompt, senderName) {
  const apiKey = config.groqKey || process.env.GROQ_API_KEY;
  if (!apiKey) return null;

  try {
    const groq = new Groq({ apiKey });
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'Sen Minecraft oyununda bir oyuncusun. Türkçe, samimi, komik ve çok kısa (en fazla 1-2 cümle) yanıtlar ver. Asla uzun paragraflar yazma.'
        },
        {
          role: 'user',
          content: `${senderName} sana şöyle dedi: "${userPrompt}"`
        }
      ],
      model: 'llama-3.1-8b-instant',
      max_tokens: 100
    });

    if (completion.choices && completion.choices[0] && completion.choices[0].message) {
      return completion.choices[0].message.content.trim().replace(/\n/g, ' ');
    }
  } catch (err) {
    console.error('[GROQ HATA]', err.message);
  }
  return null;
}

app.get('/api/status', (req, res) => {
  res.json({
    status: botStatus,
    ping: ping,
    tps: tps,
    chatLogs: chatLogs.slice(-50),
    radar: radarEntities
  });
});

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
      <input type="text" id="groqKey" placeholder="Groq API Key (gsk_...) (Boşsa Env)">
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
      <input type="text" id="version" placeholder="Minecraft Sürümü (Örn: 1.21.11)" value="1.21.11">
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
        groqKey: document.getElementById('groqKey').value
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
  cleanBotState();
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
  if (bot && message && !isTransferring) {
    bot.chat(message);
    chatLogs.push(`[SİZ]: ${message}`);
  }
  res.json({ success: true });
});

app.post('/api/action', (req, res) => {
  const { action } = req.body;
  if (!bot || isTransferring) return res.json({ success: false, message: 'Bot meşgul veya aktif değil' });

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

function cleanBotState() {
  if (humanizerTimer) {
    clearInterval(humanizerTimer);
    humanizerTimer = null;
  }
  if (armorTimer) {
    clearInterval(armorTimer);
    armorTimer = null;
  }
}

function handleTransferLock() {
  isTransferring = true;
  if (bot) {
    bot.clearControlStates();
    if (bot.pathfinder) {
      try { bot.pathfinder.stop(); } catch(e){}
    }
  }
  setTimeout(() => {
    isTransferring = false;
  }, 4000);
}

async function initBot() {
  cleanBotState();
  botStatus = "Bağlanıyor...";
  isTransferring = false;
  chatLogs.push(`[SİSTEM] ${config.host} sunucusuna bağlanılıyor...`);

  let targetVersion = false;
  if (config.version && config.version.trim() !== '') {
    targetVersion = config.version.trim();
  }

  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: targetVersion,
    hideErrors: true,
    viewDistance: 'far',
    checkTimeoutInterval: 60 * 1000, // Lobi/BungeeCord geçişlerinde 60 saniyeye kadar timeout düşmelerini engeller
    defaultChatPatterns: false
  });

  bot.loadPlugin(pathfinder);

  try {
    const autoEatModule = await import('mineflayer-auto-eat');
    const autoEat = autoEatModule.plugin || autoEatModule.default;
    if (autoEat) bot.loadPlugin(autoEat);
  } catch(e) {}

  bot.once('login', () => {
    try {
      if (bot._client) {
        bot._client.write('custom_payload', {
          channel: 'minecraft:brand',
          data: Buffer.from('\x07vanilla')
        });
      }
    } catch (e) {}
  });

  bot.on('resourcePack', () => {
    chatLogs.push('[SİSTEM] Sunucu Kaynak Paketi otomatik reddedildi.');
    if (bot.denyResourcePack) bot.denyResourcePack();
  });

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

    cleanBotState();

    armorTimer = setInterval(() => {
      equipBestArmor();
    }, 5000);

    humanizerTimer = setInterval(() => {
      if (bot && bot.entity && !isTransferring) {
        const yaw = (Math.random() - 0.5) * 0.2;
        const pitch = (Math.random() - 0.5) * 0.1;
        try {
          bot.look(bot.entity.yaw + yaw, bot.entity.pitch + pitch, true);
        } catch(e) {}
      }
    }, 2500);

    if (config.password && config.password.trim() !== '') {
      setTimeout(() => {
        if (bot && !isTransferring) {
          bot.chat(`/login ${config.password}`);
          chatLogs.push(`[SİSTEM] Otomatik giriş (/login) gönderildi.`);
        }
      }, 3000);
    }
  });

  bot.on('respawn', () => {
    handleTransferLock();
    chatLogs.push('[SİSTEM] Sunucu/Dünya değişti (Respawn). Paketler senkronize ediliyor.');
    
    setTimeout(() => {
      isTransferring = false;
    }, 2500);
  });

  const checkTransferAndAuth = (msg) => {
    const lower = msg.toLowerCase();
    
    if ((lower.includes('/login') || lower.includes('şifre') || lower.includes('girin')) && config.password) {
      setTimeout(() => {
        if (bot && !isTransferring) {
          bot.chat(`/login ${config.password}`);
        }
      }, 1000);
    }

    const transferKeywords = ['aktarım', 'bekleyin', 'teleport', 'ışınlanıyor', 'aktarılıyorsunuz', 'sıranız:'];
    if (transferKeywords.some(kw => lower.includes(kw))) {
      handleTransferLock();
      chatLogs.push('[SİSTEM] Aktarım algılandı. Hareketler donduruldu.');
    }
  };

  bot.on('chat', async (username, message) => {
    chatLogs.push(`${username ? username + ': ' : ''}${message}`);
    checkTransferAndAuth(message);

    if (username === bot.username || isTransferring) return;

    if (message.toLowerCase().includes(bot.username.toLowerCase())) {
      const aiReply = await askGroq(message, username);
      if (aiReply && bot) {
        bot.chat(aiReply);
        chatLogs.push(`[AI YANIT]: ${aiReply}`);
      }
    }
  });

  bot.on('messagestr', (message) => {
    chatLogs.push(message);
    checkTransferAndAuth(message);
  });

  bot.on('forcedMove', () => {
    handleTransferLock();
    chatLogs.push('[SİSTEM] Zorunlu hareket/ışınlanma algılandı.');
  });

  bot.on('time', () => {
    if (bot) ping = bot.player ? bot.player.ping : '-';
  });

  setInterval(() => {
    if (bot && bot.entities && !isTransferring) {
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
    cleanBotState();
    botStatus = "Atıldı (Kicked)";
    const parsed = parseChatReason(reason);
    chatLogs.push(`[SİSTEM] Bot sunucudan atıldı: ${parsed}`);
    bot = null;
  });

  bot.on('end', () => {
    cleanBotState();
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
