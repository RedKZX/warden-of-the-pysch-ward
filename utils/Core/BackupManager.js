const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

class BackupManager extends EventEmitter {
    constructor(client) {
        super();
        this.client = client;
        this.backupInterval = null;
        this.backupSettings = {
            enabled: false,
            interval: 24,
            maxBackups: 5,
            path: './backups'
        };
        this.settingsWatcher = null;
        this.backupDir = path.join(process.cwd(), 'backups');
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            const settings = await this.loadBackupSettings();
            
            if (settings) {
                this.backupSettings = {
                    ...this.backupSettings,
                    ...settings
                };
            }
            
            if (this.backupSettings.enabled) {
                this.scheduleBackups();
            }
            
            this.setupSettingsWatcher();
            this.initialized = true;
            
            this.client.logs.database(`Auto-backup: ${this.backupSettings.interval}h`);
            
            return true;
        } catch (error) {
            this.client.logs.warn(`Backup defaults used`);
            this.scheduleBackups();
            return false;
        }
    }

    async loadBackupSettings() {
        try {
            if (!this.client.dashboardServer) {
                return {
                    enabled: true,
                    interval: 24,
                    maxBackups: 5,
                    path: './backups'
                };
            }
            
            return {
                enabled: true,
                interval: 24,
                maxBackups: 5,
                path: './backups'
            };
        } catch (error) {
            throw new Error('Failed to load backup settings');
        }
    }

    setupSettingsWatcher() {
        const MAX_SAFE_INTERVAL = 24 * 60 * 60 * 1000;
        
        this.settingsWatcher = setInterval(async () => {
            try {
                if (!this.client.dashboardServer || !this.client.dashboardServer.getSettings) {
                    return;
                }
                
                const settings = await this.client.dashboardServer.getSettings();
                
                if (!settings || typeof settings.databaseBackupInterval !== 'number') {
                    return;
                }
                
        
                if (settings.databaseBackupInterval !== this.backupSettings.interval || settings.backupRetention !== this.backupSettings.retention) {
                    this.client.logs.database(`Backup settings changed: Interval=${settings.databaseBackupInterval}h, Retention=${settings.backupRetention}d`);
                    await this.updateSettings(settings.databaseBackupInterval, settings.backupRetention);
                }
            } catch (error) {
                this.client.logs.error(`Failed to check backup settings: ${error.message}`);
            }
        }, 60000);
    }

    scheduleBackups() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
        }

        const MAX_SAFE_INTERVAL = 24 * 60 * 60 * 1000;
        
        const intervalMs = Math.min(
            this.backupSettings.interval * 60 * 60 * 1000, 
            MAX_SAFE_INTERVAL
        );
        
        this.backupInterval = setInterval(() => {
            this.createBackup();
        }, intervalMs);
    }

    async createBackup() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        try {
            if (!this.client.db || !this.client.db.name) {
                throw new Error('Database not initialized or missing path');
            }
            
            const backupFile = path.join(this.backupDir, `backup-${timestamp}.db`);

            await fs.copyFile(this.client.db.name, backupFile);
            this.client.logs.database(`Created backup: ${path.basename(backupFile)}`);
            this.emit('backupCreated', path.basename(backupFile));
            return { success: true, file: path.basename(backupFile) };
        } catch (error) {
            this.client.logs.error(`Backup failed: ${error.message}`);
            
            try {
                const dashboardDbPath = path.join(__dirname, '..', '..', 'dashboard', 'server', 'database', 'dashboard.db');
                if (await this.fileExists(dashboardDbPath)) {
                    const backupFile = path.join(this.backupDir, `dashboard-backup-${timestamp}.db`);
                    await fs.copyFile(dashboardDbPath, backupFile);
                    this.client.logs.database(`Created dashboard backup: ${path.basename(backupFile)}`);
                    this.emit('backupCreated', path.basename(backupFile));
                    return { success: true, file: path.basename(backupFile) };
                }
            } catch (fallbackError) {
                this.client.logs.error(`Fallback backup failed: ${fallbackError.message}`);
            }
            
            throw error;
        }
    }
    
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async cleanupOldBackups() {
        try {
            const files = await fs.readdir(this.backupDir);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(this.backupDir, file);
                const stats = await fs.stat(filePath);
                const daysOld = (now - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

                if (daysOld > this.backupSettings.retention) {
                    await fs.unlink(filePath);
                    this.client.logs.database(`Deleted old backup: ${file}`);
                }
            }
        } catch (error) {
            this.client.logs.error(`Backup cleanup failed: ${error.message}`);
        }
    }

    async updateSettings(interval, retention) {
        const MAX_SAFE_INTERVAL = 24 * 60 * 60 * 1000;
        
        this.backupSettings.interval = Math.min(interval * 60 * 60 * 1000, MAX_SAFE_INTERVAL);
        this.backupSettings.retention = retention;
        this.scheduleBackups();
    }

    stop() {
        if (this.backupInterval) {
            clearInterval(this.backupInterval);
            this.backupInterval = null;
        }
        if (this.settingsWatcher) {
            clearInterval(this.settingsWatcher);
            this.settingsWatcher = null;
        }
        this.initialized = false;
    }
}

module.exports = BackupManager;
