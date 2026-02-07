const db = require('../../dashboard/server/database/DB');
const DashboardServer = require('../../dashboard/server/DashboardServer');

class DashboardLoader {
    constructor(client) {
        this.client = client;
        this.dashboardServer = null;
    }

    async isDashboardEnabled() {
        try {
            const stmt = db.prepare('SELECT web_dashboard_enabled FROM settings ORDER BY id DESC LIMIT 1');
            const settings = stmt.get();
            return settings ? Boolean(settings.web_dashboard_enabled) : true;
        } catch (error) {
            this.client.logs.warn(`Failed to check dashboard status: ${error.message}`);
            return true; 
        }
    }

    async initialize() {
        const dashboardPort = this.client.config.dashboardPort || 
                              (this.client.config.dashboard && this.client.config.dashboard.port) || 
                              3000;
        
        const dashboardEnabled = Boolean(this.client.config.dashboardPort) || 
                                 Boolean(this.client.config.dashboard && this.client.config.dashboard.enabled);
        
        if (!dashboardEnabled) {
            this.client.logs.dashboard('Dashboard is disabled in config');
            return false;
        }

        try {
            const dashboardEnabled = await this.isDashboardEnabled();
            
            if (!dashboardEnabled) {
                this.client.logs.dashboard('Dashboard is disabled in database settings');
                return false;
            }

            const port = this.client.config.dashboardPort || 
                          (this.client.config.dashboard && this.client.config.dashboard.port) || 
                          3000;
            
            this.dashboardServer = new DashboardServer(this.client);
            
            await this.dashboardServer.start();
            
            global.dashboardServer = this.dashboardServer;
            this.client.dashboardServer = this.dashboardServer;
            
            return true;
        } catch (error) {
            this.client.logs.error(`Failed to initialize dashboard: ${error.message}`);
            return false;
        }
    }
}

module.exports = DashboardLoader;
