const { SlashCommandBuilder } = require('discord.js');
const db = require('../../dashboard/server/database/DB')
const argon2 = require('argon2');

module.exports = {
    devGuild: false,
    data: new SlashCommandBuilder()
        .setName('shutdown')
        .setDescription('Shuts down the bot.')
        .addStringOption(option => option.setName('password').setDescription('The password to shut down the bot.').setRequired(true)),
    async execute(interaction, client) {
        try {
            const userID = interaction.user.id;
            const ownersData = db.prepare("SELECT owner_ids FROM settings").get();
            const passwordData = db.prepare("SELECT emergency_shutdown_code FROM settings LIMIT 1").get();

            if (!ownersData) {
                return await interaction.reply({ content: 'Bot settings not found in database.', hidden: true });
            }

            if (!passwordData || !passwordData.emergency_shutdown_code) {
                return await interaction.reply({ content: 'Emergency shutdown code not set.', hidden: true });
            }

            const ownerIds = JSON.parse(ownersData.owner_ids);
            if (!ownerIds.includes(userID)) {
                return await interaction.reply({ content: 'You are not the owner of this bot.', hidden: true });
            }

            const password = interaction.options.getString('password');
            
            if (!await argon2.verify(passwordData.emergency_shutdown_code, password)) {
                return await interaction.reply({ content: 'Invalid password.', hidden: true });
            }

            await interaction.reply({ content: 'Shutting down the bot...', hidden: true });
            await client.destroy();
            process.exit(0);
            
        } catch (error) {
            console.error('Error in shutdown command:', error);
            if (!interaction.replied) {
                await interaction.reply({ content: 'An error occurred while shutting down the bot.', ephemeral: true });
            }
        }
    }
};
