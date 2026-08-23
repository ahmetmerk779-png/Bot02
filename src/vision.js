function scanEnvironment(bot) {
    if (!bot || !bot.entity) return "[SİSTEM] Görüş karanlık, bot henüz doğmadı.";
    
    const pos = bot.entity.position;
    
    // Etraftaki oyuncuları ve yaratıkları tarıyoruz (Maksimum 20 blok)
    const entities = Object.values(bot.entities)
        .filter(e => e !== bot.entity)
        .map(e => ({
            name: e.username || e.name || 'Bilinmeyen Varlık',
            type: e.type,
            dist: Math.round(pos.distanceTo(e.position)),
            // Yapay zekanın koordinatları net anlaması için X, Y, Z
            posStr: `[X:${Math.round(e.position.x)}, Y:${Math.round(e.position.y)}, Z:${Math.round(e.position.z)}]`
        }))
        .filter(e => e.dist <= 20) 
        .sort((a, b) => a.dist - b.dist); // En yakından en uzağa sırala

    // Yapay Zekaya (LLM) gönderilecek çevre raporunu oluşturuyoruz
    let report = `--- ÇEVRE RADARI ---\n`;
    report += `Senin Konumun: [X:${Math.round(pos.x)}, Y:${Math.round(pos.y)}, Z:${Math.round(pos.z)}]\n`;
    
    if (entities.length > 0) {
        report += `Yakındaki Varlıklar:\n`;
        entities.forEach(e => {
            report += `- ${e.name} (${e.type}) | Mesafe: ${e.dist}m | Konum: ${e.posStr}\n`;
        });
    } else {
        report += `Etrafta hiç kimse veya hiçbir yaratık yok. Tamamen yalnızsın.\n`;
    }
    
    report += `--------------------\n`;
    
    return report;
}

module.exports = { scanEnvironment };
