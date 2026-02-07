const ColorManager = require('./ColorManager');
const logManager = require('./LogManager');
const banner = require('./Banner');

class Logger {
    constructor() {
        this.bannerShown = false;
        this.initialize();
    }

    async initialize() {
        await logManager.initialize();
        setInterval(() => logManager.cleanOldLogs(), 24 * 60 * 60 * 1000);
    }

    showStartupBanner() {
        logManager.showStartupBanner();
    }

    divider() {
        logManager.divider();
    }

    async log(type, message, category) {
        const formattedMessage = ColorManager.formatLogMessage(category, message);
        console.log(formattedMessage);
        await logManager.addLog(category, message);
    }

    async system(message) {
        await this.log('system', message, 'System');
    }

    async warn(message) {
        await this.log('warn', message, 'Warning');
    }

    async error(message) {
        await this.log('error', message, 'Error');
    }

    async success(message) {
        await this.log('success', message, 'Success');
    }

    async debug(message) {
        await this.log('debug', message, 'Debug');
    }

    async command(message) {
        await this.log('command', message, 'Command');
    }

    async event(message) {
        await this.log('event', message, 'Event');
    }

    async database(message) {
        await this.log('database', message, 'Database');
    }

    async api(message) {
        await this.log('api', message, 'API');
    }

    async component(message) {
        await this.log('component', message, 'Component');
    }

    async dashboard(message) {
        await this.log('dashboard', message, 'Dashboard');
    }

    async startup(message) {
        await this.log('startup', message, 'Startup');
    }

    async cache(message) {
        await this.log('cache', message, 'Cache');
    }

    async interaction(message) {
        await this.log('interaction', message, 'Interaction');
    }

    async info(message) {
        await this.log('info', message || 'No message provided', 'Info');
    }

    async prefix(message) {
        await this.log('prefix', message, 'Prefix');
    }

    async count(message) {
        await this.log('count', message, 'Count');
    }
}

module.exports = new Logger();
