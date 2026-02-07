let client;
let reconnectAttempts = 0;
let reconnectTimeout;
let isShuttingDown = false;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_INTERVAL = 5000;
const mongoose = require('mongoose');

const setupProcessHandlers = () => {
    process.on('uncaughtException', (err) => {
        console.error(`UNCAUGHT EXCEPTION: ${err.stack}`);
        attemptReconnect();
    });

    process.on('unhandledRejection', (err) => {
        console.error(`UNHANDLED REJECTION: ${err.stack}`);
        attemptReconnect();
    });

    process.on('warning', (warning) => {
        console.warn(`WARNING: ${warning.name} : ${warning.message}`);
    });

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
};

const resetReconnectAttempts = () => {
    reconnectAttempts = 0;
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
};

const attemptReconnect = () => {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`Attempting to reconnect... (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
        
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        
        reconnectTimeout = setTimeout(async () => {
            if (client) {
                try {
                    await client.destroy();
                    await client.login(client.config.token).catch((error) => {
                        if (error.code === "TokenInvalid") {
                            client.logs.system('Invalid token detected.')
                        }
                    })
                    resetReconnectAttempts();
                } catch (error) {
                    client.logs.system('Reconnection failed:', error);
                    attemptReconnect();
                }
            }
        }, RECONNECT_INTERVAL * reconnectAttempts);
    } else {
        console.error('Max reconnection attempts reached. Shutting down.');
        gracefulShutdown();
    }
};

const gracefulShutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    client?.logs?.system('Gracefully shutting down...');
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
    }

    if (client) {
        try {
            process.removeAllListeners('SIGINT');
            process.removeAllListeners('SIGTERM');
            
            if (client.db) {
                await client.db.close();
            }
            
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
            }
            
            await client.destroy();
        } catch (error) {
            console.error('Error during shutdown:', error);
        } finally {
            process.exit(0);
        }
    } else {
        process.exit(0);
    }
};

module.exports = {
    setup: setupProcessHandlers,
    setClient: (clientInstance) => {
        client = clientInstance;
        
        client.on('ready', () => {
            resetReconnectAttempts();
        });

        client.on('error', error => {
            console.error(`CLIENT ERROR: ${error.stack}`);
            attemptReconnect();
        });

        client.on('disconnect', () => {
            console.warn('Bot disconnected!');
            attemptReconnect();
        });
    }
};
