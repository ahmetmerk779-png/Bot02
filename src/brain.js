const { Groq } = require('groq-sdk');
const { scanEnvironment } = require('./vision');

async function decideAction(bot, userMessage, senderName, groqApiKey) {
    if (!groqApiKey) {
        console.log("[BEYİN] Hata: Groq API Key eksik!");
        return [];
    }

    const groq = new Groq({ apiKey: groqApiKey });
    
    // 1. Botun gözlerini kullanıp etrafın fotoğrafını (metin olarak) çekiyoruz
    const visionReport = scanEnvironment(bot);

    // 2. Token dostu, ultra kısa ve net Sistem Promptu
    const systemPrompt = `Sen gelişmiş, otonom bir Minecraft botusun. Adın: ${bot.username}.
Görevin hayatta kalmak ve mantıklı kararlar vermek. 
ASLA normal bir asistan gibi uzun metinler yazma. Sadece JSON formatında aksiyon listesi dön.

Şu anki Çevren:
${visionReport}

Fiziksel Yeteneklerin:
- "chat": {"message": "söylemek istediğin mesaj"}
- "follow": {"target": "oyuncu_adi"}
- "attack": {"target": "oyuncu_adi"}
- "stop": {}

Cevabını SADECE geçerli bir JSON dizisi (Array) olarak dön. Başka hiçbir açıklama veya yorum yazma.
Örnek Format:
[
  {"action": "chat", "params": {"message": "Tamamdır, peşindeyim!"}},
  {"action": "follow", "params": {"target": "${senderName}"}}
]`;

    try {
        console.log(`[BEYİN] Düşünüyor... (Gelen Mesaj: ${userMessage})`);
        
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `${senderName}: ${userMessage}` }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.2, // Robotik ve kesin kararlar için ısıyı çok düşürdük
            max_tokens: 250,
        });

        const reply = response.choices[0]?.message?.content || "[]";
        
        // LLM bazen inat edip markdown (```json ... ```) dönebiliyor, onu temizleyip saf JSON'u alıyoruz
        const jsonMatch = reply.match(/\[.*\]/s);
        const jsonStr = jsonMatch ? jsonMatch[0] : reply;

        const actions = JSON.parse(jsonStr);
        console.log("[BEYİN] Karar Verildi:", JSON.stringify(actions));
        return actions;

    } catch (error) {
        console.error("[BEYİN] Düşünme hatası (Token bitmiş olabilir):", error.message);
        return [];
    }
}

module.exports = { decideAction };
