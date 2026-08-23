const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const { processAI } = require('./ai');

let bot = null;
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

function lockBotForTransfer() {
  state.isQueueing = true;
  state.status = "Aktarım/TPA Bekleniyor...";
  if (bot) {
    try { bot.clearControlStates(); } catch(e){}
    try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null); } catch(e){}
    if (bot.physics) bot.physics.enabled = false; // Internal Error engelleyici
  }
  
  // 5 Saniye sonra fiziği geri aç (sunucu değişimi bitince)
  setTimeout(() => {
    if (bot && state.isQueueing) {
      if (bot.physics) bot.physics.enabled = true;
      state.isQueueing = false;
      state.status = "Çalışıyor";
      logChat('[SİSTEM] Aktarım tamamlandı.');
    }
  }, 5000);
}

function checkAutoLogin(msg) {
  const lower = msg.toLowerCase();
  // AesirMC vb. sunucularda giriş mesajları
  if (lower.includes('/login') || lower.includes('şifre') || lower.includes('giris yap')) {
    if (state.config.password && bot) {
      setTimeout(() => {
        bot.chat(`/login ${state.config.password}`);
        logChat('[SİSTEM] Otomatik /login gönderildi.');
      }, 1500);
    }
  }
}

const botActions = {
  stop: () => {
    if (bot) {
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
  state.config = config;
  state.isManualStop = false;
  state.status = "Bağlanıyor...";
  
  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: config.version || "1.21.11",
    hideErrors: true
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.on('spawn', () => {
    state.status = "Çalışıyor";
    logChat('[SİSTEM] Dünyaya giriş yapıldı.');
    if (bot.physics) bot.physics.enabled = true;
    state.isQueueing = false;
  });

  // TPA / Respawn Dondurması (Velocity/BungeeCord geçişleri)
  bot.on('respawn', lockBotForTransfer);
  bot.on('forcedMove', lockBotForTransfer);

  bot.on('messagestr', (msg) => {
    logChat(msg);
    checkAutoLogin(msg);
    
    // TPA ve Aktarım Algılama
    if (msg.includes('Aktarım yapıyorsunuz') || msg.includes('Aktarım başladı') || msg.includes('sırasına girdiniz')) {
      lockBotForTransfer();
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
    logChat(`[SİSTEM] Atıldı: ${reason}`);
    handleReconnect();
  });

  bot.on('end', () => {
    logChat('[SİSTEM] Bağlantı koptu.');
    handleReconnect();
  });
}

function handleReconnect() {
  if (state.isManualStop) return;
  state.status = "Yeniden Bağlanıyor...";
  setTimeout(() => { if (!state.isManualStop) startBot(state.config); }, 5000);
}

function stopBot() {
  state.isManualStop = true;
  state.status = "Kapalı";
  if (bot) { bot.quit(); bot = null; }
}

function sendChat(msg) {
  if (bot && !state.isQueueing) {
    bot.chat(msg);
    logChat(`[SİZ]: ${msg}`);
  }
}

function sendAction(action) {
  if (!bot || state.isQueueing) return;
  if (action === 'jump') { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500); }
  else if (action === 'sneak') bot.setControlState('sneak', !bot.getControlState('sneak'));
  else if (action === 'stop') botActions.stop();
}

function getStatus() { return state; }

module.exports = { startBot, stopBot, sendChat, sendAction, getStatus };
