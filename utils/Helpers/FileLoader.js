const fs = require("node:fs");
const path = require("node:path");
const CommandLoader = require("../Loaders/CommandLoader.js");
const EventLoader = require("../Loaders/EventLoader.js");
const ComponentLoader = require("../Loaders/ComponentLoader.js");
const PrefixLoader = require("../Loaders/PrefixLoader.js");

class FileLoader {
    constructor(client) {
        this.client = client;
    }

    getBaseFolder(filePath) {
        return ['commands', 'events', 'components', 'prefix'].find(base => 
            filePath.includes(path.sep + base + path.sep));
    }

    async loadFile(filePath) {
        const baseFolder = this.getBaseFolder(filePath);
        if (!baseFolder) return;

        const handlers = {
            commands: () => CommandLoader(this.client, filePath),
            events: () => EventLoader(this.client, filePath),
            components: () => ComponentLoader(this.client, filePath),
            prefix: () => PrefixLoader(this.client, filePath)
        };

        return handlers[baseFolder]();
    }
}

module.exports = FileLoader;
