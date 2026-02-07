const db = require('../../dashboard/server/database/DB');

class StatusManager {
    constructor(client) {
        this.client = client;
        this.currentActivity = null;
    }

    async loadStatus() {
        try {
            const settings = db.prepare('SELECT * FROM settings ORDER BY id DESC LIMIT 1').get();
            
            if (settings) {
                if (settings.custom_status_text) {
                    const activityType = settings.custom_status_type || 'PLAYING';
                    
                    await this.client.user.setPresence({
                        activities: [{
                            name: settings.custom_status_text,
                            type: activityType === 'PLAYING' ? 0 
                                : activityType === 'STREAMING' ? 1
                                : activityType === 'LISTENING' ? 2
                                : activityType === 'WATCHING' ? 3
                                : activityType === 'COMPETING' ? 5
                                : 0
                        }],
                        status: settings.custom_status_state || 'online'
                    });

                    this.currentActivity = {
                        text: settings.custom_status_text,
                        type: activityType,
                        state: settings.custom_status_state || 'online'
                    };
                }
            }
        } catch (error) {
            this.client.logs.error(`Failed to load status: ${error.message}`);
        }
    }

    async setStatus(text, type = 'PLAYING', state = 'online') {
        try {
            await this.client.user.setPresence({
                activities: [{
                    name: text,
                    type: type
                }],
                status: state
            });

            this.currentActivity = {
                text,
                type,
                state
            };

            this.client.logs.info(`Status updated: ${type} ${text} (${state})`);
            return true;
        } catch (error) {
            this.client.logs.error(`Failed to set status: ${error.message}`);
            return false;
        }
    }

    getCurrentActivity() {
        return this.currentActivity;
    }
}

module.exports = StatusManager;
