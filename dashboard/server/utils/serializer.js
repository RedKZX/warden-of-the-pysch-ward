function sanitizeLogData(logs) {
    return logs.map(log => ({
        id: log.id,
        category: log.category,
        message: log.message.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
        timestamp: log.timestamp
    }));
}

module.exports = {
    sanitizeLogData
};
