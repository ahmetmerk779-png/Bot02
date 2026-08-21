const express = require('express');
const mineflayer = require('mineflayer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const armorManager = require('mineflayer-armor-manager');
const pvp = require('mineflayer-pvp').plugin;
const tpsPlugin = require('mineflayer-tps')(mineflayer);
const viewer = require('prismarine-viewer').mineflayer;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let bot = null;
let currentConfig = null;
let shouldReconnect = false;
let autoDefense = true;
let viewerStarted = false;
let chatLogs = [];

// --- OPTİMİZE EDİLMİŞ PATHFINDER HAREKET MOTORU ---
function createOptimizedMovements(bot) {
  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);

  movements.canDig = false;
  movements.scafolding = false;
  movements.allowParkour = false;
  movements.allow1by1 = true;

  return movements;
}

// --- INTENT MATCHING: DÜNYA VE BOT DURUMUNU YAKALAYICI ---
function getBotWorldContext(bot) {
  if (!bot || !bot.entity) return "Bot henüz oyunda değil.";

  const inventory = bot.inventory.items().map(i => `${i.name} (x${i.count})`).join(', ') || 'Boş';
  
  const nearbyEntities = [];
  for (const id in bot.entities) {
    const e = bot.entities[id];
    if (e !== bot.entity && (e.type === 'player' || e.type === 'mob')) {
      const dist = Math.round(bot.entity.position.distanceTo(e.position));
      if (dist <= 15) {
        nearbyEntities.push(`${e.type === 'player' ? 'Oyuncu' : 'Mob'}: ${e.username || e.name} (${dist}m)`);
      }
    }
  }

  const nearbyBlocks = [];
  const blocksToScan = ['chest', 'shulker_box', 'ender_chest', 'wheat', 'carrots', 'water', 'lava'];
  const scanned = bot.findBlocks({
    matching: (b) => blocksToScan.some(name => b.name.includes(name)),
    maxDistance: 8,
    count: 5
  });
  scanned.forEach(pos => {
    const b = bot.blockAt(pos);
    if (b) nearbyBlocks.push(`${b.name} (${Math.round(bot.entity.position.distanceTo(pos))}m uzakta)`);
  });

  return `
[BOT DURUMU]
Can: ${bot.health}/20, Açlık: ${bot.food}/20
Pozisyon: X:${Math.round(bot.entity.position.x)} Y:${Math.round(bot.entity.position.y)} Z:${Math.round(bot.entity.position.z)}
Envanter: ${inventory}
Yakındaki Varlıklar: ${nearbyEntities.length > 0 ? nearbyEntities.join(', ') : 'Kimse yok'}
Yakındaki Özel Bloklar: ${nearbyBlocks.length > 0 ? nearbyBlocks.join(', ') : 'Belirgin blok yok'}
`;
}

// --- AKILLI AI VE KOD ÜRETİCİ ---
async function generateAiBehavior(sender, userMessage, apiKey) {
  const keyToUse = apiKey || process.env.GEMINI_API_KEY;

  if (!keyToUse) {
    console.error("Gemini API Anahtarı bulunamadı! Lütfen Render panelinde GEMINI_API_KEY değişkenini ayarlayın.");
    return null;
  }

  const worldContext = getBotWorldContext(bot);
  const genAI = new GoogleGenerativeAI(keyToUse);
  
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
    systemInstruction: `Sen tam bağımsız, zeki bir Minecraft botusun. Sana verilen anlık oyun durumunu ve oyuncunun mesajını incele. 
Senden beklenen yanıt SADECE şu JSON yapısıdır (Markdown backtick kullanma):
{
  "yanit": "Oyuncuya vereceğin Türkçe cevap",
  "code": "Çalıştırılacak JavaScript/Mineflayer kodu string olarak"
}

Kullanabileceğin Nesneler (Kod İçinde):
- bot: Mineflayer bot nesnesi
- goals, Movements, pathfinder, pvp, mcData: Helper kütüphaneler
- sender: Mesajı atan oyuncunun kullanıcı adı ("${sender}")

KOD YAZMA VE GÜVENLİK KURALLARI:
1. Pathfinder kullanırken hedef mesafe 30 bloktan fazlaysa asla işlem başlatma.
2. Yeni bir rotaya girmeden önce mutlaka "bot.pathfinder.stop();" çalıştır.
3. Takip işlemlerinde mesafeyi yakın tut (örneğin: new goals.GoalFollow(target, 2)).
4. Kodu yazarken async/await kullanabilirsin. Temiz ve çökme yaratmayacak Mineflayer kodu yaz.`
  });

  try {
    const prompt = `GELEN MESAJ (${sender}): "${userMessage}"\n\nMEVCUT DÜNYA DURUMU:\n${worldContext}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().replace(/```json|```/g, '').trim();
    console.log("AI Üretilen Yanıt ve Kod:", text);
    return JSON.parse(text);
  } catch (err) {
    console.error("AI Yanıt Üretme Hatası:", err);
    return null;
  }
}

// --- KİLİTLENMEYİ ÖNLEYEN VE ZAMAN AŞIMLI GÜVENLİ KOD ÇALIŞTIRICI ---
async function runSafeCode(codeStr, sender) {
  if (!codeStr || codeStr.trim() === 'null') return;

  if (bot.pathfinder) bot.pathfinder.stop();

  try {
    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = createOptimizedMovements(bot);
    bot.pathfinder.setMovements(defaultMove);

    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const dynamicFunction = new AsyncFunction('bot', 'goals', 'Movements', 'pvp', 'mcData', 'sender', codeStr);

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Kod çalıştırma zaman aşımına uğradı (Timeout)")), 8000)
    );

    await Promise.race([
      dynamicFunction(bot, goals, Movements, pvp, mcData, sender),
      timeoutPromise
    ]);

  } catch (err) {
    console.error("Dinamik Kod/Pathfinder Hatası:", err.message);
    if (bot.pathfinder) bot.pathfinder.stop();
    bot.chat(`/msg ${sender} Hata: ${err.message}`);
  }
}

// --- API ENDPOINT'LERİ ---
app.post('/api/chat', (req, res) => {
  if (!bot) return res.status(400).json({ message: 'Bot kapalı!' });
  const { message } = req.body;
  if (message) { bot.chat(message); chatLogs.push(`[SEN] ${message}`); }
  res.json({ success: true });
});

app.post('/api/command', (req, res) => {
  if (!bot) return res.status(400).json({ message: 'Bot kapalı!' });
  const { action } = req.body; 
  if (action === 'jump') bot.setControlState('jump', true), setTimeout(() => bot.setControlState('jump', false), 500);
  if (action === 'sneak') bot.setControlState('sneak', !bot.controlState.sneak);
  if (action === 'stop_attack') { bot.pvp.stop(); bot.pathfinder.stop(); bot.clearControlStates(); }
  if (action === 'attack') {
    const target = bot.nearestEntity(e => (e.type === 'player' || e.type === 'mob') && e.username !== bot.username);
    if (target) { bot.pvp.attack(target); return res.json({ message: 'Saldırılıyor: ' + (target.username || target.name) }); } 
    else { return res.json({ message: 'Yakında hedef bulunamadı.' }); }
  }
  res.json({ message: 'Komut uygulandı: ' + action });
});

app.post('/api/start', async (req, res) => {
  if (bot) return res.status(400).json({ message: 'Bot çalışıyor!' });
  currentConfig = req.body;
  shouldReconnect = true; chatLogs = [];
  await startBot(currentConfig);
  res.json({ message: 'Bot başlatıldı.' });
});

app.post('/api/stop', (req, res) => {
  if (!bot) return res.status(400).json({ message: 'Bot kapalı!' });
  shouldReconnect = false; bot.quit(); bot = null;
  res.json({ message: 'Bot durduruldu.' });
});

app.get('/api/status', (req, res) => {
  let radar = [], inventory = [], ping = 0, tps = '20.0';
  if (bot) {
    if (bot.players && bot.players[bot.username]) ping = bot.players[bot.username].ping || 0;
    if (typeof bot.getTps === 'function') tps = bot.getTps().toFixed(1);
    if (bot.entities) {
      for (const id in bot.entities) {
        const entity = bot.entities[id];
        if ((entity.type === 'player' || entity.type === 'mob') && entity.username !== bot.username) {
          radar.push(`[${entity.type === 'player' ? 'Oyuncu' : 'Mob'}] ${entity.username || entity.name} (${Math.round(bot.entity.position.distanceTo(entity.position))}m)`);
        }
      }
    }
    if (bot.inventory) bot.inventory.items().forEach(item => inventory.push(`${item.name} x${item.count}`));
  }
  res.json({ 
    status: bot ? 'Çalışıyor' : 'Kapalı', username: bot ? bot.username : '-', ping, tps,
    radar: radar.length > 0 ? radar : ['Yakında kimse yok.'],
    inventory: inventory.length > 0 ? inventory : ['Envanter boş.'],
    chat: chatLogs.slice(-20) 
  });
});

// --- BOT BAŞLATMA VE EVENTLER ---
async function startBot(config) {
  // ESM paket dinamik olarak import ediliyor
  const autoEatModule = await import('mineflayer-auto-eat');
  const autoeat = autoEatModule.plugin || autoEatModule.default;

  bot = mineflayer.createBot({
    host: config.host, port: parseInt(config.port) || 25565,
    username: config.username, version: config.version || '1.21.11'
  });

  bot.loadPlugin(pathfinder); 
  if (autoeat) bot.loadPlugin(autoeat);
  bot.loadPlugin(armorManager); 
  bot.loadPlugin(pvp); 
  bot.loadPlugin(tpsPlugin);

  bot.on('spawn', () => {
    console.log(`${bot.username} giriş yaptı!`);
    if (bot.autoEat) {
      bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: ['rotten_flesh'] };
    }
    
    bot.pathfinder.thinkTimeout = 1000;
    bot.pathfinder.tickTimeout = 20;

    chatLogs.push(`[SİSTEM] Bot sunucuya bağlandı.`);
    
    if (config.authPassword && config.authPassword.trim() !== '') {
      setTimeout(() => { bot.chat(`/login ${config.authPassword}`); chatLogs.push(`[SİSTEM] Otomatik giriş yapıldı.`); }, 1000);
    }
    if (!viewerStarted) { try { viewer(bot, { port: 3001, firstPerson: true }); viewerStarted = true; } catch (err) {} }
  });

  bot.on('message', (message) => {
    const text = message.toString();
    if (text.trim().length > 0) { chatLogs.push(text); if (chatLogs.length > 30) chatLogs.shift(); }
  });

  bot.on('playerCollect', (collector) => {
    if (collector !== bot.entity) return;
    setTimeout(() => { 
      bot.armorManager.equipAll(); 
      if (!bot.inventory.slots[45]) { 
        const offhandItem = bot.inventory.items().find(item => item.name.includes('totem') || item.name.includes('shield'));
        if (offhandItem) bot.equip(offhandItem, 'off-hand').catch(()=>{});
      }
    }, 100);
  });

  bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity || !autoDefense) return;
    const threat = bot.nearestEntity(e => (e.type === 'player' || e.type === 'mob') && e.position.distanceTo(bot.entity.position) < 4 && e.username !== bot.username);
    if (threat) bot.pvp.attack(threat);
  });

  bot.on('whisper', async (username, message) => {
    if (username === bot.username) return;
    bot.chat(`/msg ${username} Analiz ediyorum...`);

    const apiKey = (config && config.apiKey) || process.env.GEMINI_API_KEY;
    const aiResult = await generateAiBehavior(username, message, apiKey);

    if (!aiResult) {
      bot.chat(`/msg ${username} Bir şeyler ters gitti, durumu anlayamadım.`);
      return;
    }

    if (aiResult.yanit) bot.chat(`/msg ${username} ${aiResult.yanit}`);
    if (aiResult.code) await runSafeCode(aiResult.code, username);
  });

  bot.on('end', () => {
    bot = null; chatLogs.push(`[SİSTEM] Bot sunucudan ayrıldı.`);
    if (shouldReconnect && currentConfig) setTimeout(() => startBot(currentConfig), 10000);
  });
}

// --- WEB ARAYÜZÜ (HTML) ---
const html = `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minecraft Gelişmiş Bot Paneli</title>
  <style>
    body { font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; margin: 0; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; padding: 20px; box-sizing: border-box; }
    .container { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; width: 100%; max-width: 1100px; }
    .panel { background: #313244; padding: 20px; border-radius: 12px; width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
    input, select, button { width: 100%; padding: 10px; margin-top: 8px; box-sizing: border-box; border-radius: 6px; border: none; background: #45475a; color: white; }
    button { background: #a6e3a1; color: #11111b; font-weight: bold; cursor: pointer; margin-top: 15px; transition: 0.2s; }
    button:hover { background: #89b482; }
    .btn-stop { background: #f38ba8; }
    .btn-warn { background: #fab387; color: #11111b; }
    .btn-blue { background: #89b4fa; color: #11111b; }
    .fast-cmds { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 15px; }
    .fast-cmds button { margin: 0; font-size: 12px; padding: 8px; }
    .metrics { display: flex; gap: 10px; margin-top: 15px; }
    .metric-card { flex: 1; background: #11111b; padding: 10px; border-radius: 6px; text-align: center; }
    .metric-title { font-size: 11px; color: #a6adc8; font-weight: bold; }
    .metric-value { font-size: 18px; font-weight: bold; margin-top: 5px; transition: color 0.3s; }
    .box-area { background: #11111b; padding: 10px; border-radius: 6px; margin-top: 10px; flex: 1; min-height: 120px; overflow-y: auto; font-size: 12px; font-family: monospace; color: #f9e2af; display: flex; flex-direction: column;}
    .chat-msg { margin-bottom: 3px; word-wrap: break-word; }
    h2, h4 { text-align: center; margin: 5px 0; color: #a6e3a1; }
    .chat-input-wrapper { display: flex; gap: 5px; margin-top: 5px; }
    .chat-input-wrapper input { margin-top: 0; flex: 1; }
    .chat-input-wrapper button { margin-top: 0; width: auto; padding: 0 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="panel">
      <h2>Bot Kontrol Paneli</h2>
      <input type="password" id="apiKey" placeholder="Gemini API (Boşsa Render Env Kullanır)">
      <input type="text" id="host" placeholder="Sunucu IP">
      <input type="text" id="username" placeholder="Bot İsmi">
      <input type="password" id="authPassword" placeholder="Sunucu Şifresi (/login)">
      <div style="display: flex; gap: 10px;">
        <button onclick="startBot()">Başlat</button>
        <button onclick="stopBot()" class="btn-stop">Durdur</button>
      </div>
      <div id="status-text" style="text-align:center; margin-top:15px; font-weight:bold;">Durum: Bekleniyor...</div>
      <div class="metrics">
        <div class="metric-card"><div class="metric-title">PING</div><div class="metric-value" id="ping-text">- ms</div></div>
        <div class="metric-card"><div class="metric-title">TPS</div><div class="metric-value" id="tps-text">-</div></div>
      </div>
      <h4>Hızlı Komutlar</h4>
      <div class="fast-cmds">
        <button onclick="sendCmd('jump')">Zıpla</button>
        <button onclick="sendCmd('sneak')">Eğil/Kalk</button>
        <button onclick="sendCmd('stop_attack')" class="btn-stop">Dur/İptal</button>
        <button onclick="sendCmd('attack')" class="btn-warn" style="grid-column: span 3;">Yakındakine Saldır</button>
      </div>
    </div>
    <div class="panel" style="width: 350px;">
      <h4>Canlı Sunucu Sohbeti</h4>
      <div class="box-area" id="chat-box" style="color: #cdd6f4;">Bekleniyor...</div>
      <div class="chat-input-wrapper">
        <input type="text" id="chat-input" placeholder="Mesaj gönder...">
        <button onclick="sendChat()" class="btn-blue">Gönder</button>
      </div>
      <h4 style="margin-top:20px;">Çevre Radarı</h4>
      <div class="box-area" id="radar">Yakında kimse yok.</div>
    </div>
    <div class="panel" style="width: 350px;">
      <h4>Canlı Envanter</h4>
      <div class="box-area" id="inventory-box" style="color: #a6e3a1;">Envanter boş.</div>
      <h4 style="margin-top:20px;">3D Harita</h4>
      <button onclick="toggleViewer()" class="btn-blue" id="viewer-btn" style="margin-top:0;">Haritayı Yükle</button>
      <iframe id="viewer-frame" style="width:100%; height:200px; border:none; border-radius:6px; background:#11111b; margin-top:5px;"></iframe>
    </div>
  </div>
  <script>
    window.onload = () => { ['apiKey', 'host', 'username', 'authPassword'].forEach(id => { if(localStorage.getItem('mc_'+id)) document.getElementById(id).value = localStorage.getItem('mc_'+id); }); };
    function toggleViewer() { const frame = document.getElementById('viewer-frame'); if(frame.src.includes('3001')) frame.src = ''; else frame.src = \`http://\${window.location.hostname}:3001\`; }
    async function sendChat() { const input = document.getElementById('chat-input'); if(input.value.trim() === '') return; await fetch('/api/chat', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({message: input.value}) }); input.value = ''; }
    async function sendCmd(action) { const res = await fetch('/api/command', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action}) }); const data = await res.json(); if(data.message) alert(data.message); }
    async function startBot() { const data = { port: 25565, version: '1.21.11' }; ['apiKey', 'host', 'username', 'authPassword'].forEach(id => { data[id] = document.getElementById(id).value; localStorage.setItem('mc_'+id, data[id]); }); const res = await fetch('/api/start', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data) }); alert((await res.json()).message); }
    async function stopBot() { const res = await fetch('/api/stop', { method: 'POST' }); alert((await res.json()).message); }
    setInterval(async () => {
      try {
        const res = await fetch('/api/status'); const data = await res.json();
        document.getElementById('status-text').innerText = 'Durum: ' + data.status + ' (' + data.username + ')';
        document.getElementById('radar').innerHTML = data.radar.join('<br>');
        document.getElementById('inventory-box').innerHTML = data.inventory.join('<br>');
        const chatBox = document.getElementById('chat-box'); const wasAtBottom = chatBox.scrollHeight - chatBox.scrollTop <= chatBox.clientHeight + 10;
        chatBox.innerHTML = data.chat.map(m => \`<div class="chat-msg">\${m}</div>\`).join('');
        if(wasAtBottom) chatBox.scrollTop = chatBox.scrollHeight;
        const pingEl = document.getElementById('ping-text'); const tpsEl = document.getElementById('tps-text');
        if(data.status === 'Çalışıyor') { pingEl.innerText = data.ping + ' ms'; tpsEl.innerText = data.tps; pingEl.style.color = data.ping < 80 ? '#a6e3a1' : (data.ping < 200 ? '#f9e2af' : '#f38ba8'); tpsEl.style.color = data.tps > 18.5 ? '#a6e3a1' : (data.tps > 14 ? '#f9e2af' : '#f38ba8'); } else { pingEl.innerText = '- ms'; tpsEl.innerText = '-'; pingEl.style.color = '#cdd6f4'; tpsEl.style.color = '#cdd6f4'; }
      } catch(e) {}
    }, 2000);
  </script>
</body>
</html>
`;

app.get('/', (req, res) => {
  res.send(html);
});

app.listen(port, () => console.log(`Sunucu ${port} portunda çalışıyor`));
