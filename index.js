const express = require('express');
const http = require('http');
const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const Groq = require('groq-sdk');
const vec3 = require('vec3');

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
let armorTimer = null;
let autoReconnectTimer = null;
let isQueueing = false;
let isManualStop = false;
let isLoggedIn = false;
let mcData = null;
let isFishing = false;
let config = {};

// --- GROQ AI TOOLS ---
const botTools = [
  {
    type: "function",
    function: {
      name: "follow_player",
      description: "Belirtilen oyuncunun yanına gider ve onu takip eder.",
      parameters: {
        type: "object",
        properties: { target: { type: "string", description: "Takip edilecek oyuncu" } },
        required: ["target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "attack_target",
      description: "Belirtilen oyuncuya veya yaratığa saldırmak için PvP başlatır.",
      parameters: {
        type: "object",
        properties: { target: { type: "string", description: "Saldırılacak hedef" } },
        required: ["target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "stop_all_actions",
      description: "Tüm eylemleri (takip, pvp, kazma, balık) durdurur.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "mine_block",
      description: "Etraftaki belirli bir blok türünü kazar ve toplar.",
      parameters: {
        type: "object",
        properties: { blockName: { type: "string", description: "Kazılacak blok adı" } },
        required: ["blockName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_fishing",
      description: "Otonom balık tutmaya başlar.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "say_chat",
      description: "Sadece sohbetten yanıt verir.",
      parameters: {
        type: "object",
        properties: { message: { type: "string", description: "Sohbet mesajı" } },
        required: ["message"]
      }
    }
  }
];

function resetAllStates() {
  isFishing = false;
  if (bot) {
    try { bot.clearControlStates(); } catch (e) {}
    try { bot.pathfinder.setGoal(null); bot.pathfinder.stop(); } catch (e) {}
    try { bot.pvp.stop(); } catch (e) {}
  }
}

function followPlayer(username) {
  if (isQueueing || !bot) return;
  resetAllStates();
  const target = bot.players[username]?.entity;
  if (!target) return bot.chat(`${username} yakında bulunamadı.`);
  const defaultMove = new Movements(bot, mcData);
  defaultMove.canDig = false;
  bot.pathfinder.setMovements(defaultMove);
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
  bot.chat(`Geliyorum ${username}!`);
}

function attackTarget(targetName) {
  if (isQueueing || !bot) return;
  resetAllStates();
  let target = bot.players[targetName]?.entity || bot.nearestEntity(e => (e.type === 'mob' || e.type === 'player') && e.username === targetName);
  if (!target) return bot.chat(`${targetName} hedefi bulunamadı.`);
  bot.pvp.attack(target);
  bot.chat(`${targetName} hedefine PvP başlatıldı!`);
}

async function mineBlock(blockName) {
  if (isQueueing || !bot) return;
  resetAllStates();
  if (!mcData || !mcData.blocksByName[blockName]) return bot.chat(`Geçersiz blok: ${blockName}`);
  const target = bot.findBlock({ matching: mcData.blocksByName[blockName].id, maxDistance: 25 });
  if (!target) return bot.chat(`Yakında ${blockName} yok.`);
  bot.chat(`${blockName} kazılıyor...`);
  bot.collectBlock.collect(target, (err) => {
    if (err) bot.chat('Kazma iptal oldu.');
    else bot.chat('Blok toplandı.');
  });
}

async function startFishing() {
  if (isQueueing || !bot) return;
  resetAllStates();
  isFishing = true;
  const rod = bot.inventory.items().find(i => i.name.includes('fishing_rod'));
  if (!rod) { isFishing = false; return bot.chat('Olta yok!'); }
  try {
    await bot.equip(rod, 'hand');
    bot.chat('Balık tutuluyor...');
    loopFishing();
  } catch (e) {}
}

async function loopFishing() {
  if (!isFishing || !bot || isQueueing) return;
  try {
    await bot.fish();
    bot.chat('Balık tutuldu! Tekrar atılıyor.');
    setTimeout(() => loopFishing(), 1000);
  } catch (err) {
    if (isFishing) setTimeout(() => loopFishing(), 3000);
  }
}

async function processAIAgent(sender, userMessage) {
  const apiKey = config.groqKey || process.env.GROQ_API_KEY;
  if (!apiKey || !bot || isQueueing) return;

  const botState = {
    health: bot.health,
    food: bot.food,
    position: bot.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
    nearbyPlayers: radarEntities.filter(e => e.type === 'Oyuncu').map(e => e.name),
    inventory: bot.inventory ? bot.inventory.items().map(i => i.name).join(', ') : 'Boş'
  };

  try {
    const groq = new Groq({ apiKey });
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `Sen Minecraft'ta otonom bir AI oyuncususun. Durumun: ${JSON.stringify(botState)}. Mesajlara göre doğru aracı (tool) seç. Sadece mesaj vereceksen say_chat kullan.`
        },
        { role: "user", content: `${sender}: "${userMessage}"` }
      ],
      tools: botTools,
      tool_choice: "auto"
    });

    const choice = response.choices[0].message;

    if (choice.tool_calls && choice.tool_calls.length > 0) {
      for (const call of choice.tool_calls) {
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments || '{}');
        if (fnName === 'follow_player') followPlayer(args.target || sender);
        else if (fnName === 'attack_target') attackTarget(args.target || sender);
        else if (fnName === 'stop_all_actions') { resetAllStates(); bot.chat('Durdum.'); }
        else if (fnName === 'mine_block') mineBlock(args.blockName);
        else if (fnName === 'start_fishing') startFishing();
        else if (fnName === 'say_chat' && args.message) bot.chat(args.message);
      }
    } else if (choice.content) {
      bot.chat(choice.content.trim());
    }
  } catch (err) { console.error('[AI AGENT HATA]', err.message); }
}

function cleanBotState() {
  resetAllStates();
  if (armorTimer) clearInterval(armorTimer);
  armorTimer = null;
}

function equipBestArmor() {
  if (!bot || !bot.inventory || isQueueing) return;
  const slots = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
  for (const item of bot.inventory.items()) {
    for (const [type, slot] of Object.entries(slots)) {
      if (item.name.endsWith(type)) bot.equip(item, slot).catch(() => {});
    }
  }
}

function triggerAutoReconnect() {
  if (isManualStop || autoReconnectTimer) return;
  botStatus = "Yeniden Bağlanıyor (5s)...";
  chatLogs.push('[SİSTEM] Bağlantı koptu. 5 saniye içinde yeniden bağlanılıyor...');
  autoReconnectTimer = setTimeout(() => {
    autoReconnectTimer = null;
    if (!isManualStop) initBot();
  }, 5000);
}

// NBT ve JSON Atılma Mesajlarını Düz Metne Çevirir
function parseKickReason(reason) {
  if (!reason) return "Bilinmeyen Neden";
  if (typeof reason === 'string') return reason;
  
  if (typeof reason === 'object') {
    // Prismarine NBT Objesi
    if (reason.type === 'compound' && reason.value) {
      if (reason.value.text && reason.value.text.value) {
        return reason.value.text.value;
      }
      if (reason.value.extra && reason.value.extra.value) {
        return JSON.stringify(reason.value.extra.value);
      }
    }
    // Standart JSON Chat
    if (reason.text) return reason.text;
    if (reason.extra && Array.isArray(reason.extra)) {
      return reason.extra.map(e => (typeof e === 'string' ? e : e.text || '')).join('');
    }
    return JSON.stringify(reason);
  }
  return String(reason);
}

async function initBot() {
  cleanBotState();
  botStatus = "Bağlanıyor...";
  isLoggedIn = false;

  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: config.version ? config.version.trim() : "1.21.11",
    hideErrors: true,
    viewDistance: 'far',
    checkTimeoutInterval: 120 * 1000
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  try {
    const autoEatModule = await import('mineflayer-auto-eat');
    const autoEat = autoEatModule.plugin || autoEatModule.default;
    if (autoEat) bot.loadPlugin(autoEat);
  } catch(e) {}

  bot.on('spawn', () => {
    botStatus = "Çalışıyor";
    isQueueing = false;
    chatLogs.push(`[SİSTEM] Bot dünyaya doğdu.`);
    
    resetAllStates();
    mcData = require('minecraft-data')(bot.version);

    if (bot.autoEat) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: ['rotten_flesh'] };
    }

    // Giriş yapma kontrolü
    if (config.password && config.password.trim() !== '' && !isLoggedIn) {
      setTimeout(() => { 
        if (bot) {
          bot.chat(`/login ${config.password}`);
        }
      }, 2000);
    }

    if (!armorTimer) armorTimer = setInterval(() => equipBestArmor(), 7000);
  });

  bot.on('respawn', () => {
    chatLogs.push('[SİSTEM] Alt sunucuya aktarıldı.');
    resetAllStates();
    isQueueing = false;
  });

  bot.on('chat', async (username, message) => {
    chatLogs.push(`${username ? username + ': ' : ''}${message}`);

    if (message.includes('Giriş başarılı') || message.includes('Login successfull') || message.includes('Başarıyla giriş yaptınız')) {
      isLoggedIn = true;
    }

    if (message.includes('sırasına girdiniz') || message.includes('Sıranız:') || message.includes('aktarılıyorsunuz')) {
      isQueueing = true;
      resetAllStates();
      botStatus = "Sırada Bekliyor";
      return;
    }

    if (username === bot.username || isQueueing) return;
    await processAIAgent(username, message);
  });

  bot.on('messagestr', (msg) => {
    chatLogs.push(msg);
    if (msg.includes('Giriş başarılı') || msg.includes('Login successfull') || msg.includes('Başarıyla giriş yaptınız')) {
      isLoggedIn = true;
    }
    if (msg.includes('sırasına girdiniz') || msg.includes('Sıranız:')) {
      isQueueing = true;
      resetAllStates();
      botStatus = "Sırada Bekliyor";
    }
  });

  bot.on('time', () => { if (bot) ping = bot.player ? bot.player.ping : '-'; });

  setInterval(() => {
    if (bot && bot.entities && !isQueueing) {
      const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity && (e.type === 'player' || e.type === 'mob'))
        .map(e => ({
          name: e.username || e.name || 'Bilinmeyen',
          type: e.type === 'player' ? 'Oyuncu' : 'Yaratık',
          distance: Math.round(bot.entity.position.distanceTo(e.position))
        }))
        .filter(e => e.distance <= 50)
        .sort((a, b) => a.distance - b.distance);
      radarEntities = entities.slice(0, 10);
    } else { radarEntities = []; }
  }, 2000);

  bot.on('kicked', (reason) => {
    const kickMessage = parseKickReason(reason);
    chatLogs.push(`[SİSTEM] Atıldı: ${kickMessage}`);
    cleanBotState();
    triggerAutoReconnect();
  });

  bot.on('end', () => {
    cleanBotState();
    if (!isManualStop) triggerAutoReconnect();
    else botStatus = "Kapalı";
  });

  bot.on('error', (err) => chatLogs.push(`[HATA] ${err.message}`));
}

// --- EXPRESS ENDPOINTS ---
app.get('/api/status', (req, res) => {
  res.json({ status: botStatus, ping, tps, chatLogs: chatLogs.slice(-50), radar: radarEntities });
});

app.post('/api/start', (req, res) => {
  config = req.body;
  if (!config.host || !config.username) return res.status(400).json({ error: 'Bilgiler eksik!' });
  isManualStop = false;
  if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
  if (bot) { try { bot.quit(); } catch(e){} }
  initBot();
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  isManualStop = true;
  if (autoReconnectTimer) clearTimeout(autoReconnectTimer);
  cleanBotState();
  if (bot) { bot.quit(); bot = null; }
  botStatus = "Kapalı";
  res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
  if (bot && req.body.message) {
    bot.chat(req.body.message);
    chatLogs.push(`[SİZ]: ${req.body.message}`);
  }
  res.json({ success: true });
});

app.post('/api/action', (req, res) => {
  const { action } = req.body;
  if (!bot || isQueueing) return res.json({ success: false });

  if (action === 'jump') {
    bot.setControlState('jump', true);
    setTimeout(() => bot.setControlState('jump', false), 500);
  } else if (action === 'sneak') {
    bot.setControlState('sneak', !bot.getControlState('sneak'));
  } else if (action === 'stop') {
    resetAllStates();
  } else if (action === 'attack') {
    const target = bot.nearestEntity(e => e.type === 'mob' || e.type === 'player');
    if (target) bot.pvp.attack(target);
  }
  res.json({ success: true });
});

// --- FULL MOBILE WEB UI ---
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Kontrol Paneli</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background-color: #1a1b26; color: #a9b1d6; margin: 0; padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 480px; background: #24283b; padding: 20px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    h1 { text-align: center; color: #7aa2f7; font-size: 24px; margin-bottom: 20px; }
    .input-group { margin-bottom: 10px; }
    input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #3b4261; background: #1f2335; color: #c0caf5; box-sizing: border-box; font-size: 14px; }
    .btn-group { display: flex; gap: 10px; margin-bottom: 12px; }
    button { flex: 1; padding: 12px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 14px; }
    .btn-start { background: #9ece6a; color: #15161e; }
    .btn-stop { background: #f7768e; color: #15161e; }
    .btn-action { background: #7aa2f7; color: #15161e; }
    .btn-warning { background: #ff9e64; color: #15161e; }
    .stats { display: flex; gap: 10px; margin-bottom: 12px; }
    .stat-box { flex: 1; background: #1f2335; padding: 10px; border-radius: 8px; text-align: center; }
    .stat-label { font-size: 11px; color: #737aa2; font-weight: bold; }
    .stat-val { font-size: 16px; font-weight: bold; color: #bb9af7; }
    .status-bar { text-align: center; font-weight: bold; margin-bottom: 12px; font-size: 16px; color: #e0af68; }
    .box { background: #1f2335; border-radius: 8px; padding: 12px; margin-bottom: 12px; max-height: 180px; overflow-y: auto; font-family: monospace; font-size: 12px; }
    .chat-box { height: 160px; }
    .chat-input { display: flex; gap: 8px; margin-top: 6px; }
    .chat-input input { flex: 1; margin-bottom: 0; }
    .chat-input button { flex: initial; width: 80px; background: #7aa2f7; color: #15161e; }
    .radar-box { height: 110px; color: #9ece6a; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bot Kontrol Paneli</h1>
    <div class="input-group"><input type="text" id="groqKey" placeholder="Groq API Key (Boşsa Env)"></div>
    <div class="input-group"><input type="text" id="host" placeholder="Sunucu IP" value="play.aesirmc.com"></div>
    <div class="input-group"><input type="text" id="username" placeholder="Bot İsmi"></div>
    <div class="input-group"><input type="password" id="password" placeholder="Şifre (/login)"></div>
    <div class="input-group"><input type="text" id="version" placeholder="Minecraft Sürümü" value="1.21.11"></div>

    <div class="btn-group">
      <button class="btn-start" onclick="startBot()">Başlat</button>
      <button class="btn-stop" onclick="stopBot()">Durdur</button>
    </div>

    <div class="status-bar" id="statusText">Durum: Kapalı</div>

    <div class="stats">
      <div class="stat-box"><div class="stat-label">PING</div><div class="stat-val" id="pingVal">- ms</div></div>
      <div class="stat-box"><div class="stat-label">TPS</div><div class="stat-val" id="tpsVal">-</div></div>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px; margin:8px 0;">Hızlı Komutlar</h3>
    <div class="btn-group">
      <button class="btn-action" onclick="sendAction('jump')">Zıpla</button>
      <button class="btn-action" onclick="sendAction('sneak')">Eğil/Kalk</button>
      <button class="btn-stop" onclick="sendAction('stop')">Dur/İptal</button>
    </div>
    <div style="margin-bottom:12px;">
      <button class="btn-warning" style="width:100%" onclick="sendAction('attack')">Yakındakine Saldır</button>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px;">Canlı Sunucu Sohbeti</h3>
    <div class="box chat-box" id="chatLogs"></div>
    <div class="chat-input">
      <input type="text" id="chatMsg" placeholder="Mesaj gönder..." onkeypress="if(event.key==='Enter') sendChat()">
      <button onclick="sendChat()">Gönder</button>
    </div>

    <h3 style="text-align:center; color:#7aa2f7; font-size:14px; margin-top:12px;">Çevre Radarı</h3>
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
      await fetch('/api/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    }
    async function stopBot() { await fetch('/api/stop', { method: 'POST' }); }
    async function sendChat() {
      const input = document.getElementById('chatMsg');
      if (!input.value) return;
      await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input.value }) });
      input.value = '';
    }
    async function sendAction(action) {
      await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: action }) });
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
          radarBox.innerHTML = data.radar.map(e => '[' + e.type + '] ' + e.name + ' (' + e.distance + 'm)').join('<br>');
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

process.on('uncaughtException', err => console.log('[ÇÖKME ÖNLENDİ]', err.message));
process.on('unhandledRejection', reason => console.log('[ÇÖKME ÖNLENDİ]', reason));

server.listen(PORT, () => console.log(`Otonom AI Agent ${PORT} portunda dinlemede.`));
