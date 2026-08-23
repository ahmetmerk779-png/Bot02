const Groq = require('groq-sdk');

async function processAI(bot, botState, username, message, groqKey, botActions, isWhisper = false) {
  if (!groqKey) {
    bot.chat(`Selam ${username}, API anahtarım olmadığı için beynim şu an çevrimdışı!`);
    return;
  }

  try {
    const groq = new Groq({ apiKey: groqKey });

    const systemPrompt = `
Sen Minecraft'ta ${bot.username} adlı, ${username} ile birlikte oynayan tam otonom bir oyuncu botusun.
${isWhisper ? "Bu mesaj sana ÖZEL MESAJ (whisper/msg) olarak gönderildi." : "Bu mesaj genel sohbette sana yazıldı."}

Senin arkanda çalışan güçlü eklentiler (Pathfinder ve PvP) var. Kullanıcının isteğini analiz et ve ne yapman gerektiğine karar ver.

Elindeki eylemler:
- "FOLLOW": Kullanıcı onu takip etmeni isterse. (Pathfinder devreye girer)
- "STOP": Kullanıcı durmanı, iptal etmeni isterse.
- "JUMP": Zıplamanı isterse.
- "SNEAK": Eğilmeni isterse.
- "ATTACK": Kullanıcı senden başka bir oyuncuya veya canavara saldırmanı, onu dövmeni, öldürmeni isterse. (Hedefin adını algıla)
- "NONE": Sadece sohbet ediyorsa.

Yanıtını kesinlikle şu JSON formatında ver, ekstra hiçbir şey yazma:
{
  "response": "Oyuncuya vereceğin samimi, insansı Türkçe cevap",
  "actionType": "FOLLOW", "STOP", "JUMP", "SNEAK", "ATTACK" veya "NONE",
  "target": "Eğer FOLLOW ise '${username}', eğer ATTACK ise saldırmanı istediği kişinin adı, yoksa boş bırak"
}
    `;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `${username} sana şunu yazdı: "${message}"` }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.7,
      max_tokens: 250,
    });

    const rawContent = chatCompletion.choices[0]?.message?.content || "";
    let jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    
    const parsed = JSON.parse(jsonMatch[0]);

    // 1. Sohbete Cevap Ver (Özel mesajsa özelden)
    if (parsed.response) {
      if (isWhisper) {
        bot.chat(`/msg ${username} ${parsed.response}`);
      } else {
        bot.chat(parsed.response);
      }
    }

    // 2. Mekanikleri ve Eklentileri Tetikle!
    setTimeout(() => {
      switch (parsed.actionType) {
        case "FOLLOW":
          botActions.follow(parsed.target || username);
          break;
        case "STOP":
          botActions.stop();
          break;
        case "JUMP":
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 500);
          break;
        case "SNEAK":
          bot.setControlState('sneak', !bot.getControlState('sneak'));
          break;
        case "ATTACK":
          if (parsed.target) {
            botActions.attack(parsed.target);
          }
          break;
      }
    }, 1000);

  } catch (error) {
    console.error("AI İşleme Hatası:", error);
  }
}

module.exports = { processAI };
