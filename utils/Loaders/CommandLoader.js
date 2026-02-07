const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const crc32 = require('../Helpers/CRC32');
const db = require('../../dashboard/server/database/DB');

function initializeDatabase() {
    return {
        getHashStmt: db.prepare('SELECT hash FROM command_hashes WHERE command_path = ?'),
        setHashStmt: db.prepare('INSERT OR REPLACE INTO command_hashes (command_path, hash) VALUES (?, ?)'),
        deleteHashStmt: db.prepare('DELETE FROM command_hashes WHERE command_path = ?'),
        getAliasesStmt: db.prepare('SELECT alias FROM command_aliases WHERE command_name = ?'),
        setAliasStmt: db.prepare('INSERT OR REPLACE INTO command_aliases (command_name, alias) VALUES (?, ?)'),
        deleteAliasStmt: db.prepare('DELETE FROM command_aliases WHERE command_name = ? AND alias = ?'),
        deleteAliasesByCommandStmt: db.prepare('DELETE FROM command_aliases WHERE command_name = ?'),
        getAllHashesStmt: db.prepare('SELECT command_path, hash FROM command_hashes'),
        getAllAliasesStmt: db.prepare('SELECT command_name, alias FROM command_aliases')
    };
}

function getFilesRecursively(dir) {
    const files = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...getFilesRecursively(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            files.push(fullPath);
        }
    }

    return files;
}

function handleRemovedCommands(client, existingFiles, storedHashes, previousAliases, globalCommands, guildCommands, dbStmts) {
    const hashesToRemove = Object.keys(storedHashes).filter(filePath => !existingFiles.has(filePath));
    
    for (const filePath of hashesToRemove) {
        const commandName = path.basename(filePath, '.js');
        dbStmts.deleteHashStmt.run(filePath);
        dbStmts.deleteAliasesByCommandStmt.run(commandName);
        client.commands.delete(commandName);
        globalCommands.delete(commandName);
        guildCommands.delete(commandName);
        client.logs.info(`Removed hash for deleted command: ${commandName}`);
    }
}

function handleAliases(client, command, commandData, loadedAliases, globalCommands, guildCommands, previousAliases, dbStmts) {
    const commandName = command.data.name;
    const currentAliases = command.alias || [];
    const oldAliases = previousAliases[commandName] || [];

    const removedAliases = oldAliases.filter(alias => !currentAliases.includes(alias));
    for (const alias of removedAliases) {
        client.commands.delete(alias);
        loadedAliases.delete(alias);
        globalCommands.delete(alias);
        guildCommands.delete(alias);
        dbStmts.deleteAliasStmt.run(commandName, alias);
        client.logs.info(`Removed old alias ${alias} from ${commandName}`);
    }

    previousAliases[commandName] = currentAliases;

    if (command.alias?.length) {
        for (const alias of [...client.commands.keys()]) {
            if (client.commands.get(alias).aliasOf === command.data.name) {
                client.commands.delete(alias);
                loadedAliases.delete(alias);
            }
        }
    }

    for (const alias of command.alias || []) {
        if (loadedAliases.has(alias) || !alias.trim()) continue;

        const aliasData = { ...commandData, name: alias, aliasOf: command.data.name };
        client.commands.set(alias, { ...command, aliasOf: command.data.name });
        loadedAliases.add(alias);
        dbStmts.setAliasStmt.run(commandName, alias);
        
        if (command.devGuild) {
            guildCommands.set(alias, aliasData);
        } else {
            globalCommands.set(alias, aliasData);
        }
        
        client.logs.info(`Loaded command ${alias} as alias for ${commandData.name}`);
    }
}

async function updateDiscordCommands(client, globalCommands, guildCommands) {
    if (!client.botID && client.user) {
        client.botID = client.user.id;
        client.logs.info(`Using bot ID from client.user: ${client.botID}`);
    }
    
    if (!client.botID) {
        client.logs.error('Cannot register commands: Missing bot ID');
        return;
    }
    
    const rest = new REST().setToken(client.token);
    try {
        if (client.config.devGuild) {
            const existingGuildCommands = await rest.get(Routes.applicationGuildCommands(client.botID, client.config.devGuild));
            const newGuildCommands = new Set([...guildCommands.values()].map(cmd => cmd.name));
            const deleteGuildPromises = existingGuildCommands.map(cmd =>
                newGuildCommands.has(cmd.name) ? null : rest.delete(`${Routes.applicationGuildCommands(client.botID, client.config.devGuild)}/${cmd.id}`)
            ).filter(p => p);
            await Promise.all(deleteGuildPromises);
            if (guildCommands.size > 0)
                await rest.put(Routes.applicationGuildCommands(client.botID, client.config.devGuild), { body: [...guildCommands.values()] });
        }
        const existingGlobalCommands = await rest.get(Routes.applicationCommands(client.botID));
        const newGlobalCommands = new Set([...globalCommands.values()].map(cmd => cmd.name));
        const deleteGlobalPromises = existingGlobalCommands.map(cmd =>
            newGlobalCommands.has(cmd.name) ? null : rest.delete(`${Routes.applicationCommands(client.botID)}/${cmd.id}`)
        ).filter(p => p);
        await Promise.all(deleteGlobalPromises);
        if (globalCommands.size > 0)
            await rest.put(Routes.applicationCommands(client.botID), { body: [...globalCommands.values()] });
    } catch (error) {
        if (error.status === 401) {
            client.logs.error(`Command registration failed: Authentication error - please verify your token has proper permissions`);
        } else if (error.message && error.message.includes('snowflake')) {
            client.logs.error(`Command registration failed: Invalid bot ID (${client.botID})`);
        } else {
            client.logs.error(`API Error: ${error.message || error}`);
        }
    }
}

function loadAliasesFromDatabase(dbStmts) {
    const previousAliases = {};
    const rows = dbStmts.getAllAliasesStmt.all();
    for (const row of rows) {
        if (!previousAliases[row.command_name]) {
            previousAliases[row.command_name] = [];
        }
        previousAliases[row.command_name].push(row.alias);
    }
    return previousAliases;
}

module.exports = async function RegisterCommands(client) {
    const dbStmts = initializeDatabase();
    const globalCommands = new Map();
    const guildCommands = new Map();
    const commandsPath = path.join(__dirname, '..', '../commands');
    const loadedCommands = new Set();
    const loadedAliases = new Set();

    const storedHashes = {};
    const hashRows = dbStmts.getAllHashesStmt.all();
    hashRows.forEach(row => {
        storedHashes[row.command_path] = row.hash;
    });
    
    const previousAliases = loadAliasesFromDatabase(dbStmts);

    const files = getFilesRecursively(commandsPath);
    const existingFiles = new Set(files);

    handleRemovedCommands(client, existingFiles, storedHashes, previousAliases, globalCommands, guildCommands, dbStmts);

    let changedCommands = 0;
    let unchangedCommands = 0;

    for (const filePath of files) {
        const content = fs.readFileSync(filePath, 'utf8');
        const currentHash = crc32(content);
        const commandName = path.basename(filePath, '.js');

        try {
            if (storedHashes[filePath] !== currentHash || !client.commands.has(commandName)) {
                if (require.cache[require.resolve(filePath)]) {
                    delete require.cache[require.resolve(filePath)];
                }
                
                const command = require(filePath);
                if (!command.data || !command.execute) {
                    throw new Error('Invalid command structure');
                }

                const commandData = command.data.toJSON();
                client.commands.set(command.data.name, command);
                loadedCommands.add(command.data.name);

                handleAliases(client, command, commandData, loadedAliases, globalCommands, guildCommands, previousAliases, dbStmts);

                changedCommands++;
                dbStmts.setHashStmt.run(filePath, currentHash);
                
                if (command.devGuild) {
                    guildCommands.set(commandData.name, commandData);
                } else {
                    globalCommands.set(commandData.name, commandData);
                }
            } else {
                unchangedCommands++;
                const existingCommand = client.commands.get(commandName);
                if (existingCommand) {
                    const commandMap = existingCommand.devGuild ? guildCommands : globalCommands;
                    commandMap.set(existingCommand.data.name, existingCommand.data.toJSON());
                }
            }
        } catch (error) {
            client.logs.error(`Failed to load command ${commandName}: ${error.message}`);
        }
    }

    await updateDiscordCommands(client, globalCommands, guildCommands);
    
    client.logs.command(`Commands: ${changedCommands} updated, ${unchangedCommands} unchanged`);
    return client.commands;
}
