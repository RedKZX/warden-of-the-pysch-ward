const { TimedCache, LRUCache, ExpiryMap } = require('./Cache');

module.exports = (client) => {
    client.timedCache = new TimedCache(300000);
    client.LRUCache = new LRUCache(1000);
    client.ExpiryMap = new ExpiryMap();

    client.logs.success('Caches loaded.');
    
    return {
        timedCache: client.timedCache,
        LRUCache: client.LRUCache,
        ExpiryMap: client.ExpiryMap
    };
};
