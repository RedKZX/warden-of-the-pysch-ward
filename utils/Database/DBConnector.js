const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const Prompt = require('../Helpers/Prompt');
const db = require('../../dashboard/server/database/DB');

let config;
try {
    config = require('../../config.json');
} catch (error) {
    console.error('Config file not found or invalid');
}

async function exists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkIfConflict(client) {
    const hasFiles = await cleanupDatabaseFiles(client, true); // Check only
    if (hasFiles) {
        client.logs.warn('Found existing database files. Cleanup required before proceeding.');
        await cleanupDatabaseFiles(client, false); // Actually cleanup
        return true;
    }
    return false;
}

async function setupDatabase(client) {
    try {
        let isDatabaseEnabled = true;
        try {
            const getSettingsStmt = db.prepare('SELECT database_enabled FROM settings ORDER BY id DESC LIMIT 1');
            const settings = getSettingsStmt.get();
            isDatabaseEnabled = settings ? Boolean(settings.database_enabled) : true;
        } catch (error) {
            isDatabaseEnabled = true;
        }

        if (!isDatabaseEnabled) {
            client.logs.warn('Database disabled in settings');
            return false;
        }

        client.logs.database('Database enabled');

        if (await checkIfConflict(client)) {
            return false;
        }

        if (!config?.mongoURL && !config?.sqliteFileName) {
            client.logs.warn('No DB config found');
            return false;
        }

        if (config?.mongoURL) {
            return setupMongoDB(client);
        } else if (config?.sqliteFileName) {
            return setupSQLite(client);
        }
        
        return true;
    } catch (error) {
        client.logs.error(`DB error: ${error.message}`);
        return false;
    }
}

async function setupMongoDB(client, retries = 3, delay = 5000) {
    client.logs.database('Connecting to MongoDB');
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (mongoose.connection.readyState === 1) {
                await mongoose.connection.close();
            }
            
            await mongoose.connect(config.mongoURL, {
                serverSelectionTimeoutMS: 5000,
                connectTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                retryWrites: true,
                retryReads: true
            });
            
            mongoose.connection.on('disconnected', async () => {
                client.logs.warn('MongoDB disconnected, attempting to reconnect...');
                await setupMongoDB(client);
            });
            
            client.logs.database('Connected to MongoDB');
            await createSchemaFolder(client);
            return;
        } catch (error) {
            if (attempt === retries) {
                client.logs.error(`Failed to connect to MongoDB after ${retries} attempts: ${error.message}`);
                await deleteSchemaFolder(client);
                process.exit(1);
            }
            client.logs.warn(`MongoDB connection attempt ${attempt} failed, retrying in ${delay/1000 * Math.pow(2,attempt-1)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
        }
    }
}

async function setupSQLite(client) {
  client.logs.database(`Found SQLite configuration: ${config.sqliteFileName}`);
  const databaseDir = path.join(__dirname, '..', '..', 'database');
  const setupSqlPath = path.join(databaseDir, 'setup.sql');
  
  const sqliteFileName = config.sqliteFileName.split('.').shift()
  const sqliteFilePath = path.join(__dirname, '..', '..', `${sqliteFileName}.sqlite`);

  try {
    await fs.promises.mkdir(databaseDir, { recursive: true });
    if (!(await exists(setupSqlPath))) {
      await fs.promises.writeFile(setupSqlPath, '-- Put your SQL database code here\n-- CREATE TABLE example (id INTEGER PRIMARY KEY, name TEXT);');
    }
    await setupDB(client, setupSqlPath, sqliteFilePath);
  } catch (error) {
    client.logs.error(`Error setting up SQLite: ${error.message}`);
  }
}

async function cleanupDatabaseFiles(client, checkOnly = false) {
    const schemaPath = path.join(__dirname, '..', '..', 'schema');
    const databaseDir = path.join(__dirname, '..', '..', 'database');
    const rootDir = path.join(__dirname, '..', '..');

    try {
        const dbExists = await exists(databaseDir);
        const schemaExists = await exists(schemaPath);
        const dirEntries = await fs.promises.readdir(rootDir);
        const sqliteExists = dirEntries.some(file => file.endsWith('.sqlite'));
        const setupSqlExists = dirEntries.some(file => file === 'setup.sql');
        const hasDatabaseFiles = dbExists || schemaExists || sqliteExists || setupSqlExists;

        if (!hasDatabaseFiles) {
            if (!checkOnly) client.logs.info('No DB files to delete');
            return false;
        }

        if (checkOnly) return true;

        const conf = await Prompt('\x1b[31mExisting database files found. Delete them? (y/N) \x1b[0m');
        if (conf.toLowerCase() !== 'y') {
            client.logs.info('Database files and folders were not deleted');
            process.exit(1);
        }

        await Promise.all([
            fs.promises.rm(schemaPath, { recursive: true, force: true }).catch(() => {}),
            fs.promises.rm(databaseDir, { recursive: true, force: true }).catch(() => {}),
            ...dirEntries
                .filter(file => file.endsWith('.sqlite') || file === 'setup.sql')
                .map(file => fs.promises.unlink(path.join(rootDir, file)).catch(() => {}))
        ]);

        client.logs.info('Database files and folders deleted');
        return true;
    } catch (error) {
        client.logs.error(`Error cleaning up database files: ${error.message}`);
        return false;
    }
}

async function createSchemaFolder(client) {
  const schemaPath = path.join(__dirname, '..', 'schema');
  try {
    await fs.promises.mkdir(schemaPath, { recursive: true });
    client.logs.success('Schema folder created');
  } catch (error) {
    client.logs.error(`Error creating schema folder: ${error.message}`);
  }
}

async function deleteSchemaFolder(client) {
  const schemaPath = path.join(__dirname, '..', 'schema');
  try {
    const conf = (await Prompt('\x1b[31mDo you want to delete the schema folder? (y/N) \x1b[0m'))
    if (conf.toLowerCase() === 'y') {
      await fs.promises.rm(schemaPath, { recursive: true, force: true });
      client.logs.info('Schema folder deleted');
    } else {
      client.logs.info('Schema folder was not deleted');
    }
  } catch (error) {
    client.logs.error(`Error deleting schema folder: ${error.message}`);
  }
}

async function setupDB(client, sqlFilePath, dbPath) {
  try {
    await fs.promises.mkdir(path.join(__dirname, '..', 'database'), { recursive: true });
    const sqlContent = await fs.promises.readFile(sqlFilePath, 'utf-8');
    if (!sqlContent.trim()) {
      client.logs.warn('setup.sql is empty. Please add your database schema.');
      return;
    }
    client.db = new Database(dbPath);
    const sqlStatements = sqlContent
      .replace(/^\s*--.*$/gm, '')
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);
    if (sqlStatements.length === 0) {
      client.logs.warn('No valid SQL statements found in setup.sql. Please add your database schema.');
      return;
    }
    client.db.transaction(() => {
      for (const statement of sqlStatements) { 
        client.db.prepare(statement).run();
      }
    })();
    client.logs.info(`Executed ${sqlStatements.length} SQL statement(s) successfully.`);
  } catch (error) {
    client.logs.error(`Error setting up database: ${error.message}`);
    if (client.db) {
      client.db.close();
    }
  }
}

module.exports = { setupDatabase };
