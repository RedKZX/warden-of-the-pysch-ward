const logs = require('../Logging/Logger');

class TimedCache extends Map {
    constructor(defaultTTL = 60000) {
        super();
        this.ttls = new Map();
        this.timeouts = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key, value, ttl = this.defaultTTL) {
        super.set(key, value);
        const expiry = Date.now() + ttl;
        this.ttls.set(key, expiry);
        const timeoutId = setTimeout(() => {
            const clearedValue = super.get(key);
            if (clearedValue !== undefined) {
                logs.cache(`Cleared key "${key}" with value: ${clearedValue}`);
                this.delete(key);
            }
        }, ttl);
        this.timeouts.set(key, timeoutId); 
        return this;
    }

    get(key) {
        if (!this.has(key)) return null;
        const expiry = this.ttls.get(key);
        if (expiry < Date.now()) {
            const clearedValue = super.get(key);
            if (clearedValue !== undefined) {
                logs.cache(`Cleared expired key "${key}" with value: ${clearedValue}`);
                this.delete(key);
            }
            return null;
        }
        return super.get(key);
    }

    delete(key) {
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
        }
        this.ttls.delete(key);
        return super.delete(key);
    }

    clear() {
        this.timeouts.forEach(clearTimeout);
        this.timeouts.clear();
        this.ttls.clear();
        return super.clear();
    }
}

class LRUCache extends Map {
    constructor(maxSize = 1000) {
        super();
        this.maxSize = maxSize;
    }

    set(key, value) {
        if (this.has(key)) {
            this.delete(key);
        } else if (this.size >= this.maxSize) {
            this.delete(this.first());
        }
        super.set(key, value);
        return this;
    }

    get(key) {
        if (!this.has(key)) return null;
        const value = super.get(key);
        this.delete(key);
        super.set(key, value);
        return value;
    }

    first() {
        return this.keys().next().value;
    }
}

class ExpiryMap extends Map {
    constructor() {
        super();
        this.timeouts = new Map();
        this.expiryTimes = new Map();
    }

    set(key, value, expiry = null) {
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
            this.expiryTimes.delete(key);
        }

        if (expiry instanceof Date || typeof expiry === 'number') {
            const expiryTime = expiry instanceof Date ? expiry.getTime() : Date.now() + expiry;
            this.expiryTimes.set(key, expiryTime);
            
            const timeout = setTimeout(() => {
                logs.cache(`Key "${key}" expired with value: ${super.get(key)}`);
                this.delete(key);
            }, expiry instanceof Date ? expiry.getTime() - Date.now() : expiry);
            this.timeouts.set(key, timeout);
        }

        return super.set(key, value);
    }

    delete(key) {
        if (this.timeouts.has(key)) {
            clearTimeout(this.timeouts.get(key));
            this.timeouts.delete(key);
            this.expiryTimes.delete(key);
        }
        return super.delete(key);
    }

    clear() {
        this.timeouts.forEach(clearTimeout);
        this.timeouts.clear();
        this.expiryTimes.clear();
        return super.clear();
    }

    getExpiry(key) {
        return this.expiryTimes.get(key);
    }
    
    getRemainingTTL(key) {
        if (!this.expiryTimes.has(key)) return null;
        return Math.max(this.expiryTimes.get(key) - Date.now(), 0);
    }
}

module.exports = { TimedCache, LRUCache, ExpiryMap };
