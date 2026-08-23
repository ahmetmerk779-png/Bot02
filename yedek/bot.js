
const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const { processAI } = require('./ai');

let bot = null;
let isLoggedIn = false;
let reconnectTimeout = null;
let transferTimeout = null;
let lastMessageTime = 0; // Spam koruması için zamanlayıcı

let state = {
  status: "Kapalı", ping: "-", tps: "-",
  chatLogs: [], radar: [],
  isQueueing: false, isManualStop: false,
  config: {}
};

function logChat(msg) {
  state.chatLogs.push(msg);
  if (state.chatLogs.length > 50) state.chatLogs.shift();
}

function parseKickReason(reason) {
  if (!reason) return "Bilinmeyen Neden";
  try {
    if (typeof reason === 'string') {
      const parsed = JSON.parse(reason);
      return parsed.text || parsed.extra?.map(e => e.text).join('') || reason;
    }
    if (typeof reason === 'object') {
      return reason.text || reason.extra?.map(e => e.text).join('') || JSON.stringify(reason);
    }
  } catch (e) {}
  return String(reason);
}

function checkAutoLogin(msg) {
  const lower = msg.toLowerCase();
  if ((lower.includes('/login') || lower.includes('şifre') || lower.includes('giris yap')) && !isLoggedIn) {
    isLoggedIn = true; 
    if (state.config.password && bot) {
      setTimeout(() => {
        bot.chat(`/login ${state.config.password}`);
        logChat('[SİSTEM] Otomatik /login gönderildi.');
      }, 2000); 
    }
  }
}

const botActions = {
  stop: () => {
    if (bot && !state.isQueueing) {
      try { bot.clearControlStates(); } catch(e){}
      try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null); } catch(e){}
      try { bot.pvp.stop(); } catch(e){}
    }
  },
  follow: (targetName) => {
    if (state.isQueueing || !bot) return;
    botActions.stop();
    
    // Gelişmiş Hedef Bulma
    const target = Object.values(bot.entities).find(e => 
      e.type === 'player' && 
      e.username && 
      e.username.toLowerCase().includes(targetName.toLowerCase())
    );

    if (target) {
      const mcData = require('minecraft-data')(bot.version);
      const move = new Movements(bot, mcData);
      move.allow1by1towers = false;
      move.canDig = false; 
      
      bot.pathfinder.setMovements(move);
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);
      logChat(`[SİSTEM] Hedef kilitlendi: ${target.username}, peşine düşüldü!`);
    } else {
      logChat(`[SİSTEM] ${targetName} radarda yok!`);
    }
  },
  attack: (targetName) => {
    if (state.isQueueing || !bot) return;
    botActions.stop();
    const target = Object.values(bot.entities).find(e => e.type === 'player' && e.username && e.username.toLowerCase().includes(targetName.toLowerCase()));
    if (target) bot.pvp.attack(target);
  }
};

function lockBotForTransfer(timeoutMs = 20000) {
  state.isQueueing = true;
  state.status = "Aktarım / Güvenlik Bekleniyor...";
  
  if (bot) {
    try { bot.pathfinder.setGoal(null); } catch(e){}
    try { bot.clearControlStates(); } catch(e){}
  }
  
  if (transferTimeout) clearTimeout(transferTimeout);
  transferTimeout = setTimeout(() => {
    if (bot && state.isQueueing) {
      state.isQueueing = false;
      state.status = "Çalışıyor";
    }
  }, timeoutMs);
}

function startBot(config) {
  if (bot) {
    try { bot.quit(); } catch(e) {}
    bot = null;
  }

  state.config = config;
  state.isManualStop = false;
  state.status = "Bağlanıyor...";
  isLoggedIn = false;
  state.isQueueing = true;
  
  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: config.version || "1.21.11",
    hideErrors: true,
    brand: 'vanilla',
    checkTimeoutInterval: 120000
  });

  // 🛡️ MOTOR YÜKLENDİKTEN SONRA KALKANLARI AKTİF ET
  bot.on('inject_allowed', () => {
    
    // 1. Ağ paketi koruması (Velocity İçin)
    if (bot && bot._client) {
      const originalWrite = bot._client.write.bind(bot._client);
      bot._client.write = (name, data) => {
        if (state.isQueueing) {
          const blockedPackets = [
            'position', 'position_look', 'look', 'flying', 
            'settings', 'client_information', 
            'arm_animation', 'use_item', 'block_place', 'vehicle_move',
            'teleport_confirm', 'steer_vehicle'
          ];
          if (blockedPackets.includes(name)) return; 
        }
        originalWrite(name, data);
      };
    }

    // 2. Mutlak Spam Koruması (AI çıldırsa bile spam atamaz)
    if (typeof bot.chat === 'function') {
      const originalChat = bot.chat.bind(bot);
      bot.chat = (msg) => {
        const now = Date.now();
        if (now - lastMessageTime > 3500) { 
          originalChat(msg);
          lastMessageTime = now;
        } else {
          logChat(`[SPAM DUVARI] Yutuldu: ${msg}`);
        }
      };
    }
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.on('spawn', () => {
    lockBotForTransfer(8000);
    setTimeout(() => {
      if (bot && bot._client) {
        try {
          bot._client.write('client_information', {
            locale: 'en_US', viewDistance: 8, chatMode: 0, chatColors: true,
            displayedSkinParts: 127, mainHand: 1, enableTextFiltering: false, allowServerListings: true
          });
        } catch(e) {}
      }
    }, 4000);
  });

  bot.on('forcedMove', () => {
    try { bot.clearControlStates(); } catch(e){}
    try { bot.pathfinder.setGoal(null); } catch(e){}
  });

  bot.on('messagestr', async (msg) => {
    logChat(msg);
    checkAutoLogin(msg);
    const lower = msg.toLowerCase();
    
    if (lower.includes('sırasına girdiniz') || lower.includes('aktarım yapıyorsunuz') || lower.includes('yeniden başlatılıyor')) {
        lockBotForTransfer(15000); 
    } else if (lower.includes('başarıyla giriş') || lower.includes('login succes')) {
        lockBotForTransfer(8000);
    }

    // 🔥 ÖZEL MESAJ YAKALAYICI (AesirMC Formatı)
    const ozelMesajSistemi = msg.match(/\[([a-zA-Z0-9_]+)\s*(?:->|»)\s*([a-zA-Z0-9_]+)\]\s*(.*)/);
    
    if (ozelMesajSistemi) {
      const gonderen = ozelMesajSistemi[1];
      const alici = ozelMesajSistemi[2];
      const icerik = ozelMesajSistemi[3];

      if (alici.toLowerCase() === bot.username.toLowerCase() && gonderen !== bot.username) {
        logChat(`[ÖZEL YAKALANDI] ${gonderen}: ${icerik}`);
        const botState = { health: bot.health, position: bot.entity ? bot.entity.position : null, inventory: 'Dolu' };
        await processAI(bot, botState, gonderen, icerik, state.config.groqKey, botActions, true);
      }
    }
  });

  bot.on('chat', async (username, message) => {
    if (!username || username === bot.username || state.isQueueing) return;
    if (!message.toLowerCase().includes(bot.username.toLowerCase())) return;

    const botState = { health: bot.health, position: bot.entity ? bot.entity.position : null, inventory: 'Dolu' };
    await processAI(bot, botState, username, message, state.config.groqKey, botActions, false);
  });

  bot.on('whisper', async (username, message) => {
    if (!username || username === bot.username || state.isQueueing) return;
    const botState = { health: bot.health, position: bot.entity ? bot.entity.position : null, inventory: 'Dolu' };
    await processAI(bot, botState, username, message, state.config.groqKey, botActions, true);
  });

  setInterval(() => {
    if (bot && bot.entities && !state.isQueueing) {
      state.ping = bot.player ? bot.player.ping : '-';
      const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity && e.type === 'player')
        .map(e => ({ name: e.username, type: 'Oyuncu', distance: Math.round(bot.entity.position.distanceTo(e.position)) }))
        .filter(e => e.distance <= 50).sort((a, b) => a.distance - b.distance);
      state.radar = entities.slice(0, 10);
    }
  }, 2000);

  bot.on('kicked', (reason) => {
    logChat(`[ATILMA] ${parseKickReason(reason)}`);
    handleReconnect();
  });
  bot.on('end', () => { handleReconnect(); });
}

function handleReconnect() {
  if (state.isManualStop) return;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  state.status = "Yeniden Bağlanıyor...";
  reconnectTimeout = setTimeout(() => { if (!state.isManualStop) startBot(state.config); }, 5000); 
}

function stopBot() {
  state.isManualStop = true;
  state.status = "Kapalı";
  if (bot) { bot.quit(); bot = null; }
  if (transferTimeout) clearTimeout(transferTimeout);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
}

function sendChat(msg) {
  if (bot) { bot.chat(msg); logChat(`[SİZ]: ${msg}`); }
}

function sendAction(action) {
  if (!bot || state.isQueueing) return;
  if (action === 'jump') { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); }
  else if (action === 'sneak') bot.setControlState('sneak', !bot.getControlState('sneak'));
  else if (action === 'stop') botActions.stop();
}

function getStatus() { return state; }
module.exports = { startBot, stopBot, sendChat, sendAction, getStatus };
