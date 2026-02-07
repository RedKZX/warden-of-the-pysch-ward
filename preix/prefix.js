module.exports = {
    devGuild: false,
    cooldown: 15,
    devOnly: false,
    command: 'hello',
    description: 'Says hello!',
    async execute(message, args, client) {
        await message.reply('Hello!');
    }
};
