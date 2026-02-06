const { Client } = require("discord.js");
const config = require("./config.json");
const argon2 = require('argon2');
const db = require('./dashboard/server/database/DB');
const logManager = require('./utils/Logging/LogManager');
const Banner = require('./utils/Logging/Banner');

let client, dashboardServer;

console.log('\n' + require('./utils/Logging/ColorManager').colors.purple + Banner.getStartupBanner() + require('./utils/Logging/ColorManager').colors.reset);

const setupClient = async () => {
    const intentData = require("./utils/Core/IntentChecker.js")();
    client = new Client({
        intents: intentData.intents,
        partials: intentData.partials,
        failIfNotExists: false,
        allowedMentions: { parse: ['users', 'roles'], repliedUser: true },
        rest: { retries: 3, timeout: 15000, sweepInterval: 300 }
    });


    const originalConsoleLog = console.log;
    console.log = function () { };

    Object.assign(client, {
        logs: logManager,
        config,
        commands: new Map(),
        components: new Map(),
        fetch: require('./utils/Helpers/FetchUtils.js')(client),
        roleUtils: require('./utils/Helpers/RoleUtils.js')(client),
        statusManager: new (require('./utils/Core/StatusManager.js'))(client)
    });

    console.log = originalConsoleLog;

    client.logs.bannerShown = true;

    client.logs.divider();
    client.logs.system(`Using intents: ${intentData.intents.join(', ')}`);
    client.logs.system(`Using partials: ${intentData.partials.join(', ')}`);
    client.logs.divider();

    await require('./utils/Handlers/EnvironmentCheck.js')(client);


    require('./utils/Cache/CacheSetup.js')(client);
    await require('./utils/Services/InitializeHandlers.js')(client);
};

const handleError = async (error, attempts) => {
    console.error(error.message.startsWith('Failed') ? error.message : `Client error: ${error.message}`);

    const dashboardServer = global.dashboardServer || client?.dashboardServer;

    if (dashboardServer) {
        client.logs.warn("Shutting down dashboard server due to error...");
        await dashboardServer.shutdown();
    }

    const settingsResult = db.prepare('SELECT auto_recovery_attempts FROM settings').get();
    const maxAttempts = settingsResult ? settingsResult.auto_recovery_attempts : 3;
    attempts < maxAttempts
        ? setTimeout(() => initializeClient(attempts + 1), 5000)
        : (console.error('Max reconnect attempts reached. Exiting...'), process.exit(1));
};

async function verify2FA() {
    const settings = db.prepare('SELECT * FROM settings ORDER BY id DESC LIMIT 1').get();
    if (!settings || !settings.two_factor_auth_enabled || !settings.two_factor_hash) {
        return true;
    }

    const prompt = require('./utils/Helpers/Prompt');
    while (true) {
        console.log('\n\x1b[1;30m╔════════════════════════════════╗');
        console.log('\x1b[1;30m║  \x1b[1;35mWARDEN BOT TWO FACTOR  \x1b[1;30m║');
        console.log('\x1b[1;30m╚════════════════════════════════╝\x1b[0m');

        const code = await prompt('\x1b[38;2;138;43;226mPlease enter your 2FA code: \x1b[1;37m');
        try {
            const isValid = await argon2.verify(settings.two_factor_hash, code);
            if (isValid) {
                console.log('\x1b[38;2;138;43;226m2FA verification successful! \x1b[1;37m');
                return true;
            } else {
                console.log('Invalid code, please try again.');
            }
        } catch (error) {
            console.error('2FA verification error:', error);
            return false;
        }
    }
}

async function initializeClient(attempts = 0) {
    try {
        const verified = await verify2FA();
        if (!verified) {
            console.error('2FA verification failed. Exiting...');
            process.exit(1);
        }

        attempts > 0 && console.log(`Reattempting login (${attempts})...`);
        client?.destroy();

        await setupClient();
        client.on('error', error => handleError(error, attempts));

        const loginToken = client.token || (Array.isArray(client.config.token) ? client.config.token[0] : client.config.token);

        if (!loginToken) {
            throw new Error('No valid token available for login');
        }

        await client.login(loginToken);

        client.botID = client.user.id;

        client.logs.success(`Logged in as ${client.user.tag} (ID: ${client.botID})`);
        await client.statusManager.loadStatus();

        await require('./utils/Loaders/CommandLoader.js')(client);


        client.logs.divider();
        client.logs.info(`Ready to serve ${client.guilds.cache.size} servers`);

        if (client.dashboardServer) {
            const dashboardPort = client.config.dashboardPort ||
                (client.config.dashboard && client.config.dashboard.port) ||
                3000;
            client.logs.info(`Dashboard: http://localhost:${dashboardPort}`);
        }

        client.logs.divider();
        require('./utils/Metrics/LineCount.js')
    } catch (error) {
        await handleError(error, attempts);
    }
}

(async () => {
    try {
        await initializeClient();
    } catch (error) {
        console.error(`Initialization failed: ${error.message}`);
        process.exit(1);
    }
})();
