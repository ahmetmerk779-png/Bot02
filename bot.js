const mineflayer = require('mineflayer');
const { pathfinder, goals, Movements } = require('mineflayer-pathfinder');
const { plugin: pvp } = require('mineflayer-pvp');
const { plugin: collectBlock } = require('mineflayer-collectblock');
const { processAI } = require('./ai');

let bot = null;
let isLoggedIn = false;
let reconnectTimeout = null;
let transferTimeout = null;
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
      }, 1500); 
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
    const target = bot.players[targetName]?.entity;
    if (target) {
      const mcData = require('minecraft-data')(bot.version);
      const move = new Movements(bot, mcData);
      bot.pathfinder.setMovements(move);
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
    }
  },
  attack: (targetName) => {
    if (state.isQueueing || !bot) return;
    botActions.stop();
    const target = bot.players[targetName]?.entity;
    if (target) bot.pvp.attack(target);
  }
};

function lockBotForTransfer(timeoutMs = 15000) {
  state.isQueueing = true;
  state.status = "Aktarım Bekleniyor...";
  
  if (bot) {
    try { bot.pathfinder.setGoal(null); } catch(e){}
  }
  
  if (transferTimeout) clearTimeout(transferTimeout);
  transferTimeout = setTimeout(() => {
    if (bot && state.isQueueing) {
      state.isQueueing = false;
      state.status = "Çalışıyor";
      logChat('[SİSTEM] Bekleme süresi doldu, duvar açıldı.');
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
  
  // 🛡️ VANILLA İSTEMCİ MASKeleme (Velocity'yi kandırmak için)
  bot = mineflayer.createBot({
    host: config.host,
    username: config.username,
    version: config.version || "1.21.11",
    hideErrors: true,
    // Sunucuya orijinal istemci gibi görünmek için brand bilgisini vanilla yapıyoruz
    brand: 'vanilla',
    checkTimeoutInterval: 60000 // Sunucu gecikmelerinden dolayı erken kopmayı engellemek için timeout süresini uzatıyoruz
  });

  if (bot && bot._client) {
    const originalWrite = bot._client.write.bind(bot._client);
    bot._client.write = (name, data) => {
      if (state.isQueueing) {
        const unsafePackets = [
          'position', 'position_look', 'look', 'flying', 
          'settings', 'client_information', 
          'arm_animation', 'use_item', 'block_place', 'vehicle_move',
          'teleport_confirm'
        ];
        
        if (unsafePackets.includes(name)) {
          return; 
        }
      }
      originalWrite(name, data);
    };

    bot._client.on('error', (err) => {
      logChat(`[PROTOKOL UYARI]: ${err.message}`);
    });
  }

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);
  bot.loadPlugin(collectBlock);

  bot.on('spawn', () => {
    logChat('[SİSTEM] Dünyaya ayak basıldı, maskeleme aktif.');
    setTimeout(() => {
      if (bot) {
        state.status = "Doğdu / Çalışıyor";
        state.isQueueing = false; 
        logChat('[SİSTEM] Güvenlik duvarı indirildi, bot serbest.');
      }
    }, 4000);
  });

  bot.on('respawn', () => {
    logChat('[SİSTEM] Boyut geçişi! Güvenlik duvarı aktif.');
    lockBotForTransfer(8000);
  });

  bot.on('forcedMove', () => {
    try { bot.clearControlStates(); } catch(e){}
    try { bot.pathfinder.setGoal(null); } catch(e){}
    
    if (bot) {
        bot.physicsEnabled = false;
        logChat('[SİSTEM] Işınlanma algılandı, fizik 2s askıda.');

        setTimeout(() => {
            if (bot) {
                bot.physicsEnabled = true;
                logChat('[SİSTEM] Fizik geri açıldı.');
            }
        }, 2000);
    }
  });

  bot.on('messagestr', (msg) => {
    logChat(msg);
    checkAutoLogin(msg);
    
    const lower = msg.toLowerCase();
    
    if (lower.includes('sırasına girdiniz') || 
        lower.includes('aktarım yapıyorsunuz') || 
        lower.includes('lobi sunucusuna') || 
        lower.includes('yeniden başlatılıyor')) {
        
        logChat('[SİSTEM] Acil durum veya sahte bakım tespit edildi, ağ kilitleniyor!');
        lockBotForTransfer(25000); 
    } else if (lower.includes('başarıyla giriş') || lower.includes('login succes')) {
        logChat('[SİSTEM] Şifre onaylandı, ağ katmanı kilitleniyor...');
        lockBotForTransfer(10000);
    }
  });

  bot.on('chat', async (username, message) => {
    if (!username || username === bot.username || state.isQueueing) return;
    const botState = { health: bot.health, position: bot.entity ? bot.entity.position : null, inventory: 'Dolu' };
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

  bot.on('end', () => {
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
