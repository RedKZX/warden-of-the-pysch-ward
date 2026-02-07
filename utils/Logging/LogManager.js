const crypto = require('crypto');
const db = require('../../dashboard/server/database/DB');
const ColorManager = require('./ColorManager');
const Banner = require('./Banner');

class LogManager {
    constructor() {
        this.wsServer = null;
        this.cleanupInterval = null;
        this.bannerShown = false;
    }

    setWebSocketServer(wsServer) {
        this.wsServer = wsServer;
    }

    async initialize() {
        this.startCleanupSchedule();
    }

    startCleanupSchedule() {
        this.cleanupInterval = setInterval(() => {
            this.cleanOldLogs();
        }, 60 * 60 * 1000);
    }

    stripAnsiCodes(str) {
        return str.replace(/\u001b\[\d+m/g, '');
    }

    async addLog(category, message) {
        const timestamp = new Date().toISOString();
        const cleanMessage = this.stripAnsiCodes(message);
        const id = crypto.randomUUID();

        try {
            db.prepare("INSERT INTO logs (id, category, message, timestamp) VALUES (?, ?, ?, ?)")
                .run(id, category, cleanMessage, timestamp);

            const logEntry = { id, category, message: cleanMessage, timestamp };

            if (this.wsServer) {
                try {
                    this.wsServer.broadcastNewLog(logEntry);
                } catch (error) {
                    console.error('Error broadcasting new log:', error);
                }
            }

            return logEntry;
        } catch (error) {
            console.error('Error adding log to database:', error);
            return null;
        }
    }

    async cleanOldLogs() {
        const twelveHoursAgo = new Date();
        twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

        try {
            db.prepare("DELETE FROM logs WHERE timestamp < ?")
                .run(twelveHoursAgo.toISOString());
            return true;
        } catch (error) {
            console.error('Error cleaning old logs:', error);
            return false;
        }
    }

    async getLogs() {
        try {
            const result = db.prepare("SELECT id, category, message, timestamp FROM logs").all();
            const logs = {};

            for (let i = 0; i < result.length; i++) {
                const row = result[i];
                const { category } = row;
                if (!logs[category]) {
                    logs[category] = [];
                }
                logs[category].push(row);
            }

            return logs; 
        } catch (error) {
            console.error('Error retrieving logs:', error);
            return {};
        }
    }

    async deleteLog(id) {
        try {
            const result = db.prepare("SELECT id FROM logs WHERE id = ?").all(id);

            if (result.length > 0) {
                db.prepare("DELETE FROM logs WHERE id = ?").run(id);

                if (this.wsServer) {
                    this.wsServer.notifyLogDeleted(id);
                }
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error deleting log:', error);
            return false;
        }
    }

    async clearLogs() {
        try {
            db.prepare("DELETE FROM logs").run();
            return true;
        } catch (error) {
            console.error('Error clearing logs:', error);
            return false;
        }
    }

    showStartupBanner() {
        return;
    }

    divider() {
        console.log(ColorManager.colors.brackets + "────────────────────────────────────────────────────────────" + ColorManager.colors.reset);
    }

    _logWithCategory(category, message) {
        const formattedMessage = ColorManager.formatLogMessage(category, message);
        console.log(formattedMessage);
        this.addLog(category, message);
    }

    startup(message) {
        this._logWithCategory('Startup', message);
    }

    info(message) {
        this._logWithCategory('Info', message);
    }

    error(message) {
        this._logWithCategory('Error', message);
    }

    warn(message) {
        this._logWithCategory('Warning', message);
    }

    success(message) {
        this._logWithCategory('Success', message);
    }

    system(message) {
        this._logWithCategory('System', message);
    }

    debug(message) {
        this._logWithCategory('Debug', message);
    }

    command(message) {
        this._logWithCategory('Command', message);
    }

    event(message) {
        this._logWithCategory('Event', message);
    }

    database(message) {
        this._logWithCategory('Database', message);
    }

    api(message) {
        this._logWithCategory('API', message);
    }

    component(message) {
        this._logWithCategory('Component', message);
    }

    dashboard(message) {
        this._logWithCategory('Dashboard', message);
    }

    cache(message) {
        this._logWithCategory('Cache', message);
    }

    interaction(message) {
        this._logWithCategory('Interaction', message);
    }

    prefix(message) {
        this._logWithCategory('Prefix', message);
    }

    count(message) {
        this._logWithCategory('Count', message);
    }
}

module.exports = new LogManager();
