const fs = require("node:fs");
const path = require("node:path");
const FileLoader = require("./FileLoader.js");
const db = require('../../dashboard/server/database/DB');

function HotReloader(client) {
    const fileLoader = new FileLoader(client);
    const reloadTimeouts = new Map();
    const watchedPaths = new Set();
    const fileModificationTimes = new Map();
    const reloadLocks = new Map();
    const getSettingsStmt = db.prepare('SELECT hot_reload_enabled FROM settings ORDER BY id DESC LIMIT 1');

    async function isHotReloadEnabled() {
        try {
            const settings = getSettingsStmt.get();
            return settings ? Boolean(settings.hot_reload_enabled) : true;
        } catch (error) {
            client.logs.error(`Failed to check hot reload status: ${error.message}`);
            return false;
        }
    }

    async function reloadFile(filePath) {
        const normalizedPath = path.normalize(filePath);
        const commandName = path.basename(filePath, '.js');
        const now = Date.now();
        const lastLock = reloadLocks.get(normalizedPath) || 0;
        
        if (now - lastLock < 100) return;
        reloadLocks.set(normalizedPath, now);

        if (reloadTimeouts.has(normalizedPath)) {
            clearTimeout(reloadTimeouts.get(normalizedPath));
        }

        reloadTimeouts.set(normalizedPath,
            setTimeout(async () => {
                try {
                    const stats = fs.statSync(filePath);
                    const lastKnown = fileModificationTimes.get(normalizedPath);
                    if (lastKnown && stats.mtimeMs <= lastKnown) return;

                    fileModificationTimes.set(normalizedPath, stats.mtimeMs);
                    client.logs.info(`Updating: ${commandName}`);
                    delete require.cache[require.resolve(filePath)];
                    await fileLoader.loadFile(filePath);
                } catch (error) {
                    client.logs.error(`Failed to reload ${commandName}: ${error.message}`);
                } finally {
                    reloadTimeouts.delete(normalizedPath);
                    reloadLocks.delete(normalizedPath);
                }
            }, 200)
        );
    }

    function watchFile(filePath) {
        const normalizedPath = path.normalize(filePath);
        if (watchedPaths.has(normalizedPath)) return;
        
        try {
            watchedPaths.add(normalizedPath);
            fileModificationTimes.set(normalizedPath, fs.statSync(filePath).mtimeMs);

            fs.watch(filePath, { persistent: true }, async (eventType) => {
                if (eventType === "change") await reloadFile(filePath);
            }).on('error', (error) => {
                client.logs.error(`Watch error for ${path.relative(process.cwd(), normalizedPath)}: ${error.message}`);
                watchedPaths.delete(normalizedPath);
                fileModificationTimes.delete(normalizedPath);
            });
        } catch (error) {
            client.logs.error(`Failed to watch ${path.relative(process.cwd(), normalizedPath)}: ${error.message}`);
            watchedPaths.delete(normalizedPath);
        }
    }

    function watchDirectory(dirPath) {
        const normalizedPath = path.normalize(dirPath);
        if (watchedPaths.has(normalizedPath)) return;

        try {
            watchedPaths.add(normalizedPath);

            fs.watch(normalizedPath, (_, fileName) => {
                if (!fileName) return;
                const fullPath = path.join(dirPath, fileName);
                if (fs.existsSync(fullPath)) {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) watchDirectory(fullPath);
                    else if (fileName.endsWith('.js')) watchFile(fullPath);
                }
            }).on('error', (error) => {
                client.logs.error(`Watch error for directory ${path.relative(process.cwd(), normalizedPath)}: ${error.message}`);
                watchedPaths.delete(normalizedPath);
            });

            fs.readdirSync(dirPath).forEach(item => {
                const fullPath = path.join(dirPath, item);
                if (fs.statSync(fullPath).isDirectory()) watchDirectory(fullPath);
                else if (item.endsWith('.js')) watchFile(fullPath);
            });
        } catch (error) {
            client.logs.error(`Failed to watch directory ${path.relative(process.cwd(), normalizedPath)}: ${error.message}`);
        }
    }

    this.start = async function() {
        const enabled = await isHotReloadEnabled();
        if (!enabled) {
            client.logs.warn('Hot reload is disabled in dashboard settings');
            return;
        }

        [
            path.resolve(__dirname, "../../commands"),
            path.resolve(__dirname, "../../events"),
            path.resolve(__dirname, "../../components"),
            path.resolve(__dirname, "../../prefix")
        ].forEach(dir => {
            if (fs.existsSync(dir)) {
                watchDirectory(dir);
            } else {
                client.logs.warn(`Directory not found: ${path.relative(process.cwd(), dir)}`);
            }
        });

        client.logs.success('Hot reload system initialized');
    };

    this.status = async function() {
        const enabled = await isHotReloadEnabled();
        return {
            enabled,
            watching: Array.from(watchedPaths).map(p => path.relative(process.cwd(), p)),
            activeReloads: reloadTimeouts.size,
            lockedFiles: reloadLocks.size
        };
    };
}

module.exports = HotReloader;
