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
let humanizerTimer = null;
let armorTimer = null;
let isQueueing = false;
let mcData = null;
let isFishing = false;
let config = {};

// --- GROQ YAPAY ZEKA ARAÇLARI (TOOLS) DEFINITIONS ---
const botTools = [
  {
    type: "function",
    function: {
      name: "follow_player",
      description: "Belirtilen oyuncunun yanına gider ve onu takip eder.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Takip edilecek oyuncunun adı" }
        },
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
        properties: {
          target: { type: "string", description: "Saldırılacak oyuncu/yaratık adı" }
        },
        required: ["target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "stop_all_actions",
      description: "Tüm takibi, PvP'yi, kazmayı ve balık tutmayı anında durdurur.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "mine_block",
      description: "Etraftaki belirli bir blok türünü arar, yanına gidip kazar ve toplar.",
      parameters: {
        type: "object",
        properties: {
          blockName: { type: "string", description: "Kazılacak blok adı (ör: iron_ore, diamond_ore, stone, dirt)" }
        },
        required: ["blockName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_fishing",
      description: "Eline olta alıp otonom balık tutmaya başlar.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "farm_crops",
      description: "Yakındaki olgunlaşmış buğdayları/mahsülleri toplar ve yerine yenisini eker.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "drop_inventory",
      description: "Envanterdeki eşyaları yere atar.",
      parameters: {
        type: "object",
        properties: {
          itemName: { type: "string", description: "Atılacak eşya adı (boş bırakılırsa tümünü atar)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "say_chat",
      description: "Sadece sohbetten oyuncuya yanıt verir, fiziksel eylem yapmaz.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Sohbete yazılacak cümle" }
        },
        required: ["message"]
      }
    }
  }
];

// --- FİZİKSEL BOT EYLEMLERİ ---

function resetAllStates() {
  isFishing = false;
  if (bot) {
    try { bot.pathfinder.setGoal(null); bot.pathfinder.stop(); } catch (e) {}
    try { bot.pvp.stop(); } catch (e) {}
  }
}

function followPlayer(username) {
  resetAllStates();
  const target = bot.players[username]?.entity;
  if (!target) {
    bot.chat(`${username} yakında görünmüyor.`);
    return;
  }
  const defaultMove = new Movements(bot, mcData);
  defaultMove.canDig = false;
  bot.pathfinder.setMovements(defaultMove);
  bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
  bot.chat(`Geliyorum ${username}!`);
}

function attackTarget(targetName) {
  resetAllStates();
  let target = bot.players[targetName]?.entity;
  if (!target) {
    target = bot.nearestEntity(e => (e.type === 'mob' || e.type === 'player') && e.username === targetName);
  }
  if (!target) {
    bot.chat(`${targetName} hedefi bulunamadı.`);
    return;
  }
  bot.pvp.attack(target);
  bot.chat(`${targetName} hedefine pvp başlatıldı!`);
}

async function mineBlock(blockName) {
  resetAllStates();
  if (!mcData || !mcData.blocksByName[blockName]) {
    bot.chat(`${blockName} ismi Minecraft veritabanında bulunamadı.`);
    return;
  }
  const blockType = mcData.blocksByName[blockName].id;
  const target = bot.findBlock({ matching: blockType, maxDistance: 25 });
  if (!target) {
    bot.chat(`Yakında ${blockName} bloğu yok.`);
    return;
  }
  bot.chat(`${blockName} bloğuna gidiliyor ve kazılıyor...`);
  bot.collectBlock.collect(target, (err) => {
    if (err) bot.chat('Kazma işlemi yarıda kesildi.');
    else bot.chat('Blok başarıyla kazıldı ve toplandı.');
  });
}

async function startFishing() {
  resetAllStates();
  isFishing = true;
  const rod = bot.inventory.items().find(i => i.name.includes('fishing_rod'));
  if (!rod) {
    bot.chat('Envanterimde olta bulunamadı!');
    isFishing = false;
    return;
  }
  try {
    await bot.equip(rod, 'hand');
    bot.chat('Balık tutmaya başlıyorum...');
    loopFishing();
  } catch (e) {
    bot.chat('Olta ele alınamadı.');
  }
}

async function loopFishing() {
  if (!isFishing || !bot) return;
  try {
    await bot.fish();
    bot.chat('Bir şeyler yakaladım! Tekrar atıyorum.');
    setTimeout(() => loopFishing(), 1000);
  } catch (err) {
    if (isFishing) {
      setTimeout(() => loopFishing(), 3000);
    }
  }
}

async function farmCrops() {
  resetAllStates();
  if (!mcData) return;
  const wheatId = mcData.blocksByName['wheat']?.id;
  if (!wheatId) return;

  const crop = bot.findBlock({
    matching: (b) => b.type === wheatId && b.metadata === 7,
    maxDistance: 15
  });

  if (!crop) {
    bot.chat('Yakında olgunlaşmış mahsül bulunamadı.');
    return;
  }

  bot.chat('Mahsül toplanıyor ve yeniden ekiliyor...');
  try {
    await bot.pathfinder.goto(new goals.GoalBlock(crop.position.x, crop.position.y, crop.position.z));
    await bot.dig(crop);
    
    const seed = bot.inventory.items().find(i => i.name.includes('seed'));
    if (seed) {
      await bot.equip(seed, 'hand');
      const farmland = bot.blockAt(crop.position.down(1));
      await bot.placeBlock(farmland, new vec3(0, 1, 0));
    }
    bot.chat('Çiftçilik tamamlandı.');
  } catch (err) {
    bot.chat('Çiftçilik yaparken sorun oluştu.');
  }
}

async function dropInventory(itemName) {
  const items = bot.inventory.items();
  if (items.length === 0) {
    bot.chat('Envanterim zaten boş.');
    return;
  }
  bot.chat('Eşyalar yere bırakılıyor...');
  for (const item of items) {
    if (!itemName || item.name.includes(itemName)) {
      try {
        await bot.tossStack(item);
      } catch (e) {}
    }
  }
}

// --- GROQ AI AGENT İŞLEYİCİSİ ---

async function processAIAgent(sender, userMessage) {
  const apiKey = config.groqKey || process.env.GROQ_API_KEY;
  if (!apiKey || !bot || isQueueing) return;

  const inventorySummary = bot.inventory ? bot.inventory.items().map(i => i.name).join(', ') : 'Boş';
  const botState = {
    health: bot.health,
    food: bot.food,
    position: bot.entity ? { x: Math.round(bot.entity.position.x), y: Math.round(bot.entity.position.y), z: Math.round(bot.entity.position.z) } : null,
    nearbyPlayers: radarEntities.filter(e => e.type === 'Oyuncu').map(e => e.name),
    inventory: inventorySummary
  };

  try {
    const groq = new Groq({ apiKey });
    const response = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `Sen Minecraft'ta tam özgürlüğe ve bilince sahip otonom bir AI oyuncususun.
Senin anlık durumun: ${JSON.stringify(botState)}

Gelen mesajlara göre araçları (tools) kullanarak hangi aksiyonu alacağına (takip, saldırı, maden kazma, balık tutma, çiftçilik, durma veya eşya atma) TAMAMEN SEN KARAR VER. 
Eğer sadece konuşman gerekiyorsa say_chat aracını seç.`
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

        switch (fnName) {
          case 'follow_player':
            followPlayer(args.target || sender);
            break;
          case 'attack_target':
            attackTarget(args.target || sender);
            break;
          case 'stop_all_actions':
            resetAllStates();
            bot.chat('Tüm eylemler durduruldu.');
            break;
          case 'mine_block':
            mineBlock(args.blockName);
            break;
          case 'start_fishing':
            startFishing();
            break;
          case 'farm_crops':
            farmCrops();
            break;
          case 'drop_inventory':
            dropInventory(args.itemName);
            break;
          case 'say_chat':
            if (args.message) bot.chat(args.message);
            break;
        }
      }
    } else if (choice.content) {
      bot.chat(choice.content.trim());
    }
  } catch (err) {
    console.error('[AI AGENT HATA]', err.message);
  }
}

// --- BOT KURULUM VE SUNUCU KODLARI ---

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

function cleanBotState() {
  resetAllStates();
  if (humanizerTimer) clearInterval(humanizerTimer);
  if (armorTimer) clearInterval(armorTimer);
  humanizerTimer = null;
  armorTimer = null;
}

function equipBestArmor() {
  if (!bot || !bot.inventory || isQueueing) return;
  const slots = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };
  const items = bot.inventory.items();
  for (const item of items) {
    for (const [type, slot] of Object.entries(slots)) {
      if (item.name.endsWith(type)) bot.equip(item, slot).catch(() => {});
    }
  }
}

async function initBot() {
  cleanBotState();
  botStatus = "Bağlanıyor...";
  isQueueing = false;

  let targetVersion = config.version ? config.version.trim() : "1.21.11";

  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: targetVersion,
    hideErrors: true,
    viewDistance: 'tiny',
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
    chatLogs.push(`[SİSTEM] Bot bağlandı.`);
    bot.physicsEnabled = false;
    resetAllStates();

    mcData = require('minecraft-data')(bot.version);

    if (bot.autoEat) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: ['rotten_flesh'] };
    }

    cleanBotState();

    setTimeout(() => {
      if (bot && !isQueueing) {
        bot.physicsEnabled = true;
        chatLogs.push('[SİSTEM] Bot otonom AI Agent modunda aktif!');
        armorTimer = setInterval(() => equipBestArmor(), 5000);
      }
    }, 4000);

    if (config.password && config.password.trim() !== '') {
      setTimeout(() => {
        if (bot && !isQueueing) bot.chat(`/login ${config.password}`);
      }, 2000);
    }
  });

  bot.on('chat', async (username, message) => {
    chatLogs.push(`${username ? username + ': ' : ''}${message}`);
    if (username === bot.username || isQueueing) return;
    
    // Tüm mesajları ve komutları Otonom Yapay Zeka Ajanına Aktarır
    await processAIAgent(username, message);
  });

  bot.on('messagestr', (msg) => chatLogs.push(msg));
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
    } else {
      radarEntities = [];
    }
  }, 2000);

  bot.on('kicked', (reason) => {
    cleanBotState();
    botStatus = "Atıldı";
    chatLogs.push(`[SİSTEM] Bot atıldı: ${parseChatReason(reason)}`);
    bot = null;
  });

  bot.on('end', () => {
    cleanBotState();
    botStatus = "Kapalı";
    chatLogs.push(`[SİSTEM] Bağlantı kesildi.`);
    bot = null;
  });

  bot.on('error', (err) => chatLogs.push(`[HATA] ${err.message}`));
}

// --- EXPRESS WEB PANEL KODLARI ---

app.get('/api/status', (req, res) => {
  res.json({ status: botStatus, ping, tps, chatLogs: chatLogs.slice(-50), radar: radarEntities });
});

app.post('/api/start', (req, res) => {
  config = req.body;
  if (!config.host || !config.username) return res.status(400).json({ error: 'Bilgiler eksik!' });
  if (bot) { try { bot.quit(); } catch(e){} }
  initBot();
  res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
  cleanBotState();
  if (bot) { bot.quit(); bot = null; botStatus = "Kapalı"; }
  res.json({ success: true });
});

app.post('/api/chat', (req, res) => {
  if (bot && req.body.message) { bot.chat(req.body.message); }
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Minecraft Bot Control</title>
  <style>
    body { background: #1a1b26; color: #a9b1d6; font-family: sans-serif; padding: 20px; display: flex; justify-content: center; }
    .box { width: 100%; max-width: 480px; background: #24283b; padding: 20px; border-radius: 12px; }
    input, button { width: 100%; padding: 10px; margin-bottom: 8px; border-radius: 6px; border: none; box-sizing: border-box; }
    input { background: #1f2335; color: #fff; }
    button { background: #7aa2f7; font-weight: bold; cursor: pointer; }
    .chat { height: 180px; background: #1f2335; overflow-y: auto; padding: 8px; font-size: 12px; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Full Otonom AI Agent Panel</h2>
    <input id="groqKey" placeholder="Groq API Key">
    <input id="host" value="play.aesirmc.com" placeholder="IP">
    <input id="username" placeholder="Bot Kullanıcı Adı">
    <input id="password" type="password" placeholder="Şifre">
    <input id="version" value="1.21.11" placeholder="Sürüm">
    <button onclick="start()">Başlat</button>
    <button onclick="stop()" style="background:#f7768e;">Durdur</button>
    <div id="status" style="margin:10px 0; font-weight:bold;">Durum: Kapalı</div>
    <div class="chat" id="chat"></div>
  </div>
  <script>
    async function start() {
      await fetch('/api/start', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({
        host: document.getElementById('host').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        version: document.getElementById('version').value,
        groqKey: document.getElementById('groqKey').value
      })});
    }
    async function stop() { await fetch('/api/stop', { method: 'POST' }); }
    setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        const d = await res.json();
        document.getElementById('status').innerText = 'Durum: ' + d.status;
        const c = document.getElementById('chat');
        c.innerHTML = d.chatLogs.join('<br>');
        c.scrollTop = c.scrollHeight;
      } catch(e){}
    }, 1000);
  </script>
</body>
</html>
  `);
});

process.on('uncaughtException', err => console.log('[ÇÖKME ÖNLENDİ]', err.message));
process.on('unhandledRejection', reason => console.log('[ÇÖKME ÖNLENDİ]', reason));

server.listen(PORT, () => console.log(`Otonom AI Agent ${PORT} portunda dinlemede.`));
