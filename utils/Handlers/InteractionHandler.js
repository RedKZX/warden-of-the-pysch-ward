const fs = require('fs');
const path = require('path');
const db = require('../../dashboard/server/database/DB');
const { MessageFlags } = require('discord.js');

function createHandler(client) {
    const cooldowns = new Map();
    const rateLimits = new Map();
    const globalCooldowns = new Map();
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf8'));
    const getSettingsStmt = db.prepare('SELECT * FROM settings ORDER BY id DESC LIMIT 1');
    const getBlacklistStmt = db.prepare('SELECT user_id FROM blacklist WHERE user_id = ?');
    const getWhitelistStmt = db.prepare('SELECT user_id FROM whitelist WHERE user_id = ?');

    function parseCustomId(customId) {
        const [baseId, ...args] = customId.split('_');
        return { baseId, args };
    }

    const isOwner = (userId) => {
        const settings = getSettingsStmt.get();
        const ownerIds = JSON.parse(settings?.owner_ids || '[]');
        return ownerIds.includes(userId);
    };

    function checkRateLimit(userId) {
        if (isOwner(userId)) return { valid: true };
        const whitelisted = getWhitelistStmt.get(userId);
        if (whitelisted) return { valid: true };
        const settings = getSettingsStmt.get();
        const limit = settings?.command_rate_limit || 1;
        const windowMs = (settings?.command_rate_window || 60) * 1000;
        const now = Date.now();
        const userTimestamps = rateLimits.get(userId) || [];
        const recentCommands = userTimestamps.filter(time => now - time < windowMs);
        if (recentCommands.length >= limit) {
            const oldestCommand = Math.min(...recentCommands);
            const resetTime = Math.ceil((oldestCommand + windowMs - now) / 1000);
            return { valid: false, message: `Rate limit reached. Please wait ${resetTime} seconds before using another command.` };
        }
        recentCommands.push(now);
        rateLimits.set(userId, recentCommands);
        return { valid: true };
    }

    function cleanupRateLimits() {
        const now = Date.now();
        for (const [userId, timestamps] of rateLimits.entries()) {
            const validTimestamps = timestamps.filter(time => now - time < 60000);
            if (validTimestamps.length === 0) {
                rateLimits.delete(userId);
            } else {
                rateLimits.set(userId, validTimestamps);
            }
        }
    }

    setInterval(cleanupRateLimits, 60000);

    async function handleError(context, error) {
        const errorId = Math.random().toString(36).substring(2, 15);
        const errorDetails = {
            id: errorId,
            command: context.commandName || (context.content?.split(' ')[0] || 'Unknown Command'),
            user: {
                id: context.user?.id || context.author?.id,
                tag: context.user?.tag || context.author?.tag
            },
            guild: context.guild ? {
                id: context.guild.id,
                name: context.guild.name
            } : null,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            timestamp: new Date().toISOString()
        };

        client.logs.error(`Command Error ${errorId}:`, error);
        client.logs.error('Error Details:', JSON.stringify(errorDetails, null, 2));

        if (error.name !== 'UserInputError') {
            const settings = getSettingsStmt.get();
            const devIds = JSON.parse(settings?.dev_ids || '[]');
            const ownerIds = JSON.parse(settings?.owner_ids || '[]');

            const notificationEmbed = {
                color: 0xFF0000,
                title: '⚠️ Critical Error Detected',
                description: 'A critical error occurred while executing a command.',
                fields: [
                    { name: 'Error ID', value: errorId },
                    { name: 'Command', value: errorDetails.command },
                    { name: 'User', value: `${errorDetails.user.tag} (${errorDetails.user.id})` },
                    { name: 'Error', value: `\`\`\`\n${error.message}\n\`\`\`` }
                ],
                timestamp: new Date()
            };

            [...new Set([...devIds, ...ownerIds])].forEach(async (id) => {
                const user = await client.users.fetch(id).catch(() => null);
                if (user) {
                    user.send({ embeds: [notificationEmbed] }).catch(() => { });
                }
            });
        }
    }

    async function shouldLogCommands() {
        try {
            const settings = getSettingsStmt.get();
            return settings ? Boolean(settings.command_logs_enabled) : true;
        } catch (error) {
            console.error("Error checking command logs setting:", error);
            return false;
        }
    }

    function cleanupOldRateLimits() {
        const now = Date.now();
        for (const [userId, timestamps] of rateLimits.entries()) {
            const filtered = timestamps.filter(time => now - time < 60000);
            if (filtered.length === 0) {
                rateLimits.delete(userId);
            } else {
                rateLimits.set(userId, filtered);
            }
        }
    }

    const validationChecks = {
        maintenance: async (context) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return true;
            const settings = getSettingsStmt.get();
            return !settings?.maintenance_mode_enabled;
        },
        blacklist: (context) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return true;
            const blacklisted = getBlacklistStmt.get(userId);
            return !blacklisted;
        },
        guildOnly: (context, command) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return true;
            return !command.guildOnly || context.guild;
        },
        devGuild: (context, command) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return true;
            return !command.devGuild || context.guild?.id === config.devGuild;
        },
        developer: (context, command) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return true;
            if (!command.devOnly) return true;
            const settings = getSettingsStmt.get();
            const ownerIds = JSON.parse(settings?.owner_ids || '[]');
            const devIds = JSON.parse(settings?.dev_ids || '[]');
            return ownerIds.includes(userId) || devIds.includes(userId);
        },
        permissions: (context, command) => {
            if (!command.perms?.length) return true;
            const member = context.member;
            if (!member) return false;
            return command.perms.every(perm => member.permissions.has(perm));
        },
        cooldown: (context, command) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId) || !command.cooldown) return { valid: true };
            const commandName = context.commandName || command.command;
            const subCommand = context.options?.getSubcommand(false);
            const cooldownKey = subCommand ? `${commandName}-${subCommand}` : commandName;

            const timestamps = cooldowns.get(cooldownKey) || new Map();
            cooldowns.set(cooldownKey, timestamps);

            const now = Date.now();
            const cooldownAmount = command.cooldown * 1000;
            const userExpiration = timestamps.get(userId);

            if (userExpiration && now < userExpiration) {
                const timeLeft = (userExpiration - now) / 1000;
                return {
                    valid: false,
                    message: `Please wait ${timeLeft.toFixed(1)} more second(s) before reusing the \`${cooldownKey}\` command.`
                };
            }

            timestamps.set(userId, now + cooldownAmount);
            setTimeout(() => timestamps.delete(userId), cooldownAmount);
            return { valid: true };
        },
        rateLimit: (context) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return { valid: true };

            const settings = getSettingsStmt.get();
            const rateLimit = settings?.command_rate_limit || 60;

            const now = Date.now();
            const userTimestamps = rateLimits.get(userId) || [];
            const recentTimestamps = userTimestamps.filter(time => now - time < 60000);

            if (recentTimestamps.length >= rateLimit) {
                const oldestCommand = Math.min(...recentTimestamps);
                const resetTime = Math.ceil((60000 - (now - oldestCommand)) / 1000);
                return {
                    valid: false,
                    message: `You are being rate limited. Please wait ${resetTime} seconds.`
                };
            }

            recentTimestamps.push(now);
            rateLimits.set(userId, recentTimestamps);

            if (now % 300000 < 1000) {
                cleanupOldRateLimits();
            }

            return { valid: true };
        },
        globalCooldown: (context) => {
            const userId = context.user?.id || context.author?.id;
            if (isOwner(userId)) return { valid: true };
            const cooldownSeconds = 1;
            const now = Date.now();
            const lastUsed = globalCooldowns.get(userId);
            if (lastUsed && now - lastUsed < cooldownSeconds * 1000) {
                const timeLeft = ((lastUsed + cooldownSeconds * 1000) - now) / 1000;
                return { valid: false, message: `Global cooldown: Please wait ${timeLeft.toFixed(1)} seconds between commands.` };
            }
            globalCooldowns.set(userId, now);
            return { valid: true };
        }
    };

    const validationMessages = {
        maintenance: 'Bot is currently in maintenance mode. Only owners and developers can use commands.',
        blacklist: 'You are blacklisted from using this bot.',
        whitelist: 'This command requires whitelist access.',
        guildOnly: 'This command can only be used in a server.',
        devGuild: 'This command can only be used in the development guild.',
        developer: 'This command is only available to developers.',
        permissions: (context, command) => {
            const userId = context.user?.id || context.author?.id;
            if (lists.whitelist.includes(userId)) return true;
            if (!command.perms?.length) return true;
            const member = context.member;
            if (!member) return false;

            const permissionMapping = {
                'CREATE_INSTANT_INVITE': 'CreateInstantInvite',
                'KICK_MEMBERS': 'KickMembers',
                'BAN_MEMBERS': 'BanMembers',
                'ADMINISTRATOR': 'Administrator',
                'MANAGE_CHANNELS': 'ManageChannels',
                'MANAGE_GUILD': 'ManageGuild',
                'ADD_REACTIONS': 'AddReactions',
                'VIEW_AUDIT_LOG': 'ViewAuditLog',
                'PRIORITY_SPEAKER': 'PrioritySpeaker',
                'STREAM': 'Stream',
                'VIEW_CHANNEL': 'ViewChannel',
                'SEND_MESSAGES': 'SendMessages',
                'SEND_TTS_MESSAGES': 'SendTTSMessages',
                'MANAGE_MESSAGES': 'ManageMessages',
                'EMBED_LINKS': 'EmbedLinks',
                'ATTACH_FILES': 'AttachFiles',
                'READ_MESSAGE_HISTORY': 'ReadMessageHistory',
                'MENTION_EVERYONE': 'MentionEveryone',
                'USE_EXTERNAL_EMOJIS': 'UseExternalEmojis',
                'VIEW_GUILD_INSIGHTS': 'ViewGuildInsights',
                'CONNECT': 'Connect',
                'SPEAK': 'Speak',
                'MUTE_MEMBERS': 'MuteMembers',
                'DEAFEN_MEMBERS': 'DeafenMembers',
                'MOVE_MEMBERS': 'MoveMembers',
                'USE_VAD': 'UseVAD',
                'CHANGE_NICKNAME': 'ChangeNickname',
                'MANAGE_NICKNAMES': 'ManageNicknames',
                'MANAGE_ROLES': 'ManageRoles',
                'MANAGE_WEBHOOKS': 'ManageWebhooks',
                'MANAGE_EMOJIS_AND_STICKERS': 'ManageGuildExpressions',
                'USE_APPLICATION_COMMANDS': 'UseApplicationCommands',
                'REQUEST_TO_SPEAK': 'RequestToSpeak',
                'MANAGE_EVENTS': 'ManageEvents',
                'MANAGE_THREADS': 'ManageThreads',
                'CREATE_PUBLIC_THREADS': 'CreatePublicThreads',
                'CREATE_PRIVATE_THREADS': 'CreatePrivateThreads',
                'USE_EXTERNAL_STICKERS': 'UseExternalStickers',
                'SEND_MESSAGES_IN_THREADS': 'SendMessagesInThreads',
                'USE_EMBEDDED_ACTIVITIES': 'UseEmbeddedActivities',
                'MODERATE_MEMBERS': 'ModerateMembers'
            };

            const missingPerms = command.perms.filter(perm => {
                const v14Permission = permissionMapping[perm] ||
                    perm.split('_').map(word =>
                        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    ).join('');
                return !context.member.permissions.has(v14Permission);
            });


            return missingPerms.length ?
                `You lack the following permissions: ${missingPerms.join(', ')}` :
                null;
        },
        rateLimit: 'You have exceeded the command rate limit. Please try again later.',
        globalCooldown: 'Please wait before using another command.'
    };

    function processReplyOptions(options) {
        if (!options || typeof options !== 'object') return options;
        
        const processedOptions = { ...options };
        if (processedOptions.hidden === true) {
            delete processedOptions.hidden;
            processedOptions.flags = processedOptions.flags || MessageFlags.Ephemeral;
        }
        return processedOptions;
    }

    async function validateAndExecute(context, command, args = []) {
        const user = context.user || context.author;
        const commandName = context.commandName || command.command;
        const guildInfo = context.guild ? ` in ${context.guild.name} (${context.guild.id})` : ' in DMs';
        const commandType = context.commandName ? 'Slash' : 'Prefix';

        if (await shouldLogCommands()) {
            client.logs.command(
                `[${commandType}] Command "${commandName}" executed by ${user.tag} (${user.id})${guildInfo}` +
                (args.length ? ` with args: [${args.join(', ')}]` : '')
            );
        }

        const rateLimitCheck = checkRateLimit(user.id);

        if (!rateLimitCheck.valid) {
            if (!context.replied && !context.deferred) {
                const reply = { content: rateLimitCheck.message, ephemeral: true };
                if (context.reply) await context.reply(reply);
                else await context.channel.send(rateLimitCheck.message);
            }
            return;
        }

        for (const [check, validator] of Object.entries(validationChecks)) {
            const result = await validator(context, command);
            const isValid = result.valid !== undefined ? result.valid : result;

            if (!isValid) {
                const message = result.message || validationMessages[check];
                client.logs.warn(`User ${user.tag} was blocked from using ${commandName} by ${check} check`);

                if (message && !context.replied && !context.deferred) {
                    if (context.reply) {
                        await context.reply({ content: message, ephemeral: true });
                    } else {
                        await context.channel.send(message);
                    }
                }
                return;
            }
        }

        try {
            const originalReply = context.reply;
            context.reply = async function(options) {
                return await originalReply.call(this, processReplyOptions(options));
            };

            if (context.isCommand?.()) {
                await command.execute(context, client);
            } else {
                await command.execute(context, args, client);
            }
        } catch (error) {
            const errorEmbed = {
                color: 0xFF0000,
                title: '❌ Error',
                description: 'An error occurred while executing this command.',
                fields: [
                    {
                        name: 'Details',
                        value: error.message || 'No details available'
                    }
                ],
                timestamp: new Date(),
                footer: {
                    text: 'If this persists, please contact the developers'
                }
            };

            if (context.reply) {
                await context.reply(processReplyOptions({ embeds: [errorEmbed], ephemeral: true })).catch(() => { });
            } else if (context.channel) {
                await context.channel.send({ embeds: [errorEmbed] }).catch(() => { });
            }
            await handleError(context, error);
        }
    }

    async function handleInteraction(interaction) {
        const maintenanceCheck = await validationChecks.maintenance(interaction);
        if (!maintenanceCheck) {
            return interaction.reply({
                content: validationMessages.maintenance,
                ephemeral: true
            });
        }

        if (!validationChecks.blacklist(interaction)) {
            return interaction.reply({
                content: validationMessages.blacklist,
                ephemeral: true
            });
        }

        try {
            switch (true) {
                case interaction.isCommand():
                    const command = client.commands.get(interaction.commandName);
                    if (!command) return;
                    await validateAndExecute(interaction, command);
                    break;

                case interaction.isButton():
                case interaction.isAnySelectMenu():
                case interaction.isModalSubmit(): {
                    const { baseId, args } = parseCustomId(interaction.customId);
                    console.log(baseId, args);
                    const component = client.components.get(baseId);

                    if (!component) {
                        client.logs.error(`Component not found: ${baseId} (${interaction.customId})`);
                        return;
                    }

                    client.logs.debug(`Component interaction: ${baseId} with args: ${args.join(', ')}`);

                    if (component.interactionUserOnly && args[0] && args[0] !== interaction.user.id) {
                        return interaction.reply({
                            content: 'Only the original command user can use this interaction!',
                            ephemeral: true
                        });
                    }

                    try {
                        await component.execute(interaction, args, client);
                    } catch (error) {
                        client.logs.error(`Component execution error: ${error.message}`);
                        throw error;
                    }
                    break;
                }
            }
        } catch (error) {
            await handleError(interaction, error);
        }
    }

    async function handleMessage(message) {
        if (!message.content.startsWith(client.config.prefix) || message.author.bot) return;

        const maintenanceCheck = await validationChecks.maintenance(message);
        if (!maintenanceCheck) {
            await message.channel.send(validationMessages.maintenance);
            return;
        }

        if (!validationChecks.blacklist(message)) return;

        const args = message.content.slice(client.config.prefix.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = client.prefixCommands.get(commandName);

        if (command) {
            await validateAndExecute(message, command, args);
        }
    }

    client.handleInteraction = handleInteraction;
    client.handleMessage = handleMessage;

    return { handleInteraction, handleMessage };
}

module.exports = (client) => {
    const handler = createHandler(client);
    
    client.on('interactionCreate', handler.handleInteraction);
    client.on('messageCreate', handler.handleMessage);
    return handler;
};
