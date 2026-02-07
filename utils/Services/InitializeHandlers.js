const HotReloader = require("../Helpers/HotReloader.js");

module.exports = async (client) => {
  try {
    client.logs.divider();
    client.logs.startup("INITIALIZING CORE SYSTEMS");
    client.logs.divider();
    
    const ProcessHandler = require("../Handlers/ProcessHandler.js");
    ProcessHandler.setup();
    ProcessHandler.setClient(client);
    
    await require('../Core/PackageChecker.js')(client),

    
    await require("../Database/DBConnector.js").setupDatabase(client)
    
    try {
      client.backupManager = new (require('../Core/BackupManager.js'))(client);
      await client.backupManager.initialize();
    } catch (backupError) {
      client.logs.warn("Backup system using defaults");
      if (!client.backupManager) {
        client.backupManager = new (require('../Core/BackupManager.js'))(client);
      }
    }

    client.logs.divider();
    client.logs.startup("LOADING MODULES");
    client.logs.divider();

    await Promise.all([
      require("../Loaders/ComponentLoader.js")(client),
      require("../Loaders/EventLoader.js")(client),
      require("../Helpers/TemplateGen.js")(client),
      require("../Loaders/PrefixLoader.js")(client),
      new HotReloader(client).start(),
      require("../Handlers/InteractionHandler.js")(client),
    ]);
    
    if (client.config.dashboardPort || client.config.dashboard?.enabled) {
      const DashboardLoader = require('../Services/DashboardLoader');
      const dashboardLoader = new DashboardLoader(client);
      await dashboardLoader.initialize();
    }
  } catch (error) {
    client.logs.error(`Failed to initialize: ${error.message}`);
    process.exit(1);
  }
};
