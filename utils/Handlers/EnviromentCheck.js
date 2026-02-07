const fs = require('node:fs');
const path = require('node:path');
const https = require('https');
const Prompt = require('../Helpers/Prompt');

const colors = {
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    bright: '\x1b[1m'
};

module.exports = async function checkEnvironment(client) {
    const requiredFolders = ['commands', 'events', 'components', 'prefix'];
    const requiredFiles = ['../config.json'];
    const requiredConfigFields = ['token', 'prefix', 'dashboardPort'];

    for (const folder of requiredFolders) {
        const folderPath = path.join(__dirname, '..', '..', folder);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
            fs.writeFileSync(path.join(folderPath, '.gitkeep'), '');
        }
    }

    for (const file of requiredFiles) {
        const filePath = path.join(__dirname, '..', file);
        if (!fs.existsSync(filePath)) {
            client.logs.warn(`Missing required file: ${file}`);
        }
    }

    const configPath = path.join(__dirname, '..', '..', 'config.json');
    let config;
    try {
        config = require(configPath);
    } catch {
        client.logs.error('config.json file is missing or invalid. Please fix this before proceeding.');
        return;
    }

    const missingFields = requiredConfigFields.filter(field => !config[field]);

    for (const field of missingFields) {
        const formattedQuestion = `${colors.cyan}Enter ${colors.bright}${field}${colors.reset}${colors.cyan}: ${colors.reset}`;
        const answer = await Prompt(formattedQuestion);
        config[field] = field === 'dashboardPort' ? parseInt(answer, 10) : answer;
    }

    if (Array.isArray(config.token)) {
        const nonEmptyTokens = config.token.filter(token => token && token.trim() !== '');
        
        if (nonEmptyTokens.length === 0) {
            client.logs.error(`${colors.red}No valid tokens found in config.${colors.reset}`);
            const newToken = await Prompt(`${colors.yellow}Enter a valid bot token: ${colors.reset}`);
            config.token = [newToken];
            client.token = newToken;
        } else if (nonEmptyTokens.length === 1) {
            if (await validateToken(nonEmptyTokens[0])) {
                client.logs.info(`${colors.green}Using the only valid token in config.${colors.reset}`);
                client.token = nonEmptyTokens[0];
            } else {
                client.logs.error(`${colors.red}The token in config is invalid.${colors.reset}`);
                const newToken = await Prompt(`${colors.yellow}Enter a valid bot token: ${colors.reset}`);
                config.token[config.token.indexOf(nonEmptyTokens[0])] = newToken;
                client.token = newToken;
            }
        } else {
            const selectedToken = await handleMultipleTokens(nonEmptyTokens);
            if (selectedToken) {
                client.token = selectedToken;
            } else {
                client.logs.error(`${colors.red}No valid token selected. Exiting...${colors.reset}`);
                process.exit(1);
            }
        }
    } else {
        if (!config.token || config.token.trim() === '' || !(await validateToken(config.token))) {
            client.logs.error(`${colors.red}Invalid bot token. Please provide a valid token.${colors.reset}`);
            const newToken = await Prompt(`${colors.yellow}Enter a valid bot token: ${colors.reset}`);
            config.token = newToken;
            client.token = newToken;
        } else {
            client.token = config.token;
        }
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    client.logs.startup(`${colors.green}All required config fields are now provided. Continuing startup...${colors.reset}`);
}

async function validateToken(token) {
    if (!token || token === '') return false;
    
    return new Promise((resolve) => {
        const options = {
            hostname: 'discord.com',
            path: '/api/v10/users/@me',
            method: 'GET',
            headers: {
                'Authorization': `Bot ${token}`
            }
        };

        const req = https.request(options, (res) => {
            if (res.statusCode === 200) {
                resolve(true);
            } else {
                resolve(false);
            }
        });

        req.on('error', () => resolve(false));
        req.end();
    });
}

async function handleMultipleTokens(tokens) {
    console.log(`${colors.cyan}${colors.bright}Multiple bot tokens detected!${colors.reset}`);
    
    const validTokens = [];
    const botInfo = [];
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        try {
            const info = await getBotInfo(token);
            if (info) {
                validTokens.push(token);
                botInfo.push({ index: i, ...info });
            }
        } catch (error) {
        }
    }
    
    if (validTokens.length === 0) {
        console.log(`${colors.red}No valid tokens found.${colors.reset}`);
        return null;
    }
    
    if (validTokens.length === 1) {
        console.log(`${colors.green}Only one valid token found. Using bot: ${colors.bright}${botInfo[0].username}#${botInfo[0].discriminator}${colors.reset}`);
        return validTokens[0];
    }
    
    console.log(`${colors.yellow}Please select which bot to log in with:${colors.reset}\n`);
    
    botInfo.forEach((bot, index) => {
        console.log(`${colors.green}${index + 1}${colors.reset}. ${colors.bright}${bot.username}#${bot.discriminator}${colors.reset} (ID: ${bot.id})`);
    });
    
    const choice = await Prompt(`\n${colors.cyan}Enter your choice ${colors.bright}(1-${validTokens.length})${colors.reset}${colors.cyan}: ${colors.reset}`);
    const selection = parseInt(choice.trim()) - 1;
    
    if (isNaN(selection) || selection < 0 || selection >= validTokens.length) {
        console.log(`${colors.red}Invalid selection. Please try again.${colors.reset}`);
        return handleMultipleTokens(tokens);
    }
    
    const selectedToken = validTokens[selection];
    console.log(`${colors.green}Selected bot: ${colors.bright}${botInfo[selection].username}#${botInfo[selection].discriminator}${colors.reset}`);
    return selectedToken;
}

async function getBotInfo(token) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'discord.com',
            path: '/api/v10/users/@me',
            method: 'GET',
            headers: {
                'Authorization': `Bot ${token}`
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const botData = JSON.parse(data);
                        resolve({
                            id: botData.id,
                            username: botData.username,
                            discriminator: botData.discriminator || '0',
                            avatar: botData.avatar
                        });
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    reject(new Error(`Status code: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => reject(error));
        req.end();
    });
}
