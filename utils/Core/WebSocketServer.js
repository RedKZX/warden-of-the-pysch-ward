const WebSocket = require('ws');

class WebSocketServer {
    constructor(server, client) {
        this.wss = new WebSocket.Server({ 
            server,
            maxPayload: 5 * 1024 * 1024, 
            perMessageDeflate: {
                zlibDeflateOptions: {
                    chunkSize: 1024,
                    memLevel: 7,
                    level: 3
                },
                zlibInflateOptions: {
                    chunkSize: 10 * 1024
                },
                clientNoContextTakeover: true,
                serverNoContextTakeover: true,
                threshold: 1024
            }
        });
        this.client = client;
        this.connectedClients = new Set();
        this.maxConnections = 100;
        this.connectionTimeout = 30 * 60 * 1000;
        this.heartbeatInterval = 30000;
        this.heartbeatTimeout = 5000;
        this.setupHandlers();
        this.startStatsInterval();
        this.startHeartbeatInterval();
    }

    setupHandlers() {
        this.wss.on('connection', (ws, req) => {
            if (this.connectedClients.size >= this.maxConnections) {
                this.client.logs.warn(`WebSocket connection limit reached (${this.maxConnections}). Rejecting new connection.`);
                ws.close(1013, 'Maximum connections reached');
                return;
            }

            ws.isAlive = true;
            ws.connectionTime = Date.now();
            ws.timerId = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    this.client.logs.warn('Closing inactive WebSocket connection due to timeout');
                    ws.terminate();
                }
            }, this.connectionTimeout);
            
            this.connectedClients.add(ws);
            this.client.logs.api(`New WebSocket connection from ${req.socket.remoteAddress}`);

            this.sendStats(ws);
            this.sendLogs(ws);


            ws.on('pong', () => {
                ws.isAlive = true;
                clearTimeout(ws.timerId);
                ws.timerId = setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        this.client.logs.warn('Closing inactive WebSocket connection due to timeout');
                        ws.terminate();
                    }
                }, this.connectionTimeout);
            });

            ws.on('message', async (data) => {
                clearTimeout(ws.timerId);
                ws.timerId = setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        this.client.logs.warn('Closing inactive WebSocket connection due to timeout');
                        ws.terminate();
                    }
                }, this.connectionTimeout);
                
                try {
                    const message = JSON.parse(data);
                    if (message.type === 'getLogs') {
                        await this.sendLogs(ws);
                    }
                    else if (message.type === 'getInitialLogs') {
                        try {
                            const logManager = require('../Logging/LogManager');
                            const logs = await logManager.getLogs();
                            
                            const logsArray = Object.entries(logs).flatMap(([category, entries]) =>
                                entries.map(entry => ({
                                    id: entry.id || Math.random().toString(36).substring(2, 15),
                                    timestamp: entry.timestamp || new Date().toISOString(),
                                    level: entry.level || category || "info",
                                    message: entry.content || entry.message || "",
                                    module: entry.module || category || "System"
                                }))
                            ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                            
                            ws.send(JSON.stringify({ 
                                type: 'initialLogs', 
                                logs: logsArray
                            }));
                            
                        } catch (error) {
                            console.error("Error sending initial logs:", error);
                            ws.send(JSON.stringify({
                                type: 'newLog',
                                log: {
                                    timestamp: new Date().toISOString(),
                                    message: `Error loading logs: ${error.message}`,
                                    level: "error",
                                    module: "Console"
                                }
                            }));
                        }
                    }
                    else if (message.type === 'executeCommand') {
                        try {
                            const command = message.command.trim();
                            if (!command) {
                                ws.send(JSON.stringify({
                                    type: 'newLog',
                                    log: {
                                        timestamp: new Date().toISOString(),
                                        message: "Command cannot be empty",
                                        level: "error",
                                        module: "Console"
                                    }
                                }));
                                return;
                            }
                            
                            this.client.logs.command(`Console executed: ${command}`);
                            
                            if (global.dashboardServer && typeof global.dashboardServer.executeConsoleCommand === 'function') {
                                const response = await global.dashboardServer.executeConsoleCommand(command);
                                
                                ws.send(JSON.stringify({
                                    type: 'newLog',
                                    log: {
                                        timestamp: new Date().toISOString(),
                                        message: response,
                                        level: "system",
                                        module: "Console"
                                    }
                                }));
                            } else {
                                throw new Error("Console command execution is not available");
                            }
                        } catch (error) {
                            console.error("Error executing console command:", error);
                            ws.send(JSON.stringify({
                                type: 'newLog',
                                log: {
                                    timestamp: new Date().toISOString(),
                                    message: `Error: ${error.message}`,
                                    level: "error",
                                    module: "Console"
                                }
                            }));
                        }
                    }
                } catch (error) {
                    console.error('WebSocket message error:', error);
                }
            });

            ws.on('close', () => {

                clearTimeout(ws.timerId);
                this.connectedClients.delete(ws);
                ws.isAlive = false;
                ws = null;
                this.client.logs.api('WebSocket client disconnected');
            });
            
            ws.on('error', (error) => {
                console.error('WebSocket connection error:', error);
                clearTimeout(ws.timerId);
                this.connectedClients.delete(ws);
                try {
                    ws.terminate();
                } catch (e) {

                }
                ws = null; 
            });
        });
        
        this.wss.on('error', (error) => {
            console.error('WebSocket server error:', error);
            this.client.logs.error(`WebSocket server error: ${error.message}`);
        });
    }

    startHeartbeatInterval() {
        this.heartbeatTimer = setInterval(() => {
            this.connectedClients.forEach(ws => {
                if (ws.isAlive === false) {
                    this.client.logs.warn('Terminating dead WebSocket connection');
                    ws.terminate();
                    this.connectedClients.delete(ws);
                    return;
                }
                
                ws.isAlive = false;
                try {
                    const heartbeatTimeout = setTimeout(() => {
                        if (!ws.isAlive) {
                            ws.terminate();
                            this.connectedClients.delete(ws);
                        }
                    }, this.heartbeatTimeout);

                    ws.ping();

                    ws.once('close', () => clearTimeout(heartbeatTimeout));
                } catch (error) {
                    clearTimeout(ws.timerId);
                    this.connectedClients.delete(ws);
                    try {
                        ws.terminate();
                    } catch (e) {
                    }
                }
            });
        }, this.heartbeatInterval);
    }

    startStatsInterval() {
        this.statsInterval = setInterval(() => {
            this.broadcastStats();
        }, 1000);
    }

    broadcastStats() {
        if (!this.client || !this.client.guilds) return;
        
        try {
            const stats = {
                type: 'stats',
                data: {
                    memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
                    uptime: this.formatUptime(this.client.uptime),
                    ping: this.client.ws.ping,
                    guilds: this.client.guilds.cache.size,
                    users: Array.from(this.client.guilds.cache.values()).reduce((acc, guild) => acc + (guild.memberCount || 0), 0),
                    commands: this.client.commands ? this.client.commands.size : 0,
                    prefixCommands: this.client.prefixCommands ? this.client.prefixCommands.size : 0
                }
            };

            this.broadcast(stats);
        } catch (error) {
            console.error('Error broadcasting stats:', error);
        }
    }

    broadcast(data) {
        const message = JSON.stringify(data);
        const deadClients = new Set();

        this.connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(message);
                } catch (error) {
                    console.error('Error broadcasting to client:', error);
                    deadClients.add(client);
                }
            } else if (client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING) {
                deadClients.add(client);
            }
        });


        deadClients.forEach(client => {
            clearTimeout(client.timerId);
            this.connectedClients.delete(client);
            try {
                client.terminate();
            } catch (e) {
            }
        });
    }

    sendStats(ws) {
        if (ws.readyState === WebSocket.OPEN && this.client && this.client.guilds) {
            try {
                const stats = {
                    type: 'stats',
                    data: {
                        memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
                        uptime: this.formatUptime(this.client.uptime),
                        ping: `${this.client.ws.ping}`,
                        guilds: this.client.guilds.cache.size,
                        users: Array.from(this.client.guilds.cache.values()).reduce((acc, guild) => acc + (guild.memberCount || 0), 0),
                        commands: this.client.commands ? this.client.commands.size : 0,
                        prefixCommands: this.client.prefixCommands ? this.client.prefixCommands.size : 0
                    }
                };
                ws.send(JSON.stringify(stats));
            } catch (error) {
                console.error('Error sending stats:', error);
            }
        }
    }

    async sendLogs(ws) {
        try {
            if (ws.readyState === WebSocket.OPEN) {
                const logManager = require('../Logging/LogManager');
                const logs = await logManager.getLogs();
                const logsArray = Object.entries(logs)
                    .flatMap(([category, entries]) => 
                        entries.map(entry => ({
                            ...entry,
                            category
                        }))
                    )
                    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                
                ws.send(JSON.stringify({
                    type: 'logs',
                    logs: logsArray
                }));
            }
        } catch (error) {
            console.error('Error sending logs:', error);
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Failed to fetch logs'
                }));
            }
        }
    }

    formatUptime(ms) {
        if (!ms) return '0s';
        
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const uptime = [];

        if (days > 0) uptime.push(`${days}d`);
        if (hours % 24 > 0) uptime.push(`${hours % 24}h`);
        if (minutes % 60 > 0) uptime.push(`${minutes % 60}m`);
        if (seconds % 60 > 0) uptime.push(`${seconds % 60}s`);

        return uptime.join(' ') || '0s';
    }

    notifyLogDeleted(id) {
        this.broadcast({
            type: 'logDeleted',
            id
        });
    }

    notifyLogsCleared() {
        this.broadcast({
            type: 'logsCleared'
        });
    }

    broadcastNewLog(logData) {
        const formattedLog = {
            id: logData.id || Math.random().toString(36).substring(2, 15),
            timestamp: logData.timestamp || new Date().toISOString(),
            level: logData.level || logData.category || 'info',
            message: logData.content || logData.message || '',
            module: logData.module || logData.category || 'System'
        };

        const message = {
            type: 'newLog',
            log: formattedLog
        };

        this.connectedClients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                try {
                    client.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending log to client:', error);
                }
            }
        });
    }

    shutdown() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        this.connectedClients.forEach(client => {
            clearTimeout(client.timerId);
            try {
                client.terminate();
            } catch (error) {
                console.error('Error closing WebSocket connection:', error);
            }
        });
        this.connectedClients.clear();
        this.wss.close();
        
        if (global.gc) {
            try {
                global.gc();
            } catch (e) {
                console.error('Failed to run garbage collection:', e);
            }
        }
    }
}

module.exports = WebSocketServer;
