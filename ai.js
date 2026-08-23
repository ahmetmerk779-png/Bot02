const Groq = require('groq-sdk');

const botTools = [
  { type: "function", function: { name: "follow_player", description: "Belirtilen oyuncuyu takip eder.", parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } } },
  { type: "function", function: { name: "attack_target", description: "PvP başlatır.", parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] } } },
  { type: "function", function: { name: "stop_all_actions", description: "Tüm eylemleri durdurur.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "mine_block", description: "Belirli bir bloğu kazar.", parameters: { type: "object", properties: { blockName: { type: "string" } }, required: ["blockName"] } } },
  { type: "function", function: { name: "say_chat", description: "Sohbete mesaj gönderir.", parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } } }
];

async function processAI(bot, botState, sender, message, groqKey, botActions) {
  if (!groqKey || !bot) return;

  try {
    const groq = new Groq({ apiKey: groqKey });
    const response = await groq.chat.completions.create({
      model: "llama3-8b-8192", // 404 hatasını çözen kararlı model
      messages: [
        { role: "system", content: `Minecraft otonom AI botusun. Durum: ${JSON.stringify(botState)}.` },
        { role: "user", content: `${sender}: "${message}"` }
      ],
      tools: botTools,
      tool_choice: "auto"
    });

    const choice = response.choices[0].message;

    if (choice.tool_calls && choice.tool_calls.length > 0) {
      for (const call of choice.tool_calls) {
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments || '{}');
        
        if (fnName === 'follow_player') botActions.follow(args.target || sender);
        else if (fnName === 'attack_target') botActions.attack(args.target || sender);
        else if (fnName === 'stop_all_actions') botActions.stop();
        else if (fnName === 'mine_block') botActions.mine(args.blockName);
        else if (fnName === 'say_chat' && args.message) bot.chat(args.message);
      }
    } else if (choice.content) {
      bot.chat(choice.content.trim());
    }
  } catch (err) { 
    console.error('[AI HATA]', err.message); 
  }
}

module.exports = { processAI };
