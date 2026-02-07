const fs = require("node:fs");
const path = require("node:path");

module.exports = (client) => {
  const eventsPath = path.join(__dirname, "..", '..', "events");
  
  const validEvents = ["ready", "error", "warn", "debug", "invalidated", "rateLimit", "applicationCommandCreate", 
    "applicationCommandDelete", "applicationCommandUpdate", "autoModerationActionExecution", 
    "autoModerationRuleCreate", "autoModerationRuleDelete", "autoModerationRuleUpdate", "channelCreate", 
    "channelDelete", "channelPinsUpdate", "channelUpdate", "webhookUpdate", "guildAvailable", "guildBanAdd", 
    "guildBanRemove", "guildCreate", "guildDelete", "guildIntegrationsUpdate", "guildMemberAdd", 
    "guildMemberAvailable", "guildMemberRemove", "guildMembersChunk", "guildMemberUpdate", 
    "guildScheduledEventCreate", "guildScheduledEventDelete", "guildScheduledEventUpdate", 
    "guildScheduledEventUserAdd", "guildScheduledEventUserRemove", "guildUnavailable", "guildUpdate", 
    "interactionCreate", "inviteCreate", "inviteDelete", "messageCreate", "messageDelete", "messageUpdate", 
    "messageDeleteBulk", "messageReactionAdd", "messageReactionRemove", "messageReactionRemoveAll", 
    "messageReactionRemoveEmoji", "presenceUpdate", "roleCreate", "roleDelete", "roleUpdate", 
    "stageInstanceCreate", "stageInstanceDelete", "stageInstanceUpdate", "threadCreate", "threadDelete", 
    "threadListSync", "threadMemberUpdate", "threadMembersUpdate", "threadUpdate", "typingStart", 
    "userUpdate", "voiceStateUpdate", "webhooksUpdate"];

  let loadedEvents = 0;

  function loadEventsRecursively(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const item of items) {
      const filePath = path.join(dir, item.name);
      
      if (item.isDirectory()) {
        loadEventsRecursively(filePath);
      } else if (item.name.endsWith(".js")) {
        const event = require(filePath);

        if (!event.event || !event.execute || !validEvents.includes(event.event)) {
          client.logs.warn(`Invalid event: ${filePath}`);
          continue;
        }

        loadedEvents++;
        client[event.once ? 'once' : 'on'](event.event, (...args) => event.execute(...args, client));
      }
    }
  }

  loadEventsRecursively(eventsPath);

  client.logs.event(`Events: ${loadedEvents}`);
}
