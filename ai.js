const Groq = require('groq-sdk');

async function processAI(bot, botState, username, message, groqKey, botActions, isWhisper = false) {
  if (!groqKey) {
    bot.chat(`Selam ${username}, Groq API anahtarım yok!`);
    return;
  }

  try {
    const groq = new Groq({ apiKey: groqKey });

    const systemPrompt = `
Sen Minecraft'ta ${bot.username} adlı, ${username} ile birlikte oynayan tam otonom bir oyuncu botusun.
${isWhisper ? "Bu mesaj sana ÖZEL MESAJ (whisper/msg) olarak gönderildi." : "Bu mesaj genel sohbette sana yazıldı."}

Elindeki yetenekler:
- Takip etmek için: botActions.follow("${username}")
- Durdurmak için: botActions.stop()
- Zıplamak için: bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 500);
- Eğilmek için: bot.setControlState('sneak', true/false);

Kullanıcının isteğini analiz et ve yanıtını kesinlikle şu JSON formatında ver, başka hiçbir şey yazma:
{
  "response": "Oyuncuya vereceğin samimi Türkçe cevap",
  "actionType": "FOLLOW", "STOP", "JUMP", "SNEAK" veya "NONE",
  "target": "${username}"
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

    // Yanıtı iletme (Eğer özel mesajsa özelden, değilse normal chatten cevap verebilir veya her ikisi de ayarlanabilir)
    if (parsed.response) {
      if (isWhisper) {
        bot.chat(`/msg ${username} ${parsed.response}`);
      } else {
        bot.chat(parsed.response);
      }
    }

    // Eylemi gerçekleştir
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
          bot.setControlState('sneak', !bot.getControlState('sneak'));
          break;
      }
    }, 1000);

  } catch (error) {
    console.error("AI İşleme Hatası:", error);
  }
}

module.exports = { processAI };
