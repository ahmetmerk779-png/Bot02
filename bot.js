const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const { SocksProxyAgent } = require('socks-proxy-agent');

// Modüler mimari bileşenleri
const { parseWhisper, canProcessMessage, handleAutoLogin } = require('./src/guards');
const { decideAction } = require('./src/brain');
const { processActions } = require('./src/skills');

const botOptions = {
    host: process.env.MC_HOST || 'play.aesirmc.com',
    port: parseInt(process.env.MC_PORT) || 25565,
    username: process.env.MC_USERNAME || 'OtonomBot',
    version: '1.21.11',
    
    // Velocity / Anti-Bot Koruma Aşma Ayarları
    fakeHost: process.env.MC_HOST || 'play.aesirmc.com', // Sunucu proxy'sini gerçek oyuncu gibi kandırır
    checkTimeoutInterval: 60 * 1000                      // Bağlantı kopmalarını ve zamanaşımı banlarını önler
};

// SOCKS5 Proxy Desteği
if (process.env.PROXY_HOST && process.env.PROXY_PORT) {
    const auth = process.env.PROXY_USER ? `${process.env.PROXY_USER}:${process.env.PROXY_PASS}@` : '';
    const proxyUrl = `socks5://${auth}${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`;
    botOptions.agent = new SocksProxyAgent(proxyUrl);
    console.log(`[KORUMA] SOCKS5 Proxy bağlandı: ${process.env.PROXY_HOST}:${process.env.PROXY_PORT}`);
}

console.log("[SİSTEM] Otonom Ajan Başlatılıyor... (Sürüm: 1.21.11)");
const bot = mineflayer.createBot(botOptions);

bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);

handleAutoLogin(bot, process.env.MC_PASSWORD || 'sifre123');

bot.once('spawn', () => {
    console.log(`[SİSTEM] ${bot.username} korumayı aştı ve sunucuya başarıyla katıldı!`);
});

bot.on('messagestr', async (message) => {
    const whisper = parseWhisper(message);
    if (!whisper) return;

    console.log(`[FISILTI] ${whisper.sender}: ${whisper.text}`);

    if (!canProcessMessage()) {
        console.log("[KORUMA] 3.5s bekleme süresi dolmadı, fısıltı pas geçildi.");
        return;
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.log("[HATA] GROQ_API_KEY bulunamadı!");
        return;
    }

    const actions = await decideAction(bot, whisper.text, whisper.sender, apiKey);
    await processActions(bot, actions);
});

bot.on('kicked', (reason) => console.log('[SİSTEM] Sunucudan atıldı:', reason));
bot.on('error', (err) => console.log('[SİSTEM] Bot Hatası:', err.message));
