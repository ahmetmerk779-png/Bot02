let lastActionTime = 0;
const SPAM_COOLDOWN_MS = 3500; // Sunucudan ban yememek için 3.5 saniyelik anti-spam duvarı

// AesirMC ve genel Paper sunucularındaki fısıltı / özel mesaj regex formatı
function parseWhisper(message) {
    const whisperRegex = /(?:\[)?([a-zA-Z0-9_]{3,16})(?:\s*->\s*siz|\s*size fısıldıyor|\s*whispers to you):?\s*(.+)/i;
    const match = message.match(whisperRegex);
    if (match) {
        return { sender: match[1], text: match[2].trim() };
    }
    return null;
}

// Komutların üst üste binmesini engelleyen anti-spam koruması
function canProcessMessage() {
    const now = Date.now();
    if (now - lastActionTime < SPAM_COOLDOWN_MS) {
        return false;
    }
    lastActionTime = now;
    return true;
}

// Otomatik giriş ve bot doğrulaması
function handleAutoLogin(bot, password) {
    bot.on('messagestr', (msg) => {
        if (msg.includes('/login') || msg.includes('Giris yapin') || msg.includes('giris yap')) {
            setTimeout(() => {
                bot.chat(`/login ${password}`);
                console.log("[KORUMA] Otomatik giriş komutu gönderildi.");
            }, 1500);
        }
    });
}

module.exports = { parseWhisper, canProcessMessage, handleAutoLogin };
