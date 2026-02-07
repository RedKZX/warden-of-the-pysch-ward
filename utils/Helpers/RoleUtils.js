const { PermissionsBitField } = require('discord.js');

class RoleUtils {
    constructor(client) {
        this.client = client;
    }

    async compareRoles(roleId1, roleId2, guildId) {
        try {
            if (!roleId1 || !roleId2 || !guildId) {
                return {
                    higher: null,
                    lower: null,
                    equal: false,
                    error: 'Missing required parameters'
                };
            }

            const guild = await this.client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                return {
                    higher: null,
                    lower: null,
                    equal: false,
                    error: 'Guild not found'
                };
            }

            const role1 = await guild.roles.fetch(roleId1).catch(() => console.log('Role not found'), null);
            const role2 = await guild.roles.fetch(roleId2).catch(() => console.log('Role not found'), null);

            if (!role1 || !role2) {
                return {
                    higher: null,
                    lower: null,
                    equal: false,
                    error: 'One or both roles not found'
                };
            }

            if (role1.position === role2.position) {
                return {
                    higher: null,
                    lower: null,
                    equal: true
                };
            }

            return {
                higher: role1.position > role2.position ? role1.id : role2.id,
                lower: role1.position > role2.position ? role2.id : role1.id,
                equal: false
            };
        } catch (error) {
            return {
                higher: null,
                lower: null,
                equal: false,
                error: error.message
            };
        }
    }
}

module.exports = (client) => new RoleUtils(client);
