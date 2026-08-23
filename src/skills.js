const { goals, Movements } = require('mineflayer-pathfinder');

// Herhangi bir yeni eyleme geçmeden önce botu sıfırlayan ana fren sistemi
function stopAction(bot) {
    try { bot.clearControlStates(); } catch (e) {}
    try { bot.pathfinder.stop(); bot.pathfinder.setGoal(null); } catch (e) {}
    try { bot.pvp.stop(); } catch (e) {}
}

// Gelen tekil komutu fiziksel motora bağlayan merkez
function executeAction(bot, actionObj) {
    if (!actionObj || !actionObj.action) return;
    
    const action = actionObj.action;
    const params = actionObj.params || {};

    switch (action) {
        case 'chat':
            if (params.message) {
                bot.chat(params.message);
                console.log(`[YETENEK] Söylendi: ${params.message}`);
            }
            break;
            
        case 'stop':
            stopAction(bot);
            console.log(`[YETENEK] Tüm eylemler durduruldu.`);
            break;
            
        case 'follow':
            stopAction(bot); // Peşine düşmeden önce eski işi bırak
            const followTarget = Object.values(bot.entities).find(e => 
                e.type === 'player' && 
                e.username && 
                e.username.toLowerCase().includes(params.target?.toLowerCase())
            );
            
            if (followTarget) {
                const mcData = require('minecraft-data')(bot.version);
                const move = new Movements(bot, mcData);
                bot.pathfinder.setMovements(move);
                bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 2), true);
                console.log(`[YETENEK] Takip kilitlendi: ${followTarget.username}`);
            } else {
                console.log(`[YETENEK] HATA: ${params.target} etrafta bulunamadı!`);
            }
            break;
            
        case 'attack':
            stopAction(bot);
            const attackTarget = Object.values(bot.entities).find(e => 
                e.type === 'player' && 
                e.username && 
                e.username.toLowerCase().includes(params.target?.toLowerCase())
            );
            
            if (attackTarget) {
                bot.pvp.attack(attackTarget);
                console.log(`[YETENEK] Saldırıya geçildi: ${attackTarget.username}!`);
            } else {
                console.log(`[YETENEK] HATA: Saldırılacak kişi (${params.target}) bulunamadı!`);
            }
            break;
            
        default:
            console.log(`[YETENEK] Bilinmeyen eylem reddedildi: ${action}`);
    }
}

// Beyinden gelen dizi (Array) komutlarını sırayla çalıştıran motor
async function processActions(bot, actions) {
    if (!Array.isArray(actions) || actions.length === 0) return;
    
    for (const actionObj of actions) {
        executeAction(bot, actionObj);
        // Eylemlerin üst üste binmemesi için araya çok kısa bir nefes payı (milisaniye) koyuyoruz
        await new Promise(resolve => setTimeout(resolve, 600));
    }
}

module.exports = { processActions, stopAction };
