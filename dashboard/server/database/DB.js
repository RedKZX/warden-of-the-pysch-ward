const path = require('node:path');
const fs = require('node:fs');
const dbPath = path.join(__dirname, 'dashboard.db');

const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const shouldInitialize = !fs.existsSync(dbPath);
const db = require('better-sqlite3')(dbPath);

if (shouldInitialize) {
    const readSQLFile = (fileName) => {
        const filePath = path.join(__dirname, `${fileName}.sql`);
        return fs.readFileSync(filePath, 'utf-8');
    }

    const fileData = readSQLFile('dashboard');
    const SQLStatements = fileData.split(';').map((statement) => statement.trim());

    for (const statement of SQLStatements) {
        try {
            if (statement) { 
                db.exec(statement);
            }
        } catch (err) {
            console.log(`Error on executing SQL: ${err}`);
        }
    }

    try {
        db.exec(`
            INSERT INTO settings (
                hot_reload_enabled, web_dashboard_enabled, command_logs_enabled, 
                database_enabled, maintenance_mode_enabled
            ) VALUES (1, 1, 1, 1, 0)
        `);
    } catch (err) {
        console.log(`Error setting initial settings: ${err}`);
    }
}

module.exports = db;
