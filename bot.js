const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const { processAI } = require('./ai');

let bot = null;
let isLoggedIn = false;
let transferTimeout = null; 
let reconnectTimeout = null;
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
      if (parsed.text) return parsed.text;
      if (parsed.extra) return parsed.extra.map(e => e.text || '').join('');
      return reason;
    }
    if (typeof reason === 'object') {
      if (reason.type === 'compound' && reason.value && reason.value.text && reason.value.text.value) {
        return reason.value.text.value;
      }
      if (reason.text) return reason.text;
      if (reason.extra) return reason.extra.map(e => e.text || '').join('');
      return JSON.stringify(reason);
    }
  } catch (e) {
    return typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
  }
  return String(reason);
}

// YENİ SİSTEM: Bot sadece durumunu kitler, ASLA paket göndermez (Ölü Taklidi)
function lockBotForTransfer(isLongQueue = false) {
  state.isQueueing = true;
  state.status = isLongQueue ? "Sırada / Yapılandırmada..." : "Aktarım Bekleniyor...";
  
  if (transferTimeout) clearTimeout(transferTimeout);
  
  // Sıra varsa daha uzun bekle (15 sn), normal geçişse (6 sn)
  transferTimeout = setTimeout(() => {
    if (bot && state.isQueueing) {
      state.isQueueing = false;
      state.status = "Çalışıyor";
      logChat('[SİSTEM] Aktarım/Sıra süresi doldu, kilidi açtım.');
    }
  }, isLongQueue ? 15000 : 6000);
}

function checkAutoLogin(msg) {
  const lower = msg.toLowerCase();
  if ((lower.includes('/login') || lower.includes('şifre') || lower.includes('giris yap')) && !isLoggedIn) {
    isLoggedIn = true; 
    if (state.config.password && bot) {
      setTimeout(() => {
        bot.chat(`/login ${state.config.password}`);
        logChat('[SİSTEM] Otomatik /login gönderildi.');
      }, 1000);
    }
  }
}

const botActions = {
  stop: () => {
    if (bot && !state.isQueueing) { // Geçiş esnasında durdurma komutunu bile engelle
      try { bot.clearControlStates(); } catch(e){}
      try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null); } catch(e){}
      try { bot.pvp.stop(); } catch(e){}
    }
  },
  follow: (targetName) => {
    if (state.isQueueing || !bot) return;
    botActions.stop();
    const target = bot.players[targetName]?.entity;
    if (target) {
      const mcData = require('minecraft-data')(bot.version);
      const move = new Movements(bot, mcData);
      bot.pathfinder.setMovements(move);
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
      bot.chat(`Geliyorum ${targetName}!`);
    }
  },
  attack: (targetName) => {
    if (state.isQueueing || !bot) return;
    botActions.stop();
    const target = bot.players[targetName]?.entity;
    if (target) bot.pvp.attack(target);
  }
};

function startBot(config) {
  if (bot) {
    try { bot.quit(); } catch(e) {}
    bot = null;
  }

  state.config = config;
  state.isManualStop = false;
  state.status = "Bağlanıyor...";
  isLoggedIn = false;
  
  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: config.version || "1.21.11",
    hideErrors: true,
    brand: "vanilla"
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.on('spawn', () => {
    // Matruşka sunucularda peş peşe spawn atılabileceği için kilidi anında açmıyoruz.
    // 2 saniye bekleyip ortalığın durulduğundan emin oluyoruz.
    setTimeout(() => {
      if (bot) {
        state.status = "Doğdu / Çalışıyor";
        state.isQueueing = false;
        logChat('[SİSTEM] Dünyaya başarıyla yerleşildi.');
      }
    }, 2000);
  });

  bot.on('respawn', () => {
    logChat('[SİSTEM] Sunucu değişimi / Yapılandırma algılandı.');
    lockBotForTransfer(false);
  });

  bot.on('messagestr', (msg) => {
    logChat(msg);
    checkAutoLogin(msg);
    
    // AesirGuard sıra sistemi ve aktarımlarını yakalama
    if (msg.includes('sırasına girdiniz') || msg.includes('Sıranız:')) {
      lockBotForTransfer(true); // Uzun kilit (Sıra bekleme)
    } else if (msg.includes('Aktarım yapıyorsunuz') || msg.includes('Aktarım başladı')) {
      lockBotForTransfer(false); // Kısa kilit
    }
  });

  bot.on('chat', async (username, message) => {
    if (username === bot.username || state.isQueueing) return;
    
    const botState = {
      health: bot.health,
      position: bot.entity ? bot.entity.position : null,
      inventory: 'Dolu' 
    };
    
    await processAI(bot, botState, username, message, state.config.groqKey, botActions);
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
    const clearReason = parseKickReason(reason);
    logChat(`[SİSTEM ATILMA] Neden: ${clearReason}`);
    handleReconnect();
  });

  bot.on('end', (reason) => {
    logChat(`[SİSTEM] Bağlantı sonlandı.`);
    handleReconnect();
  });
  
  bot.on('error', (err) => {
    logChat(`[SİSTEM HATA] ${err.message}`);
  });
}

function handleReconnect() {
  if (state.isManualStop) return;
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  state.status = "Yeniden Bağlanıyor (5s)...";
  reconnectTimeout = setTimeout(() => { 
    if (!state.isManualStop) startBot(state.config); 
  }, 5000); 
}

function stopBot() {
  state.isManualStop = true;
  state.status = "Kapalı";
  if (bot) { bot.quit(); bot = null; }
  if (transferTimeout) clearTimeout(transferTimeout);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
}

function sendChat(msg) {
  if (bot) {
    bot.chat(msg);
    logChat(`[SİZ]: ${msg}`);
  }
}

function sendAction(action) {
  // Sırada beklerken panelden hareket tuşlarına basılmasını da engelle
  if (!bot || state.isQueueing) return;
  
  if (action === 'jump') { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); }
  else if (action === 'sneak') bot.setControlState('sneak', !bot.getControlState('sneak'));
  else if (action === 'stop') botActions.stop();
}

function getStatus() { return state; }

module.exports = { startBot, stopBot, sendChat, sendAction, getStatus };
