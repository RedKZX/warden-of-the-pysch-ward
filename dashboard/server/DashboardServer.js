const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const { REST } = require("discord.js");
const { Routes } = require("discord.js");
const { SlashCommandBuilder } = require("discord.js");
const WebSocketServer = require('../../utils/Core/WebSocketServer');
const db = require('./database/DB');
const argon2 = require('argon2');

class DashboardServer {
  constructor(client) {
    this.client = client;
    this.app = express();
    this.startTime = Date.now();
    this.wss = null;
    this.connectedClients = new Set();
    this.wsServer = null;

    this.getSettingsStmt = db.prepare('SELECT * FROM settings ORDER BY id DESC LIMIT 1');
    this.insertSettingsStmt = db.prepare(`
      INSERT INTO settings (
      hot_reload_enabled, web_dashboard_enabled, command_logs_enabled, 
      database_enabled, maintenance_mode_enabled, command_rate_limit, 
      global_command_cooldown, auto_recovery_attempts, custom_status_text,
      custom_status_type, custom_status_state, dm_response_text,
      emergency_shutdown_code, owner_ids, dev_ids, trusted_user_ids,
      whitelist_ids, blacklist_ids, two_factor_auth_enabled, two_factor_hash, 
      database_backup_interval, backup_retention
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.updateSettingsStmt = db.prepare(`
      UPDATE settings SET 
      hot_reload_enabled = ?, web_dashboard_enabled = ?, command_logs_enabled = ?,
      database_enabled = ?, maintenance_mode_enabled = ?, command_rate_limit = ?, 
      global_command_cooldown = ?, auto_recovery_attempts = ?, custom_status_text = ?,
      custom_status_type = ?, custom_status_state = ?, dm_response_text = ?,
      emergency_shutdown_code = ?, owner_ids = ?, dev_ids = ?, trusted_user_ids = ?,
      whitelist_ids = ?, blacklist_ids = ?, two_factor_auth_enabled = ?, two_factor_hash = ?,
      database_backup_interval = ?, backup_retention = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`);

    this.getWhitelistStmt = db.prepare('SELECT user_id FROM whitelist');
    this.insertWhitelistStmt = db.prepare('INSERT OR REPLACE INTO whitelist (user_id, added_by) VALUES (?, ?)');
    this.deleteWhitelistStmt = db.prepare('DELETE FROM whitelist WHERE user_id = ?');

    this.getBlacklistStmt = db.prepare('SELECT user_id, reason FROM blacklist');
    this.insertBlacklistStmt = db.prepare('INSERT OR REPLACE INTO blacklist (user_id, reason, added_by) VALUES (?, ?, ?)');
    this.deleteBlacklistStmt = db.prepare('DELETE FROM blacklist WHERE user_id = ?');

    this.initializeDatabase();

    this.setupMiddleware();
    this.setupRoutes();

    this.backupManager = new (require('../../utils/Core/BackupManager'))(client);
  }

  async initializeDatabase() {
    try {
      const settingsTableInfo = db.pragma('table_info(settings)');
      const hasWhitelistIds = settingsTableInfo.some(column => column.name === 'whitelist_ids');
      const hasBlacklistIds = settingsTableInfo.some(column => column.name === 'blacklist_ids');

      if (!hasWhitelistIds) {
        db.exec('ALTER TABLE settings ADD COLUMN whitelist_ids TEXT DEFAULT \'[]\'');
        this.client.logs.database('Added whitelist_ids column to settings table');
      }

      if (!hasBlacklistIds) {
        db.exec('ALTER TABLE settings ADD COLUMN blacklist_ids TEXT DEFAULT \'[]\'');
        this.client.logs.database('Added blacklist_ids column to settings table');
      }
    } catch (error) {
      this.client.logs.error(`Database initialization error: ${error.message}`);
    }
  }

  async getSettings() {
    try {
      const settings = this.getSettingsStmt.get();
      if (!settings) {
        const defaults = {
          hot_reload_enabled: 1,
          web_dashboard_enabled: 1,
          command_logs_enabled: 1,
          database_enabled: 0,
          maintenance_mode_enabled: 0,
          command_rate_limit: 60,
          global_command_cooldown: 3,
          auto_recovery_attempts: 3,
          custom_status_text: null,
          custom_status_type: 'PLAYING',
          custom_status_state: 'online',
          dm_response_text: null,
          emergency_shutdown_code: null,
          owner_ids: '[]',
          dev_ids: '[]',
          trusted_user_ids: '[]',
          whitelist_ids: '[]',
          blacklist_ids: '[]',
          two_factor_auth_enabled: 0,
          database_backup_interval: 24,
          backup_retention: 7
        };

        const result = this.insertSettingsStmt.run(
          defaults.hot_reload_enabled,
          defaults.web_dashboard_enabled,
          defaults.command_logs_enabled,
          defaults.database_enabled,
          defaults.maintenance_mode_enabled,
          defaults.command_rate_limit,
          defaults.global_command_cooldown,
          defaults.auto_recovery_attempts,
          defaults.custom_status_text,
          defaults.custom_status_type,
          defaults.custom_status_state,
          defaults.dm_response_text,
          defaults.emergency_shutdown_code,
          defaults.owner_ids,
          defaults.dev_ids,
          defaults.trusted_user_ids,
          defaults.whitelist_ids,
          defaults.blacklist_ids,
          defaults.two_factor_auth_enabled,
          null,
          defaults.database_backup_interval,
          defaults.backup_retention
        );

        if (!result.changes) throw new Error('Failed to insert default settings');

        this.syncListTables();

        return {
          hotReloadEnabled: true,
          webDashboardEnabled: true,
          commandLogsEnabled: true,
          databaseEnabled: false,
          maintenanceModeEnabled: false,
          commandRateLimit: 60,
          globalCommandCooldown: 3,
          autoRecoveryAttempts: 3,
          customStatusText: '',
          customStatusType: 'PLAYING',
          customStatusState: 'online',
          dmResponseText: '',
          emergencyShutdownCode: '',
          ownerIds: [],
          devIds: [],
          trustedUserIds: [],
          whitelistIds: [],
          blacklistIds: [],
          twoFactorAuthEnabled: false,
          databaseBackupInterval: 24,
          backupRetention: 7
        };
      }

      const ownerIds = settings.owner_ids ? JSON.parse(settings.owner_ids) : [];
      const devIds = settings.dev_ids ? JSON.parse(settings.dev_ids) : [];
      const trustedUserIds = settings.trusted_user_ids ? JSON.parse(settings.trusted_user_ids) : [];
      const whitelistIds = settings.whitelist_ids ? JSON.parse(settings.whitelist_ids) : [];
      const blacklistIds = settings.blacklist_ids ? JSON.parse(settings.blacklist_ids) : [];

      this.syncListTables(whitelistIds, blacklistIds);

      return {
        hotReloadEnabled: Boolean(settings.hot_reload_enabled),
        webDashboardEnabled: Boolean(settings.web_dashboard_enabled),
        commandLogsEnabled: Boolean(settings.command_logs_enabled),
        databaseEnabled: Boolean(settings.database_enabled),
        maintenanceModeEnabled: Boolean(settings.maintenance_mode_enabled),
        commandRateLimit: settings.command_rate_limit,
        globalCommandCooldown: settings.global_command_cooldown,
        autoRecoveryAttempts: settings.auto_recovery_attempts,
        customStatusText: settings.custom_status_text || '',
        customStatusType: settings.custom_status_type || 'PLAYING',
        customStatusState: settings.custom_status_state || 'online',
        dmResponseText: settings.dm_response_text || '',
        emergencyShutdownCode: settings.emergency_shutdown_code || '',
        ownerIds: ownerIds,
        devIds: devIds,
        trustedUserIds: trustedUserIds,
        whitelistIds: whitelistIds || trustedUserIds,
        blacklistIds: blacklistIds,
        twoFactorAuthEnabled: Boolean(settings.two_factor_auth_enabled),
        databaseBackupInterval: settings.database_backup_interval,
        backupRetention: settings.backup_retention
      };
    } catch (error) {
      console.error("Error getting settings from DB:", error);
      throw error;
    }
  }

  async syncListTables(whitelistIds = [], blacklistIds = []) {
    try {
      const whitelistRows = this.getWhitelistStmt.all() || [];
      const blacklistRows = this.getBlacklistStmt.all() || [];

      const whitelistFromTable = whitelistRows.map(row => row.user_id);
      const blacklistFromTable = blacklistRows.map(row => row.user_id);

      for (const userId of whitelistIds) {
        if (!whitelistFromTable.includes(userId)) {
          this.insertWhitelistStmt.run(userId, 'system');
        }
      }

      for (const userId of blacklistIds) {
        if (!blacklistFromTable.includes(userId)) {
          this.insertBlacklistStmt.run(userId, 'Added via settings sync', 'system');
        }
      }

    } catch (error) {
      this.client.logs.error(`Error syncing list tables: ${error.message}`);
    }
  }

  async saveSettings(newSettings) {
    if (typeof newSettings !== 'object') throw new Error('Invalid settings object');

    const currentSettings = this.getSettingsStmt.get();

    let twoFactorHash = null;
    if (newSettings.twoFactorAuthEnabled) {
      if (currentSettings && !currentSettings.two_factor_auth_enabled) {
        if (!newSettings.twoFactorCode) {
          throw new Error('2FA code is required when enabling 2FA');
        }
        if (!/^\d{6}$/.test(newSettings.twoFactorCode)) {
          throw new Error('2FA code must be exactly 6 digits');
        }
        twoFactorHash = await argon2.hash(newSettings.twoFactorCode, {
          type: argon2.argon2id,
          memoryCost: 4096,
          timeCost: 3,
          parallelism: 1
        });
      }
      else if (newSettings.twoFactorCode) {
        if (!/^\d{6}$/.test(newSettings.twoFactorCode)) {
          throw new Error('2FA code must be exactly 6 digits');
        }
        twoFactorHash = await argon2.hash(newSettings.twoFactorCode, {
          type: argon2.argon2id,
          memoryCost: 4096,
          timeCost: 3,
          parallelism: 1
        });
      }
      else if (currentSettings?.two_factor_hash) {
        twoFactorHash = currentSettings.two_factor_hash;
      }
      else {
        throw new Error('2FA code is required when enabling 2FA');
      }
    }

    const ownerIds = JSON.stringify(newSettings.ownerIds || []);
    const devIds = JSON.stringify(newSettings.devIds || []);
    const trustedUserIds = JSON.stringify(newSettings.trustedUserIds || []);
    const whitelistIds = JSON.stringify(newSettings.whitelistIds || []);
    const blacklistIds = JSON.stringify(newSettings.blacklistIds || []);

    const dbSettings = {
      hot_reload_enabled: Boolean(newSettings.hotReloadEnabled) ? 1 : 0,
      web_dashboard_enabled: Boolean(newSettings.webDashboardEnabled) ? 1 : 0,
      command_logs_enabled: Boolean(newSettings.commandLogsEnabled) ? 1 : 0,
      database_enabled: Boolean(newSettings.databaseEnabled) ? 1 : 0,
      maintenance_mode_enabled: Boolean(newSettings.maintenanceModeEnabled) ? 1 : 0,
      command_rate_limit: Math.max(0, parseInt(newSettings.commandRateLimit) || 60),
      global_command_cooldown: Math.max(0, parseInt(newSettings.globalCommandCooldown) || 3),
      auto_recovery_attempts: Math.max(0, parseInt(newSettings.autoRecoveryAttempts) || 3),
      custom_status_text: newSettings.customStatusText || null,
      custom_status_type: newSettings.customStatusType || 'PLAYING',
      custom_status_state: newSettings.customStatusState || 'online',
      dm_response_text: newSettings.dmResponseText || null,
      emergency_shutdown_code: newSettings.emergencyShutdownCode || null,
      owner_ids: ownerIds,
      dev_ids: devIds,
      trusted_user_ids: trustedUserIds,
      whitelist_ids: whitelistIds,
      blacklist_ids: blacklistIds,
      two_factor_auth_enabled: Boolean(newSettings.twoFactorAuthEnabled) ? 1 : 0,
      two_factor_hash: twoFactorHash,
      database_backup_interval: Math.max(1, parseInt(newSettings.databaseBackupInterval) || 24),
      backup_retention: Math.max(1, parseInt(newSettings.backupRetention) || 7)
    };

    if (currentSettings) {
      if (newSettings.twoFactorAuthEnabled && !twoFactorHash && currentSettings.two_factor_hash) {
        dbSettings.two_factor_hash = currentSettings.two_factor_hash;
      }

      const result = this.updateSettingsStmt.run(
        dbSettings.hot_reload_enabled,
        dbSettings.web_dashboard_enabled,
        dbSettings.command_logs_enabled,
        dbSettings.database_enabled,
        dbSettings.maintenance_mode_enabled,
        dbSettings.command_rate_limit,
        dbSettings.global_command_cooldown,
        dbSettings.auto_recovery_attempts,
        dbSettings.custom_status_text,
        dbSettings.custom_status_type,
        dbSettings.custom_status_state,
        dbSettings.dm_response_text,
        dbSettings.emergency_shutdown_code,
        dbSettings.owner_ids,
        dbSettings.dev_ids,
        dbSettings.trusted_user_ids,
        dbSettings.whitelist_ids,
        dbSettings.blacklist_ids,
        dbSettings.two_factor_auth_enabled,
        dbSettings.two_factor_hash,
        dbSettings.database_backup_interval,
        dbSettings.backup_retention,
        currentSettings.id
      );

      if (!result.changes) throw new Error('Failed to update settings');
    } else {
      const result = this.insertSettingsStmt.run(
        dbSettings.hot_reload_enabled,
        dbSettings.web_dashboard_enabled,
        dbSettings.command_logs_enabled,
        dbSettings.database_enabled,
        dbSettings.maintenance_mode_enabled,
        dbSettings.command_rate_limit,
        dbSettings.global_command_cooldown,
        dbSettings.auto_recovery_attempts,
        dbSettings.custom_status_text,
        dbSettings.custom_status_type,
        dbSettings.custom_status_state,
        dbSettings.dm_response_text,
        dbSettings.emergency_shutdown_code,
        dbSettings.owner_ids,
        dbSettings.dev_ids,
        dbSettings.trusted_user_ids,
        dbSettings.whitelist_ids,
        dbSettings.blacklist_ids,
        dbSettings.two_factor_auth_enabled,
        dbSettings.two_factor_hash,
        dbSettings.database_backup_interval,
        dbSettings.backup_retention
      );

      if (!result.changes) throw new Error('Failed to insert settings');
    }

    await this.syncListTables(
      newSettings.whitelistIds || [],
      newSettings.blacklistIds || []
    );

    this.applySettingsToBot(newSettings);

    if (currentSettings && (
      currentSettings.database_backup_interval !== dbSettings.database_backup_interval ||
      currentSettings.backup_retention !== dbSettings.backup_retention
    )) {
      await this.backupManager.updateSettings(
        dbSettings.database_backup_interval,
        dbSettings.backup_retention
      );
    }

    return await this.getSettings();
  }

  applySettingsToBot(settings) {
    if (settings.customStatusText) {
      try {
        this.client.user.setPresence({
          activities: [{
            name: settings.customStatusText,
            type: settings.customStatusType
          }],
          status: settings.customStatusState
        });
        this.client.logs.info(`Applied custom status: ${settings.customStatusType} ${settings.customStatusText}`);
      } catch (error) {
        this.client.logs.error(`Failed to set custom status: ${error.message}`);
      }
    }

    if (!this.client.config.dashboard) {
      this.client.config.dashboard = {};
    }

    this.client.config.dashboard = {
      ...this.client.config.dashboard,
      maintenanceMode: Boolean(settings.maintenanceModeEnabled),
      ownerIds: settings.ownerIds || [],
      devIds: settings.devIds || [],
      trustedUserIds: settings.trustedUserIds || [],
      whitelistIds: settings.whitelistIds || [],
      blacklistIds: settings.blacklistIds || [],
      emergencyShutdownCode: settings.emergencyShutdownCode
    };

    if (typeof settings.autoRecoveryAttempts === 'number') {
      this.client.config.autoRecoveryAttempts = settings.autoRecoveryAttempts;
    }

    if (settings.dmResponseText) {
      this.client.config.dmResponse = settings.dmResponseText;
    }
  }

  async addToWhitelist(userId, addedBy = 'dashboard') {
    try {
      const result = this.insertWhitelistStmt.run(userId, addedBy);

      const settings = await this.getSettings();
      if (!settings.whitelistIds.includes(userId)) {
        settings.whitelistIds.push(userId);
        await this.saveSettings(settings);
      }

      return result.changes > 0;
    } catch (error) {
      this.client.logs.error(`Failed to add user to whitelist: ${error.message}`);
      return false;
    }
  }

  async addToBlacklist(userId, reason = '', addedBy = 'dashboard') {
    try {
      const result = this.insertBlacklistStmt.run(userId, reason, addedBy);

      const settings = await this.getSettings();
      if (!settings.blacklistIds.includes(userId)) {
        settings.blacklistIds.push(userId);
        await this.saveSettings(settings);
      }

      return result.changes > 0;
    } catch (error) {
      this.client.logs.error(`Failed to add user to blacklist: ${error.message}`);
      return false;
    }
  }

  async removeFromWhitelist(userId) {
    try {
      const result = this.deleteWhitelistStmt.run(userId);

      const settings = await this.getSettings();
      settings.whitelistIds = settings.whitelistIds.filter(id => id !== userId);
      await this.saveSettings(settings);

      return result.changes > 0;
    } catch (error) {
      this.client.logs.error(`Failed to remove user from whitelist: ${error.message}`);
      return false;
    }
  }

  async removeFromBlacklist(userId) {
    try {
      const result = this.deleteBlacklistStmt.run(userId);

      const settings = await this.getSettings();
      settings.blacklistIds = settings.blacklistIds.filter(id => id !== userId);
      await this.saveSettings(settings);

      return result.changes > 0;
    } catch (error) {
      this.client.logs.error(`Failed to remove user from blacklist: ${error.message}`);
      return false;
    }
  }

  setupMiddleware() {
    this.app.use(express.static(path.join(__dirname, "public")));
    this.app.use(express.static(path.join(__dirname, "..", "public")));
    this.app.use(express.json());
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "views"));

    this.app.use((req, res, next) => {
      req.startTime = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - req.startTime;
        this.client.logs.api(
          `${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`
        );
      });
      next();
    });

    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    this.app.locals.getCategoryIcon = (category) => {
      const icons = {
        system: 'mdi-desktop-tower-monitor',
        command: 'mdi-console',
        error: 'mdi-alert-circle',
        info: 'mdi-information',
        warning: 'mdi-alert',
        success: 'mdi-check-circle',
        startup: 'mdi-power',
        event: 'mdi-lightning-bolt',
        prefix: 'mdi-code-brackets',
        component: 'mdi-puzzle',
        database: 'mdi-database',
        api: 'mdi-api',
        cache: 'mdi-cached',
        interaction: 'mdi-gamepad',
      };
      return icons[category.toLowerCase()] || 'mdi-text';
    };

    this.app.locals.getCategoryClass = (category) => {
      const classes = {
        system: 'bg-green-500/20 text-green-400',
        error: 'bg-red-500/20 text-red-400',
        command: 'bg-blue-500/20 text-blue-400',
        info: 'bg-purple-500/20 text-purple-400',
        warning: 'bg-yellow-500/20 text-yellow-400',
        success: 'bg-emerald-500/20 text-emerald-400',
        startup: 'bg-cyan-500/20 text-cyan-400',
        event: 'bg-violet-500/20 text-violet-400',
        prefix: 'bg-yellow-500/20 text-yellow-400',
        component: 'bg-pink-500/20 text-pink-400',
        database: 'bg-cyan-500/20 text-cyan-400',
        api: 'bg-indigo-500/20 text-indigo-400',
        cache: 'bg-blue-500/20 text-blue-400',
        interaction: 'bg-green-500/20 text-green-400',
      };
      return classes[category.toLowerCase()] || 'bg-gray-500/20 text-gray-400';
    };
  }

  getDashboardStats() {
    return {
      guilds: this.client.guilds.cache.size,
      users: Array.from(this.client.guilds.cache.values()).reduce((acc, guild) => {
        const memberCount = guild.memberCount || 0;
        return acc + memberCount;
      }, 0),
      commands: this.client.commands.size,
      prefixCommands: this.client.prefixCommands.size,
      uptime: this.formatUptime(Date.now() - this.startTime),
      memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
      ping: this.client.ws.ping,
    };
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const uptime = [];

    if (days > 0) uptime.push(`${days}d`);
    if (hours % 24 > 0) uptime.push(`${hours % 24}h`);
    if (minutes % 60 > 0) uptime.push(`${minutes % 60}m`);
    if (seconds % 60 > 0) uptime.push(`${seconds % 60}s`);

    return uptime.join(' ');
  }

  async findCommandFile(name) {
    try {
      const decodedName = decodeURIComponent(name).replace(/\.js$/, '');
      const normalizedPath = decodedName.replace(/\\|\//g, path.sep);

      const commandsDir = path.join(__dirname, "../../commands");
      const files = await scanCommandsDirectory(commandsDir);

      const matchingFile = files.find(file => {
        const relativePath = path.relative(commandsDir, file).replace(/\.js$/, '');
        const fileName = path.basename(file, '.js');
        return relativePath === normalizedPath || fileName === normalizedPath;
      });

      return matchingFile;

    } catch (error) {
      console.error('Error in findCommandFile:', error);
      return null;
    }
  }

  async updateCommandFile(filePath, updates) {
    try {
      let content = await fs.readFile(filePath, "utf8");
      const moduleExportsIndex = content.indexOf("module.exports");

      for (const [key, value] of Object.entries(updates)) {
        if (content.includes(`${key}:`)) {
          content = content.replace(
            new RegExp(`(${key}:\\s*)[^,\\n}]*`),
            `$1${value}`
          );
        } else {
          const insertPoint = content.indexOf("{", moduleExportsIndex) + 1;
          content =
            content.slice(0, insertPoint) +
            `\n    ${key}: ${value},` +
            content.slice(insertPoint);
        }
      }

      await fs.writeFile(filePath, content);
      delete require.cache[require.resolve(filePath)];
      const updatedCommand = require(filePath);
      this.client.commands.set(updatedCommand.name, updatedCommand);

      return updatedCommand;
    } catch (error) {
      this.client.logs.error(`Error updating command file: ${error.message}`);
      throw error;
    }
  }

  setupRoutes() {
    async function getFilesRecursively(dir) {
      const dirents = await fs.readdir(dir, { withFileTypes: true });
      const files = await Promise.all(
        dirents.map(async (dirent) => {
          const res = path.resolve(dir, dirent.name);
          return dirent.isDirectory()
            ? await getFilesRecursively(res)
            : (dirent.isFile() && res.endsWith('.js') ? res : []);
        })
      );
      return Array.prototype.concat(...files);
    }

    let commandFileCache = null;
    async function getCommandFiles() {
      if (!commandFileCache) {
        const commandsDir = path.join(__dirname, "..", "..", "commands");
        commandFileCache = await getFilesRecursively(commandsDir);
      }
      return commandFileCache;
    }

    let prefixCommandFileCache = null;
    async function getPrefixCommandFiles() {
      if (!prefixCommandFileCache) {
        const prefixDir = path.join(__dirname, "..", "..", "prefix");
        prefixCommandFileCache = await getFilesRecursively(prefixDir);
      }
      return prefixCommandFileCache;
    }

    async function findCommandFile(commandName) {
      try {
        const files = await getCommandFiles();
        for (const filePath of files) {
          delete require.cache[require.resolve(filePath)];
          const command = require(filePath);
          if (
            (command.data && command.data.name.toLowerCase() === commandName.toLowerCase()) ||
            path.parse(filePath).name.toLowerCase() === commandName.toLowerCase()
          ) {
            return filePath;
          }
        }
        return null;
      } catch (error) {
        console.error("Error finding command file:", error);
        return null;
      }
    }

    async function findPrefixCommandFile(commandName) {
      try {
        const files = await getPrefixCommandFiles();
        for (const filePath of files) {
          delete require.cache[require.resolve(filePath)];
          const command = require(filePath);
          if (
            (command.command && command.command.toLowerCase() === commandName.toLowerCase()) ||
            path.parse(filePath).name.toLowerCase() === commandName.toLowerCase()
          ) {
            return filePath;
          }
        }
        return null;
      } catch (error) {
        console.error("Error finding prefix command file:", error);
        return null;
      }
    }

    this.app.get("/", (req, res) => {
      res.render("index", {
        client: this.client,
        stats: this.getDashboardStats(),
        path: req.path,
      });
    });

    this.app.get("/api/stats", (req, res) => {
      const stats = {
        guilds: this.client.guilds.cache.size,
        users: Array.from(this.client.guilds.cache.values()).reduce((acc, guild) => acc + (guild.memberCount || 0), 0),
        commands: this.client.commands.size,
        prefixCommands: this.client.prefixCommands.size,
        uptime: this.formatUptime(Date.now() - this.startTime),
        memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        ping: this.client.ws.ping,
        cpu: process.cpuUsage(),
        nodeVersion: process.version,
        platform: process.platform
      };
      res.json(stats);
    });

    this.app.get("/api/commands", async (req, res) => {
      try {
        const commands = await Promise.all(
          Array.from(this.client.commands.values()).map(async (cmd) => {
            const filePath = await findCommandFile(cmd.data.name);
            return {
              name: cmd.data.name,
              description: cmd.data.description,
              devOnly: !!cmd.devOnly,
              devGuild: !!cmd.devGuild,
              guildOnly: !!cmd.guildOnly,
              nsfw: !!cmd.nsfw,
              enabled: cmd.enabled !== false,
              cooldown: cmd.cooldown || 0,
              rateLimit: cmd.rateLimit || 0,
              category: cmd.category || "Uncategorized",
              perms: cmd.perms || [],
              allowedGuilds: cmd.allowedGuilds || [],
              allowedUsers: cmd.allowedUsers || [],
              allowedRoles: cmd.allowedRoles || [],
              alias: cmd.alias || [],
              filepath: filePath
                ? path.relative(process.cwd(), filePath)
                : "Unknown location",
            };
          })
        );

        const uniqueCommands = commands.filter(
          (cmd, index, self) =>
            index === self.findIndex((c) => c.name === cmd.name)
        );

        res.json(uniqueCommands);
      } catch (error) {
        console.error("Error fetching commands:", error);
        res.status(500).json({ error: "Failed to fetch commands" });
      }
    });

    this.app.get("/api/dashboard-settings", async (req, res) => {
      try {
        const settings = await this.getSettings();
        res.json(settings);
      } catch (error) {
        res.status(500).json({
          error: "Failed to read dashboard settings",
          details: error.message,
        });
      }
    });

    this.app.post("/api/dashboard-settings", async (req, res) => {
      try {
        const savedSettings = await this.saveSettings(req.body);
        res.json({ success: true, settings: savedSettings });
      } catch (error) {
        res.status(500).json({
          error: "Failed to save dashboard settings",
          details: error.message,
        });
      }
    });

    this.app.get("/api/prefix-commands", async (req, res) => {
      try {
        if (!this.client || !this.client.prefixCommands) {
          return res.status(500).json({
            error: "Prefix commands system is not initialized",
          });
        }

        const commands = this.client.prefixCommands;
        if (commands.size === 0) {
          return res.json([]);
        }

        const prefixCommands = await Promise.all(
          Array.from(commands.entries()).map(async ([name, cmd]) => {
            const filePath = await findPrefixCommandFile(cmd.command || name);
            return {
              name: cmd.command || name,
              description: cmd.description || "No description provided",
              category: cmd.category || "Uncategorized",
              alias: cmd.alias || [],
              devOnly: !!cmd.devOnly,
              devGuild: !!cmd.devGuild,
              guildOnly: !!cmd.guildOnly,
              cooldown: cmd.cooldown || 0,
              perms: cmd.perms || [],
              filepath: filePath
                ? path.relative(process.cwd(), filePath)
                : "Unknown location",
            };
          })
        );

        const uniqueCommands = prefixCommands.filter(
          (cmd, index, self) =>
            index === self.findIndex((c) => c.name === cmd.name)
        );

        res.json(uniqueCommands);
      } catch (error) {
        console.error("Error fetching prefix commands:", error);
        res.status(500).json({
          error: "Failed to fetch prefix commands",
          details: error.message,
        });
      }
    });

    this.app.get("/api/prefix-config", async (req, res) => {
      try {
        const configPath = path.join(__dirname, "..", "..", "config.json");
        const config = JSON.parse(await fs.readFile(configPath, "utf8"));
        res.json({ prefix: config.prefix });
      } catch (error) {
        console.error("Error reading prefix:", error);
        res.status(500).json({ error: "Failed to read prefix configuration" });
      }
    });

    this.app.post("/api/prefix-config", async (req, res) => {
      try {
        const { prefix } = req.body;
        if (!prefix) {
          return res.status(400).json({ error: "Prefix is required" });
        }

        const configPath = path.join(__dirname, "..", "..", "config.json");
        const config = JSON.parse(await fs.readFile(configPath, "utf8"));

        config.prefix = prefix;
        this.client.config.prefix = prefix;

        await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

        res.json({ success: true, prefix });
      } catch (error) {
        console.error("Error updating prefix:", error);
        res.status(500).json({ error: "Failed to update prefix" });
      }
    });

    this.app.post("/api/commands/:name/toggle/:flag", async (req, res) => {
      try {
        const { name, flag } = req.params;
        const command = this.client.commands.get(name);
        if (!command) {
          this.client.logs.error(`Command not found: ${name}`);
          return res.status(404).json({ error: "Command not found" });
        }
        const filePath = await findCommandFile(name);
        if (!filePath) {
          this.client.logs.error(`Command file not found: ${name}`);
          return res.status(404).json({ error: "Command file not found" });
        }
        let content = await fs.readFile(filePath, "utf8");
        const validFlags = ["devOnly", "devGuild", "guildOnly"];
        if (!validFlags.includes(flag)) {
          return res.status(400).json({ error: "Invalid flag" });
        }
        const currentValue = command[flag] || false;
        const newValue = !currentValue;
        command[flag] = newValue;
        const flagRegex = new RegExp(`(${flag}:\\s*)(?:true|false)`);
        if (content.match(flagRegex)) {
          content = content.replace(flagRegex, `$1${newValue}`);
        } else {
          content = content.replace(
            /module\.exports\s*=\s*{/,
            `module.exports = {\n    ${flag}: ${newValue},`
          );
        }
        await fs.writeFile(filePath, content, "utf8");
        res.json({ success: true, command: name, flag, value: newValue });
      } catch (error) {
        console.error("Error toggling command flag:", error);
        res.status(500).json({ error: "Failed to toggle flag", details: error.message });
      }
    });

    this.app.post("/api/commands/:name/cooldown", async (req, res) => {
      try {
        const { name } = req.params;
        const { cooldown } = req.body;
        if (typeof cooldown !== "number" || cooldown < 0) {
          return res.status(400).json({ error: "Invalid cooldown value" });
        }
        const command = this.client.commands.get(name);
        if (!command) return res.status(404).json({ error: "Command not found" });
        const filePath = await findCommandFile(name);
        if (!filePath) return res.status(404).json({ error: "Command file not found" });
        const updatedCommand = await this.updateCommandFile(filePath, { cooldown });
        this.client.commands.set(name, updatedCommand);
        res.json({ success: true, value: cooldown });
      } catch (error) {
        console.error("Command cooldown error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/prefix-commands/:name/toggle/:flag", async (req, res) => {
      try {
        const { name, flag } = req.params;
        const command = this.client.prefixCommands.get(name);
        if (!command) {
          this.client.logs.error(`Prefix command not found: ${name}`);
          return res.status(404).json({ error: "Prefix command not found" });
        }
        const filePath = await findPrefixCommandFile(name);
        if (!filePath) {
          this.client.logs.error(`Prefix command file not found: ${name}`);
          return res.status(404).json({ error: "Prefix command file not found" });
        }
        let content = await fs.readFile(filePath, "utf8");
        const validFlags = ["devOnly", "devGuild", "guildOnly"];
        if (!validFlags.includes(flag)) {
          return res.status(400).json({ error: "Invalid flag" });
        }
        const currentValue = command[flag] || false;
        const newValue = !currentValue;
        command[flag] = newValue;
        const flagRegex = new RegExp(`(${flag}:\\s*)(?:true|false)`);
        if (content.match(flagRegex)) {
          content = content.replace(flagRegex, `$1${newValue}`);
        } else {
          content = content.replace(
            /module\.exports\s*=\s*{/,
            `module.exports = {\n    ${flag}: ${newValue},`
          );
        }
        await fs.writeFile(filePath, content, "utf8");
        res.json({ success: true, command: name, flag, value: newValue });
      } catch (error) {
        console.error("Error toggling prefix command flag:", error);
        res.status(500).json({ error: "Failed to toggle flag", details: error.message });
      }
    });

    this.app.post("/api/prefix-commands/:name/cooldown", async (req, res) => {
      try {
        const { name } = req.params;
        const { cooldown } = req.body;
        if (typeof cooldown !== "number" || cooldown < 0) {
          return res.status(400).json({ error: "Invalid cooldown value" });
        }
        const command = this.client.prefixCommands.get(name);
        if (!command) return res.status(404).json({ error: "Prefix command not found" });
        const filePath = await findPrefixCommandFile(name);
        if (!filePath) return res.status(404).json({ error: "Prefix command file not found" });
        const updatedCommand = await this.updateCommandFile(filePath, { cooldown });
        this.client.prefixCommands.set(name, updatedCommand);
        res.json({ success: true, value: cooldown });
      } catch (error) {
        console.error("Prefix command cooldown error:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/guild/leave/:id", async (req, res) => {
      try {
        const guild = this.client.guilds.cache.get(req.params.id);
        if (guild) {
          await guild.leave();
          res.json({ success: true });
        } else {
          res.status(404).json({ error: "Guild not found" });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get("/api/lists", (req, res) => {
      res.json(this.lists);
    });

    this.app.get("/users", async (req, res) => {
      try {
        const blacklist = await Promise.all(
          this.lists.blacklist.map(async (userId) => {
            const user = await this.client.users
              .fetch(userId)
              .catch(() => null);
            return user
              ? {
                id: userId,
                tag: user.tag,
                avatar: user.displayAvatarURL(),
                username: user.username,
              }
              : null;
          })
        );

        const whitelist = await Promise.all(
          this.lists.whitelist.map(async (userId) => {
            const user = await this.client.users
              .fetch(userId)
              .catch(() => null);
            return user
              ? {
                id: userId,
                tag: user.tag,
                avatar: user.displayAvatarURL(),
                username: user.username,
              }
              : null;
          })
        );

        res.render("users", {
          blacklist: blacklist.filter((user) => user !== null),
          whitelist: whitelist.filter((user) => user !== null),
          searchResults: [],
          path: req.path,
          client: this.client,
          stats: this.getDashboardStats(),
        });
      } catch (error) {
        this.client.logs.error(`Failed to load users: ${error.message}`);
        res.status(500).send("Failed to load users");
      }
    });

    this.app.get("/guilds", async (req, res) => {
      try {
        const guilds = await this.client.guilds.fetch({ force: true });

        if (!guilds || guilds.size === 0) {
          return res.render("guilds", {
            guilds: [],
            path: req.path,
            client: this.client,
            stats: this.getDashboardStats() || { guilds: 0, users: 0 },
          });
        }

        const guildData = await Promise.all(
          Array.from(guilds.values()).map(async (guild) => {
            try {
              const fullguild = await guild.fetch();
              return {
                id: fullguild.id,
                name: fullguild.name,
                memberCount: fullguild.approximateMemberCount || 0,
                icon: fullguild.iconURL() || "/default-icon.png",
                channels: fullguild.channels?.cache?.size || 0,
                roles: fullguild.roles?.cache?.size || 0,
                owner: fullguild.ownerId,
                createdAt: fullguild.createdAt?.toLocaleDateString() || "Unknown",
                features: fullguild.features || [],
                large: fullguild.large || false,
                partnered: fullguild?.partnered ?? false,
                verified: fullguild.verified || false,
                premiumTier: fullguild.premiumTier || 0,
                premiumSubscriptionCount: fullguild.premiumSubscriptionCount || 0,
                maximumMembers: fullguild.maximumMembers || null,
                maximumPresences: fullguild.maximumPresences || null,
                approximateMemberCount: fullguild.approximateMemberCount || 0,
                approximatePresenceCount: fullguild.approximatePresenceCount || 0,
                bots: fullguild.members.cache.filter((member) => member.user.bot).size || 0,
                categories: fullguild.channels.cache.filter((c) => c.type === 4).size || 0,
                textChannels: fullguild.channels.cache.filter((c) => c.type === 0).size || 0,
                voiceChannels: fullguild.channels.cache.filter((c) => c.type === 2).size || 0,
                threadChannels: fullguild.channels.cache.filter((c) => c.isThread()).size || 0,
              };
            } catch (error) {
              console.error(`Error processing guild ${guild.name || guild.id || "unknown"}:`, error.message);
              return null;
            }
          })
        );

        const filteredGuildData = guildData.filter(Boolean);

        if (filteredGuildData.length === 0) {
          return res.render("guilds", {
            guilds: [],
            path: req.path,
            client: this.client,
            stats: this.getDashboardStats() || { guilds: 0, users: 0 },
          });
        }

        res.render("guilds", {
          guilds: filteredGuildData,
          path: req.path,
          client: this.client,
          stats: this.getDashboardStats() || { guilds: filteredGuildData.length, users: 0 },
        });
      } catch (error) {
        console.error("Error fetching guilds:", error.message);

        try {
          res.render("guilds", {
            guilds: [],
            path: req.path,
            client: this.client,
            stats: { guilds: 0, users: 0 },
          });
        } catch (renderError) {
          console.error("Error rendering guilds page:", renderError.message);
          res.status(500).send("Error loading guild data");
        }
      }
    });

    this.app.post("/api/shutdown", (req, res) => {
      res.json({ success: true });
      setTimeout(() => process.exit(0), 500);
    });

    this.app.get("/logs", async (req, res) => {
      try {
        const logManager = require('../../utils/Logging/LogManager');
        const logs = await logManager.getLogs();
        const logsArray = Object.entries(logs).flatMap(([category, entries]) =>
          entries.map(entry => ({
            ...entry,
            category
          }))
        ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.render("logs", {
          logs: logsArray,
          path: req.path,
          client: this.client,
          stats: this.getDashboardStats(),
          getCategoryClass: this.app.locals.getCategoryClass
        });
      } catch (error) {
        console.error("Error loading logs:", error);
        res.status(500).send("Error loading logs");
      }
    });

    this.app.post('/logs/delete', async (req, res) => {
      try {
        const { id } = req.body;
        if (!id) {
          return res.status(400).json({ success: false, message: 'Log ID is required' });
        }

        const logManager = require('../../utils/Logging/LogManager');
        const success = await logManager.deleteLog(id);

        if (success) {
          this.wsServer?.notifyLogDeleted(id);
          res.status(200).json({ success: true });
        } else {
          res.status(404).json({ success: false, message: 'Log not found' });
        }
      } catch (error) {
        console.error('Error deleting log:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
      }
    });

    this.app.post('/logs/clear', async (req, res) => {
      try {
        const logManager = require('../../utils/Logging/LogManager');
        await logManager.clearLogs();

        this.wsServer.notifyLogsCleared();
        res.status(200).json({ success: true });
      } catch (error) {
        console.error('Error clearing logs:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
      }
    });

    this.wsServer?.on('connection', (ws) => {
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);

          if (data.type === 'getLogs') {
            const logManager = require('../../utils/Logging/LogManager');
            const logs = await logManager.getLogs();
            const logsArray = Object.entries(logs).flatMap(([category, entries]) =>
              entries.map(entry => ({
                ...entry,
                category
              }))
            ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            ws.send(JSON.stringify({ type: 'logs', logs: logsArray }));
          }
          else if (data.type === 'deleteLog') {
          }
          else if (data.type === 'clearLogs') {
          }
          else if (data.type === 'getInitialLogs') {
            try {
              const logManager = require('../../utils/Logging/LogManager');
              const logs = await logManager.getLogs();

              const logsArray = Object.entries(logs).flatMap(([category, entries]) =>
                entries.map(entry => ({
                  id: entry.id || Math.random().toString(36).substring(2, 15),
                  timestamp: entry.timestamp || new Date().toISOString(),
                  level: category,
                  message: entry.content || entry.message || "",
                  module: entry.module || category
                }))
              ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

              ws.send(JSON.stringify({
                type: 'initialLogs',
                logs: logsArray
              }));

              if (!this.consoleConnections) {
                this.consoleConnections = new Set();
              }
              this.consoleConnections.add(ws);

              this.client.logs.info(`New console connection established`);
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
          else if (data.type === 'executeCommand') {
            const command = data.command.trim();

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

            try {
              if (command.toLowerCase() === 'clear') {
                return;
              }

              const response = await this.executeConsoleCommand(command);

              ws.send(JSON.stringify({
                type: 'newLog',
                log: {
                  timestamp: new Date().toISOString(),
                  message: response,
                  level: "system",
                  module: "Console"
                }
              }));

              this.client.logs.system(`Console command executed: ${command}`);
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
          console.error("WebSocket message processing error:", error);
        }
      });

      this.client.logs.info("New WebSocket connection");

      ws.on('close', () => {
        if (this.consoleConnections) {
          this.consoleConnections.delete(ws);
        }
        this.client.logs.info("WebSocket connection closed");
      });
    });

    const originalLogManager = require('../../utils/Logging/LogManager');
    const originalLog = originalLogManager.log;

    originalLogManager.log = (category, content, module) => {
      const result = originalLog.call(originalLogManager, category, content, module);

      if (this.consoleConnections && this.consoleConnections.size > 0) {
        const logEntry = {
          timestamp: new Date().toISOString(),
          message: content,
          level: category,
          module: module || category,
          id: result?.id
        };

        this.consoleConnections.forEach(ws => {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'newLog',
              log: logEntry
            }));
          }
        });
      }

      return result;
    };

    this.app.locals.getCategoryIcon = (category) => {
      const icons = {
        system: 'mdi-desktop-tower-monitor',
        command: 'mdi-console',
        error: 'mdi-alert-circle',
        info: 'mdi-information',
        warning: 'mdi-alert',
        success: 'mdi-check-circle',
        startup: 'mdi-power',
        event: 'mdi-lightning-bolt',
        prefix: 'mdi-code-brackets',
        component: 'mdi-puzzle',
        database: 'mdi-database',
        api: 'mdi-api',
        cache: 'mdi-cached',
        interaction: 'mdi-gamepad',
      };
      return icons[category.toLowerCase()] || 'mdi-text';
    };

    this.app.get("/commands", async (req, res) => {
      try {
        const commandsDir = path.join(__dirname, "../../commands");
        const commandFiles = await scanCommandsDirectory(commandsDir);

        const commandStates = {};
        const loadedCommands = Array.from(this.client.commands.keys());

        const commands = await Promise.all(commandFiles.map(async filePath => {
          try {
            const relativePath = path.relative(commandsDir, filePath);
            const commandName = path.basename(filePath, '.js');

            delete require.cache[require.resolve(filePath)];
            const command = require(filePath);

            const isLoaded = loadedCommands.includes(commandName);
            commandStates[commandName] = isLoaded;

            return {
              name: command.data?.name || commandName,
              description: command.data?.description || command.description || "No description provided",
              category: command.category || path.dirname(relativePath) || "Uncategorized",
              cooldown: command.cooldown || 0,
              permission: command.permission || null,
              guildOnly: command.guildOnly || false,
              ownerOnly: command.devOnly || false,
              enabled: isLoaded,
              path: relativePath
            };
          } catch (error) {
            console.error(`Error loading command ${filePath}:`, error);
            return null;
          }
        }));

        const filteredCommands = commands.filter(cmd => cmd !== null);
        const categories = [...new Set(filteredCommands.map(cmd => cmd.category))];

        const guilds = Array.from(this.client.guilds.cache.values()).map(guild => ({
          id: guild.id,
          name: guild.name
        }));

        res.render("commands", {
          commands: filteredCommands,
          commandStates,
          categories,
          guilds,
          path: req.path,
          client: this.client,
          stats: this.getDashboardStats(),
          getCategoryClass: this.app.locals.getCategoryClass
        });
      } catch (error) {
        console.error("Error loading commands page:", error);
        res.render("commands", {
          commands: Array.from(this.client.commands.values()).map(cmd => ({
            name: cmd.data?.name || cmd.name,
            description: cmd.data?.description || cmd.description || "No description provided",
            category: cmd.category || "Uncategorized",
            cooldown: cmd.cooldown || 0,
            permission: cmd.permission || null,
            guildOnly: cmd.guildOnly || false,
            ownerOnly: cmd.devOnly || false,
            enabled: true
          })),
          commandStates: {},
          categories: ["Uncategorized"],
          guilds: Array.from(this.client.guilds.cache.values()).map(guild => ({
            id: guild.id,
            name: guild.name
          })),
          path: req.path,
          client: this.client,
          stats: this.getDashboardStats(),
          getCategoryClass: this.app.locals.getCategoryClass
        });
      }
    });

    this.app.post("/api/commands/:name/reload", async (req, res) => {
      try {
        const { name } = req.params;
        const decodedName = decodeURIComponent(name);

        const commandPath = await this.findCommandFile(decodedName);

        if (!commandPath) {
          return res.status(404).json({
            success: false,
            message: "Command file not found",
            enabled: false
          });
        }

        const commandName = path.basename(commandPath, '.js');

        delete require.cache[require.resolve(commandPath)];
        const command = require(commandPath);
        command.enabled = true;

        this.client.commands.set(commandName, command);
        this.client.logs.system(`Command ${commandName} reloaded successfully`);

        res.json({
          success: true,
          message: `Command ${commandName} reloaded successfully`,
          enabled: true,
          name: commandName
        });
      } catch (error) {
        console.error(`Error reloading command ${req.params.name}:`, error);
        res.status(500).json({
          success: false,
          message: error.message,
          enabled: false
        });
      }
    });

    this.app.post("/api/commands/:name/unload", async (req, res) => {
      try {
        const { name } = req.params;
        const decodedName = decodeURIComponent(name);

        const commandPath = await this.findCommandFile(decodedName);

        if (!commandPath) {
          return res.status(404).json({
            success: false,
            message: "Command file not found",
            enabled: false
          });
        }

        const commandName = path.basename(commandPath, '.js');

        if (this.client.commands.has(commandName)) {
          this.client.commands.delete(commandName);
          this.client.logs.system(`Command ${commandName} unloaded successfully`);
        }

        res.json({
          success: true,
          message: `Command ${commandName} unloaded successfully`,
          enabled: false,
          name: commandName
        });
      } catch (error) {
        console.error(`Error unloading command ${req.params.name}:`, error);
        res.status(500).json({
          success: false,
          message: error.message,
          enabled: true
        });
      }
    });

    this.app.post("/api/commands/:name/settings", async (req, res) => {
      try {
        const { name } = req.params;
        const { cooldown, permission, guildOnly, ownerOnly } = req.body;
        const command = this.client.commands.get(name);

        if (!command) return res.status(404).json({ error: "Command not found" });

        const filePath = await findCommandFile(name);
        if (!filePath) return res.status(404).json({ error: "Command file not found" });

        let content = await fs.readFile(filePath, 'utf8');

        if (content.includes('guildOnly:')) {
          content = content.replace(/guildOnly:\s*(?:true|false)/, `guildOnly: ${guildOnly}`);
        } else {
          content = content.replace(/module\.exports\s*=\s*{/, `module.exports = {\n    guildOnly: ${guildOnly},`);
        }

        if (content.includes('devOnly:')) {
          content = content.replace(/devOnly:\s*(?:true|false)/, `devOnly: ${ownerOnly}`);
        } else {
          content = content.replace(/module\.exports\s*=\s*{/, `module.exports = {\n    devOnly: ${ownerOnly},`);
        }

        if (content.includes('cooldown:')) {
          content = content.replace(/cooldown:\s*\d+/, `cooldown: ${cooldown}`);
        } else {
          content = content.replace(/module\.exports\s*=\s*{/, `module.exports = {\n    cooldown: ${cooldown},`);
        }

        if (content.includes('permission:')) {
          content = content.replace(/permission:\s*(?:(['"]).*?\1|null)/, `permission: ${permission ? `'${permission}'` : 'null'}`);
        } else {
          content = content.replace(/module\.exports\s*=\s*{/, `module.exports = {\n    permission: ${permission ? `'${permission}'` : 'null'},`);
        }

        await fs.writeFile(filePath, content);

        delete require.cache[require.resolve(filePath)];
        const updatedCommand = require(filePath);
        this.client.commands.set(name, updatedCommand);

        res.json({
          success: true,
          command: {
            name,
            cooldown,
            permission,
            guildOnly,
            ownerOnly,
            category: command.category
          }
        });
      } catch (error) {
        console.error("Error updating command settings:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/commands/reload-all", async (req, res) => {
      try {
        const commandsDir = path.join(__dirname, "../../commands");
        const files = await fs.readdir(commandsDir);
        const commandFiles = files.filter(file => file.endsWith('.js'));

        for (const file of commandFiles) {
          const filePath = path.join(commandsDir, file);
          const commandName = path.parse(file).name;

          delete require.cache[require.resolve(filePath)];
          const command = require(filePath);

          this.client.commands.delete(commandName);
          this.client.commands.set(commandName, command);
        }

        this.client.logs.system("All commands reloaded successfully");
        res.json({ success: true, message: "All commands reloaded successfully" });
      } catch (error) {
        console.error("Error reloading all commands:", error);
        res.status(500).json({ success: false, message: error.message });
      }
    });

    this.app.post("/api/commands/:name/toggle", async (req, res) => {
      try {
        const { name } = req.params;
        const { enabled } = req.body;
        const command = this.client.commands.get(name);

        if (!command) {
          return res.status(404).json({ error: "Command not found" });
        }

        const filePath = await findCommandFile(name);
        if (!filePath) {
          return res.status(404).json({ error: "Command file not found" });
        }

        command.enabled = enabled;
        let content = await fs.readFile(filePath, "utf8");

        const enabledRegex = /enabled:\s*(true|false)/;
        if (content.match(enabledRegex)) {
          content = content.replace(enabledRegex, `enabled: ${enabled}`);
        } else {
          content = content.replace(
            /module\.exports\s*=\s*{/,
            `module.exports = {\n    enabled: ${enabled},`
          );
        }

        await fs.writeFile(filePath, content, "utf8");
        res.json({ success: true, enabled });
      } catch (error) {
        console.error("Error toggling command:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/commands/:name/settings", async (req, res) => {
      try {
        const { name } = req.params;
        const { cooldown, permission, guildOnly, ownerOnly } = req.body;
        const command = this.client.commands.get(name);

        if (!command) {
          return res.status(404).json({ error: "Command not found" });
        }

        const filePath = await findCommandFile(name);
        if (!filePath) {
          return res.status(404).json({ error: "Command file not found" });
        }

        const updates = {
          cooldown: cooldown || 0,
          permission: permission ? `"${permission}"` : null,
          guildOnly,
          ownerOnly
        };

        const updatedCommand = await this.updateCommandFile(filePath, updates);
        this.client.commands.set(name, updatedCommand);

        res.json({ success: true, command: updatedCommand });
      } catch (error) {
        console.error("Error updating command settings:", error);
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/commands', async (req, res) => {
      const commands = [...this.client.commands.values()];
      const categories = [...new Set(commands.map(cmd => cmd.category || 'Uncategorized'))];

      res.render('commands', {
        client: this.client,
        commands,
        categories,
        path: '/commands',
        stats: {
          memoryUsage: this.formatMemoryUsage(process.memoryUsage().heapUsed),
          uptime: this.formatUptime(this.client.uptime)
        }
      });
    });

    this.app.get('/', (req, res) => {
      const stats = {
        memoryUsage: formatBytes(process.memoryUsage().heapUsed),
        uptime: formatUptime(client.uptime),
        commands: {
          slash: Array.from(client.commands.values())
            .filter(cmd => cmd.type === 'CHAT_INPUT')
            .map(cmd => ({
              name: cmd.name,
              description: cmd.description,
              category: cmd.category || 'Misc',
              cooldown: cmd.cooldown,
              permission: cmd.permission,
              guildOnly: cmd.guildOnly,
              ownerOnly: cmd.ownerOnly
            })),
          user: Array.from(client.commands.values())
            .filter(cmd => cmd.type === 'USER')
            .map(cmd => ({
              name: cmd.name,
              description: cmd.description,
              category: cmd.category || 'Misc'
            })),
          message: Array.from(client.commands.values())
            .filter(cmd => cmd.type === 'MESSAGE')
            .map(cmd => ({
              name: cmd.name,
              description: cmd.description,
              category: cmd.category || 'Misc'
            }))
        }
      };

      res.render('index', {
        path: '/',
        client,
        stats,
        commands: stats.commands
      });
    });

    this.app.get('/', (req, res) => {
      const slashCommands = Array.from(this.client.commands.values())
        .filter(cmd => cmd.data?.type === 'CHAT_INPUT')
        .map(cmd => ({
          name: cmd.data?.name || cmd.name,
          description: cmd.data?.description || cmd.description,
          category: cmd.category || 'Misc',
          cooldown: cmd.cooldown || 0,
          permission: cmd.permission,
          guildOnly: cmd.guildOnly || false,
          ownerOnly: cmd.devOnly || false
        }));

      const prefixCommands = Array.from(this.client.prefixCommands?.values() || [])
        .map(cmd => ({
          name: cmd.command,
          description: cmd.description || 'No description',
          category: cmd.category || 'Misc',
          cooldown: cmd.cooldown || 0,
          permission: cmd.permission,
          guildOnly: cmd.guildOnly || false,
          ownerOnly: cmd.devOnly || false
        }));

      const stats = {
        guilds: this.client.guilds.cache.size,
        users: Array.from(this.client.guilds.cache.values()).reduce((acc, guild) => acc + (guild.memberCount || 0), 0),
        commands: this.client.commands.size,
        slashCommands: slashCommands.length,
        prefixCommands: prefixCommands.length,
        uptime: this.formatUptime(this.client.uptime),
        memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        ping: this.client.ws.ping
      };

      res.render('index', {
        path: '/',
        client: this.client,
        stats,
        commands: {
          slash: slashCommands,
          prefix: prefixCommands
        }
      });
    });

    this.app.post("/api/commands/:name/:action", async (req, res) => {
      try {
        const { name, action } = req.params;

        if (!name) {
          return res.status(400).json({ success: false, message: "Command name is required" });
        }

        switch (action) {
          case 'enable':
            await this.enableCommand(name, req, res);
            break;
          case 'disable':
            await this.disableCommand(name, req, res);
            break;
          case 'reload':
            await this.reloadCommand(name, req, res);
            break;
          case 'delete':
            await this.deleteCommand(name, req, res);
            break;
          default:
            res.status(400).json({ success: false, message: "Invalid action" });
        }
      } catch (error) {
        console.error(`Error handling command action (${req.params.action}):`, error);
        res.status(500).json({ success: false, message: error.message });
      }
    });

    this.app.get("/settings", async (req, res) => {
      try {
        const settings = await this.getSettings();
        res.render("settings", {
          client: this.client,
          stats: this.getDashboardStats(),
          path: req.path,
          settings
        });
      } catch (error) {
        console.error("Error loading settings page:", error);
        res.status(500).send("Error loading settings");
      }
    });

    this.app.get("/console", (req, res) => {
      try {
        res.render("console", {
          client: this.client,
          stats: this.getDashboardStats(),
          path: req.path
        });
      } catch (error) {
        console.error("Error loading console page:", error);
        res.status(500).send("Error loading console");
      }
    });

    this.app.get('/logs/page/:page', async (req, res) => {
      try {
        const pageNum = parseInt(req.params.page, 10) || 1;
        const limit = 50;
        const offset = parseInt(req.query.offset, 10) || 0;
        const filter = req.query.filter || 'all';

        const logManager = require('../../utils/Logging/LogManager');
        const logs = await logManager.getLogs();

        let logsArray = Object.entries(logs).flatMap(([category, entries]) =>
          entries.map(entry => ({
            ...entry,
            category
          }))
        ).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (filter !== 'all') {
          logsArray = logsArray.filter(log =>
            log.category.toLowerCase() === filter.toLowerCase()
          );
        }

        const paginatedLogs = logsArray.slice(offset, offset + limit);

        res.json(paginatedLogs);
      } catch (error) {
        console.error('Error loading paginated logs:', error);
        res.status(500).json({ error: 'Failed to load logs' });
      }
    });

    this.app.get("/api/users", async (req, res) => {
      try {
        const settings = await this.getSettings();

        const ownerUsers = await Promise.all(settings.ownerIds.map(async id => {
          try {
            const user = await this.client.users.fetch(id);
            return { id, username: user.username };
          } catch (error) {
            return { id, username: 'Unknown User' };
          }
        }));

        const devUsers = await Promise.all(settings.devIds.map(async id => {
          try {
            const user = await this.client.users.fetch(id);
            return { id, username: user.username };
          } catch (error) {
            return { id, username: 'Unknown User' };
          }
        }));

        const whitelistUsers = await Promise.all(settings.whitelistIds.map(async id => {
          try {
            const user = await this.client.users.fetch(id);
            return { id, username: user.username };
          } catch (error) {
            return { id, username: 'Unknown User' };
          }
        }));

        const blacklistUsers = await Promise.all(settings.blacklistIds.map(async id => {
          try {
            const user = await this.client.users.fetch(id);
            return { id, username: user.username };
          } catch (error) {
            return { id, username: 'Unknown User' };
          }
        }));

        res.json({
          owners: ownerUsers,
          devs: devUsers,
          whitelist: whitelistUsers,
          blacklist: blacklistUsers
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post("/api/users/:type", async (req, res) => {
      try {
        const { type } = req.params;
        let { userId } = req.body;

        userId = String(userId);

        if (!userId || !/^\d{17,19}$/.test(userId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid user ID"
          });
        }

        const settings = await this.getSettings();
        let user;
        try {
          user = await this.client.users.fetch(userId);
        } catch (error) {
          return res.status(404).json({
            success: false,
            message: "User not found on Discord"
          });
        }

        this.client.logs.info(`Adding user ${userId} (${user.username}) as ${type}`);

        switch (type) {
          case 'owner':
            if (!settings.ownerIds.includes(userId)) {
              settings.ownerIds.push(userId);
            }
            break;
          case 'dev':
            if (!settings.devIds.includes(userId)) {
              settings.devIds.push(userId);
            }
            break;
          case 'whitelist':
            if (!settings.whitelistIds.includes(userId)) {
              settings.whitelistIds.push(userId);
            }
            if (!settings.trustedUserIds.includes(userId)) {
              settings.trustedUserIds.push(userId);
            }
            break;
          case 'blacklist':
            if (!settings.blacklistIds.includes(userId)) {
              settings.blacklistIds.push(userId);
            }
            break;
          default:
            return res.status(400).json({
              success: false,
              message: "Invalid user type"
            });
        }

        await this.saveSettings(settings);
        res.json({
          success: true,
          user: { id: userId, username: user.username }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
    });

    this.app.delete("/api/users/:type/:userId", async (req, res) => {
      try {
        const { type, userId } = req.params;
        const settings = await this.getSettings();

        switch (type) {
          case 'owner':
            settings.ownerIds = settings.ownerIds.filter(id => id !== userId);
            break;
          case 'dev':
            settings.devIds = settings.devIds.filter(id => id !== userId);
            break;
          case 'whitelist':
            settings.whitelistIds = settings.whitelistIds.filter(id => id !== userId);
            settings.trustedUserIds = settings.trustedUserIds.filter(id => id !== userId);
            break;
          case 'blacklist':
            settings.blacklistIds = settings.blacklistIds.filter(id => id !== userId);
            break;
          default:
            return res.status(400).json({
              success: false,
              message: "Invalid user type"
            });
        }

        await this.saveSettings(settings);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
    });

    this.app.post("/api/hash", async (req, res) => {
      try {
        const { password } = req.body;
        const hash = await argon2.hash(password);
        res.json({ success: true, hash });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    })

    this.app.post("/api/database/backup", async (req, res) => {
      try {
        const result = await this.backupManager.createBackup();
        res.json(result);
      } catch (error) {
        this.client.logs.error(`Manual backup failed: ${error.message}`);
        res.status(500).json({
          success: false,
          message: error.message
        });
      }
    });

  }

  async start() {
    await this.initializeFiles();

    const port = this.client.config.dashboardPort ||
      (this.client.config.dashboard && this.client.config.dashboard.port) ||
      3000;

    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(port, "127.0.0.1", () => {
          this.wsServer = new WebSocketServer(this.server, this.client);

          const logManager = require('../../utils/Logging/LogManager');
          logManager.setWebSocketServer(this.wsServer);

          this.setupLogStream();

          global.dashboardServer = this;
          resolve();
        })
        .on("error", (error) => {
          if (error.code === "EADDRINUSE") {
            this.client.logs.error(
              `Port ${port} is already in use. Your server is still online: http://localhost:${port}/`
            );
          }
          reject(error);
        });

      this.connections = new Set();
      this.server.on("connection", (conn) => {
        this.connections.add(conn);
        conn.on("close", () => this.connections.delete(conn));
      });
    });
  }

  setupLogStream() {
    try {
      const logManager = require('../../utils/Logging/LogManager');
      const originalLog = logManager.log;

      logManager.log = (category, content, module) => {
        const result = originalLog.call(logManager, category, content, module);

        if (this.consoleConnections && this.consoleConnections.size > 0) {
          const logEntry = {
            id: result?.id || Math.random().toString(36).substring(2, 15),
            timestamp: new Date().toISOString(),
            message: content,
            level: category,
            module: module || category
          };

          this.consoleConnections.forEach(ws => {
            if (ws.readyState === 1) {
              try {
                ws.send(JSON.stringify({
                  type: 'newLog',
                  log: logEntry
                }));
              } catch (error) {
                console.error("Error sending log to console client:", error);
              }
            }
          });
        }

        return result;
      };

      return true;
    } catch (error) {
      console.error("Error setting up log stream:", error);
      return false;
    }
  }

  async initializeFiles() {
    const publicDir = path.join(__dirname, "..", "public");
    const cssDir = path.join(publicDir, "css");
    const jsDir = path.join(publicDir, "js");

    await fs.mkdir(publicDir, { recursive: true });
    await fs.mkdir(cssDir, { recursive: true });
    await fs.mkdir(jsDir, { recursive: true });

    const cssFile = path.join(cssDir, "dashboard.css");
    const jsFile = path.join(jsDir, "dashboard.js");

    try {
      await fs.access(cssFile);
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs.writeFile(cssFile, "/* Dashboard Styles */");
      }
    }

    try {
      await fs.access(jsFile);
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs.writeFile(jsFile, "// Dashboard Scripts");
      }
    }
  }

  shutdown() {
    return new Promise((resolve) => {
      this.client.logs.warn("Starting dashboard server shutdown...");

      if (this.wsServer) {
        this.client.logs.info("Closing WebSocket server...");
        this.wsServer.shutdown();
      }

      if (this.consoleConnections && this.consoleConnections.size > 0) {
        this.client.logs.info(`Closing ${this.consoleConnections.size} console connections...`);
        for (const conn of this.consoleConnections) {
          try {
            if (conn.readyState === 1) {
              conn.close(1000, "Server shutting down");
            }
          } catch (err) {
            this.client.logs.error(`Error closing WebSocket connection: ${err.message}`);
          }
        }
        this.consoleConnections.clear();
      }

      if (this.server) {
        this.client.logs.info("Closing HTTP server...");

        if (this.connections) {
          this.client.logs.info(`Closing ${this.connections.size} active HTTP connections...`);
          for (const conn of this.connections) {
            conn.destroy();
          }
          this.connections.clear();
        }

        this.server.close(() => {
          this.client.logs.success("Dashboard server shut down successfully.");
          resolve();
        });
      } else {
        this.client.logs.warn("No server instance to shut down.");
        resolve();
      }

      this.backupManager.stop();
    });
  }

  async executeConsoleCommand(command) {
    if (!command) throw new Error("No command provided");

    command = command.replace(/^['"](.*)['"]$/, '$1');

    if (command === "stats") {
      const stats = this.getDashboardStats();
      return `Bot Statistics:
  - Servers: ${stats.guilds}
  - Users: ${stats.users}
  - Commands: ${stats.commands}
  - Prefix Commands: ${stats.prefixCommands}
  - Uptime: ${stats.uptime}
  - Memory: ${stats.memoryUsage}
  - Ping: ${this.client.ws.ping}ms`;
    }
    else if (command === "help") {
      return `Available Commands:
  - help: Show this help message
  - stats: Show bot statistics
  - guilds: List connected servers
  - uptime: Show bot uptime
  - ping: Check bot latency
  - memory: Show memory usage details
  - commands: List all commands
  - clear: Clear the console display
  - version: Show bot version information`;
    }
    else if (command === "guilds") {
      const guilds = Array.from(this.client.guilds.cache.values())
        .map(g => `- ${g.name} (${g.id}) - ${g.memberCount} members`);

      if (guilds.length === 0) {
        return "Bot is not connected to any servers.";
      }

      return `Connected to ${guilds.length} servers:\n${guilds.join('\n')}`;
    }
    else if (command === "uptime") {
      return `Bot has been online for ${this.formatUptime(Date.now() - this.startTime)}`;
    }
    else if (command === "ping") {
      return `Current WebSocket latency: ${this.client.ws.ping}ms`;
    }
    else if (command === "memory") {
      const used = process.memoryUsage();
      return `Memory Usage:
  - RSS: ${Math.round(used.rss / 1024 / 1024 * 100) / 100} MB
  - Heap Total: ${Math.round(used.heapTotal / 1024 / 1024 * 100) / 100} MB
  - Heap Used: ${Math.round(used.heapUsed / 1024 / 1024 * 100) / 100} MB
  - External: ${Math.round(used.external / 1024 / 1024 * 100) / 100} MB`;
    }
    else if (command === "commands") {
      const commands = Array.from(this.client.commands.keys());
      const prefixCommands = Array.from(this.client.prefixCommands?.keys() || []);

      if (commands.length === 0 && (!prefixCommands || prefixCommands.length === 0)) {
        return "No commands are currently registered.";
      }

      let response = `Available Commands (${commands.length + (prefixCommands?.length || 0)} total):`;

      if (commands.length > 0) {
        response += `\n\nSlash Commands (${commands.length}):\n- ${commands.join('\n- ')}`;
      }

      if (prefixCommands && prefixCommands.length > 0) {
        response += `\n\nPrefix Commands (${prefixCommands.length}):\n- ${prefixCommands.join('\n- ')}`;
      }

      return response;
    }
    else if (command === "version") {
      return `Bot Information:
  - Bot Name: ${this.client.user.username}
  - Bot ID: ${this.client.user.id}
  - Discord.js: v${require('discord.js').version}
  - Node.js: ${process.version}
  - OS: ${process.platform} ${process.arch}`;
    }

    return `Unknown command: "${command}"\nType "help" to see a list of available commands.`;
  }
}

async function scanCommandsDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let commands = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const subCommands = await scanCommandsDirectory(fullPath);
      commands = commands.concat(subCommands);
    } else if (entry.name.endsWith('.js')) {
      commands.push(fullPath);
    }
  }

  return commands;
}

module.exports = DashboardServer;
