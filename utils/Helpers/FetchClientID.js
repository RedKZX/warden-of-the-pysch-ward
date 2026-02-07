module.exports = async function fetchClientID(client) {
    if (client.user) {
        return client.user.id;
    }
    
    client.logs.warn('Cannot fetch client ID: Bot is not logged in');
    return null;
};
