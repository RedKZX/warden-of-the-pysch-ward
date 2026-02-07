const fs = require('node:fs');
const path = require('node:path');

function generateTemplate(type, fileName, subFolder = '') {
    const name = path.basename(fileName, '.js').toLowerCase();
    
    const templates = {
        commands: `const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('${name}')
        .setDescription('${name} command description'),
        
    async execute(interaction, client) {
        await interaction.reply('${name} command works!');
    }
};`,
        buttons: `module.exports = {
    customId: '${name}',
    
    async execute(interaction, args, client) {
        await interaction.reply(\`${name} button clicked!\`);
    }
};`,
        menus: `module.exports = {
    customId: '${name}',
    
    async execute(interaction, args, client) {
        const selected = interaction.values[0];
        await interaction.reply(\`${name} menu: Selected \${selected}\`);
    }
};`,
        modals: `const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    customId: '${name}',
    
    async execute(interaction, args, client) {
        const modal = new ModalBuilder()
            .setCustomId('${name}_modal')
            .setTitle('${name} Modal');

        const input = new TextInputBuilder()
            .setCustomId('${name}_input')
            .setLabel('Enter some text')
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }
};`,
        prefix: `module.exports = {
    command: '${name}',
    aliases: [],
    
    async execute(message, args, client) {
        await message.reply(\`${name} prefix command works!\`);
    }
};`,
        events: `module.exports = {
    name: '${name}',
    once: false,
    
    async execute(client, ...args) {
        client.logs.event(\`${name} event fired\`);
    }
};`
    };

    return templates[type] || templates.commands;
}

function ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        return true;
    }
    return false;
}

function setupTemplateGenerator(client) {
    const basePath = path.join(__dirname, '..', '..');
    const paths = {
        commands: path.join(basePath, 'commands'),
        buttons: path.join(basePath, 'components', 'buttons'),
        menus: path.join(basePath, 'components', 'menus'),
        modals: path.join(basePath, 'components', 'modals'),
        prefix: path.join(basePath, 'prefix'),
        events: path.join(basePath, 'events')
    };

    Object.entries(paths).forEach(([type, dir]) => {
        ensureDirectoryExists(dir);
        
        const watcher = fs.watch(dir, { recursive: true }, async (eventType, fileName) => {
            if (!fileName?.endsWith('.js')) return;

            const fullPath = path.join(dir, fileName);
            if (!fs.existsSync(fullPath)) return;

            try {
                const stats = fs.statSync(fullPath);
                if (stats.size === 0) {
                    const subFolder = path.dirname(fileName) !== '.' ? path.dirname(fileName) : '';
                    const content = generateTemplate(type, fileName, subFolder);
                    
                    if (subFolder) {
                        ensureDirectoryExists(path.join(dir, subFolder));
                    }

                    fs.writeFileSync(fullPath, content);
                    client.logs.info(`Generated ${type} template: ${fileName}`);
                }
            } catch (error) {
                client.logs.error(`Template generation failed for ${fileName}: ${error.message}`);
            }
        });

        watcher.on('error', error => {
            client.logs.error(`Watch error in ${type} directory: ${error.message}`);
        });
    });

    client.createTemplate = (type, name, subFolder = '') => {
        const dir = paths[type];
        if (!dir) throw new Error(`Invalid template type: ${type}`);

        const fullDir = subFolder ? path.join(dir, subFolder) : dir;
        ensureDirectoryExists(fullDir);

        const fileName = `${name}.js`;
        const filePath = path.join(fullDir, fileName);

        if (fs.existsSync(filePath)) {
            throw new Error(`File already exists: ${fileName}`);
        }

        const content = generateTemplate(type, fileName, subFolder);
        fs.writeFileSync(filePath, content);
        client.logs.info(`Created ${type} template: ${subFolder ? `${subFolder}/` : ''}${fileName}`);
        return filePath;
    };
}

module.exports = setupTemplateGenerator;
