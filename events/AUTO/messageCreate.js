const db = require('../../dashboard/server/database/DB');
const { ChannelType } = require('discord.js');

module.exports = {
    event: "messageCreate",
    once: false,
    
    async execute(message, client) {
        if (message.author.bot) {
            return;
        }
        
        if (message.channel.type === ChannelType.DM) {
            try {
                const result = db.prepare("SELECT dm_response_text FROM settings LIMIT 1").get();
                
                if (result && result.dm_response_text) {
                    await message.reply(result.dm_response_text);
                }
            } catch (error) {
                console.error('Error handling DM response:', error);
            }
            return;
        }
    }
};
