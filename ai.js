const Groq = require('groq-sdk');
const { goals, Movements } = require('mineflayer-pathfinder');

async function processAI(bot, botState, username, message, groqKey, botActions) {
  if (!groqKey) {
    bot.chat(`Selam ${username}, Groq API anahtarım yok!`);
    return;
  }

  try {
    const groq = new Groq({ apiKey: groqKey });

    const systemPrompt = `
Sen Minecraft'ta ${bot.username} adlı, ${username} ile birlikte oynayan tam otonom bir oyuncu botusun.
Seninle aynı sunucudayız. Sen bir yapay zeka asistani değil, gerçek bir oyuncu arkadaşsın.

Elindeki yetenekler (botActions ve bot objesi üzerinden):
- Takip etmek için: botActions.follow("${username}")
- Durdurmak için: botActions.stop()
- Saldırmak için: botActions.attack("hedef_oyuncu_adi")
- Zıplamak için: bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500);
- Eğilmek için: bot.setControlState('sneak', true/false);
- Sohbet etmek için: bot.chat("mesajin")

Kullanıcı sana ne söylerse söylesin, ona samimi bir Türkçe cevap ver ve onun isteğini yerine getirmek için ne yapman gerektiğini düşün.
Yanıtını kesinlikle şu JSON formatında ver, başka hiçbir şey yazma:
{
  "response": "Oyuncuya sohbette vereceğin samimi cevap",
  "intent": "Kullanıcının ne istediğinin kısa özeti",
  "actionType": "FOLLOW", "STOP", "JUMP", "SNEAK", "ATTACK" veya "CHAT",
  "target": "${username}"
}
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${username} sana şunu yazdı: "${message}"` }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.8,
      max_tokens: 250,
    });

    const rawContent = chatCompletion.choices[0]?.message?.content || "";
    
    let jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const parsed = JSON.parse(jsonMatch[0]);

    // 1. Önce sohbetteki cevabı yaz
    if (parsed.response) {
      bot.chat(parsed.response);
    }

    // 2. Ardından esnek bir şekilde eylemi gerçekleştir
    setTimeout(() => {
      switch (parsed.actionType) {
        case "FOLLOW":
          botActions.follow(parsed.target);
          break;
        case "STOP":
          botActions.stop();
          break;
        case "JUMP":
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 500);
          break;
        case "SNEAK":
          const current = bot.getControlState('sneak');
          bot.setControlState('sneak', !current);
          break;
        case "ATTACK":
          if (parsed.target) botActions.attack(parsed.target);
          break;
        default:
          // Sadece sohbet veya özel serbest eylem
          break;
      }
    }, 1000);

  } catch (error) {
    console.error("AI İşleme Hatası:", error);
  }
}

module.exports = { processAI };
