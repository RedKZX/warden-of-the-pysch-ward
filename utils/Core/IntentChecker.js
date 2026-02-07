const fs = require('node:fs');
const path = require('node:path');
const { GatewayIntentBits, Partials } = require('discord.js');
const logs = require('../Logging/Logger');

const eventToIntentMap = {
    messageCreate: ['GuildMessages', 'MessageContent'],
    messageUpdate: ['GuildMessages', 'MessageContent'],
    messageDelete: ['GuildMessages', 'MessageContent'],
    messageReactionAdd: ['GuildMessageReactions'],
    messageReactionRemove: ['GuildMessageReactions'],
    guildMemberAdd: ['GuildMembers'],
    guildMemberRemove: ['GuildMembers'],
    guildMemberUpdate: ['GuildMembers'],
    guildCreate: ['Guilds'],
    guildDelete: ['Guilds'],
    guildUpdate: ['Guilds'],
    channelCreate: ['Guilds'],
    channelDelete: ['Guilds'],
    channelUpdate: ['Guilds'],
    roleCreate: ['Guilds'],
    roleDelete: ['Guilds'],
    roleUpdate: ['Guilds'],
    interactionCreate: ['GuildMessages'],
    presenceUpdate: ['GuildPresences'],
    voiceStateUpdate: ['GuildVoiceStates'],
    typingStart: ['GuildMessageTyping'],
    userUpdate: ['GuildMembers'],
    inviteCreate: ['GuildInvites'],
    inviteDelete: ['GuildInvites'],
    threadCreate: ['Guilds'],
    threadDelete: ['Guilds'],
    threadUpdate: ['Guilds'],
    threadMembersUpdate: ['GuildMembers'],
    guildBanAdd: ['GuildModeration'],
    guildBanRemove: ['GuildModeration'],
    emojiCreate: ['GuildEmojisAndStickers'],
    emojiDelete: ['GuildEmojisAndStickers'],
    emojiUpdate: ['GuildEmojisAndStickers'],
    stickerCreate: ['GuildEmojisAndStickers'],
    stickerDelete: ['GuildEmojisAndStickers'],
    stickerUpdate: ['GuildEmojisAndStickers'],
    webhookUpdate: ['GuildWebhooks'],
    autoModerationActionExecution: ['AutoModerationExecution'],
    autoModerationRuleCreate: ['AutoModerationConfiguration'],
    autoModerationRuleDelete: ['AutoModerationConfiguration'],
    autoModerationRuleUpdate: ['AutoModerationConfiguration']
};

const eventToPartialMap = {
    messageReactionAdd: ['Message', 'Channel', 'Reaction'],
    messageReactionRemove: ['Message', 'Channel', 'Reaction'],
    messageDelete: ['Message', 'Channel'],
    messageUpdate: ['Message', 'Channel'],
    channelDelete: ['Channel'],
    channelUpdate: ['Channel'],
    threadDelete: ['Channel'],
    threadUpdate: ['Channel']
};

function scanEventFiles(projectRoot) {
    const eventsDir = path.join(projectRoot, 'events');
    const detectedEvents = new Set();
    const requiredIntents = new Set();
    const requiredPartials = new Set();

    if (!fs.existsSync(eventsDir)) {
        logs.warn('Events directory not found. Using default intents and partials.');
        return { requiredIntents, requiredPartials };
    }

    function scanDirectory(dir) {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(dirent => {
            const fullPath = path.join(dir, dirent.name);
            
            if (dirent.isDirectory()) {
                scanDirectory(fullPath);
            } else if (dirent.isFile() && (dirent.name.endsWith('.js') || dirent.name.endsWith('.ts'))) {
                try {
                    const fileContent = fs.readFileSync(fullPath, 'utf8');
                    
                    for (const eventName of Object.keys(eventToIntentMap)) {
                        const regex = new RegExp(`(['"\`])${eventName}\\1|client\\.on\\((['"\`])${eventName}\\2`);
                        if (regex.test(fileContent)) {
                            detectedEvents.add(eventName);
                            
                            (eventToIntentMap[eventName] || []).forEach(intent => 
                                requiredIntents.add(intent));
                            
                            (eventToPartialMap[eventName] || []).forEach(partial => 
                                requiredPartials.add(partial));
                        }
                    }
                } catch (error) {
                    logs.error(`Error scanning file ${fullPath}: ${error.message}`);
                }
            }
        });
    }
    
    scanDirectory(eventsDir);
    
    return { requiredIntents, requiredPartials };
}

module.exports = () => {
    const config = require('../../config.json');
    const projectRoot = path.resolve(__dirname, '..', '..');

    const defaultIntents = [
        'Guilds',
        'GuildMembers',
        'GuildMessages',
        'MessageContent'
    ];

    const defaultPartials = [
        'Channel',
        'Message'
    ];

    const { requiredIntents, requiredPartials } = scanEventFiles(projectRoot);
    
    const combinedIntents = new Set([...defaultIntents, ...requiredIntents]);
    const combinedPartials = new Set([...defaultPartials, ...requiredPartials]);

    const configIntents = config.intents || [...combinedIntents];
    const configPartials = config.partials || [...combinedPartials];

    const intentBits = configIntents.map(intent => {
        return GatewayIntentBits[intent] !== undefined
            ? GatewayIntentBits[intent]
            : intent;
    });

    const partialBits = configPartials.map(partial => {
        return Partials[partial] !== undefined
            ? Partials[partial]
            : partial;
    });

    const missingIntents = [...requiredIntents].filter(intent => !configIntents.includes(intent));
    if (missingIntents.length > 0) {
        logs.warn(`Detected intents that are not in config: ${missingIntents.join(', ')}`);
        logs.info('Consider adding these intents to your config.json file');
    }

    const missingPartials = [...requiredPartials].filter(partial => !configPartials.includes(partial));
    if (missingPartials.length > 0) {
        logs.warn(`Detected partials that are not in config: ${missingPartials.join(', ')}`);
        logs.info('Consider adding these partials to your config.json file');
    }

    return {
        intents: configIntents,
        partials: configPartials,
        intentBits: intentBits,
        partialBits: partialBits,
        detectedIntents: [...requiredIntents],
        detectedPartials: [...requiredPartials],
        missingIntents: missingIntents,
        missingPartials: missingPartials
    };
};
