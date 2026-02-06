CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hot_reload_enabled BOOLEAN DEFAULT 1,
    web_dashboard_enabled BOOLEAN DEFAULT 1,
    command_logs_enabled BOOLEAN DEFAULT 1,
    database_enabled BOOLEAN DEFAULT 1,
    maintenance_mode_enabled BOOLEAN DEFAULT 0,
    command_rate_limit INTEGER DEFAULT 1,
    command_rate_window INTEGER DEFAULT 60,
    global_command_cooldown INTEGER DEFAULT 3,
    auto_recovery_attempts INTEGER DEFAULT 3,
    custom_status_text TEXT DEFAULT NULL,
    custom_status_type TEXT DEFAULT 'PLAYING',
    custom_status_state TEXT DEFAULT 'online',
    dm_response_text TEXT DEFAULT NULL,
    emergency_shutdown_code TEXT DEFAULT NULL,
    owner_ids TEXT DEFAULT '[]',
    dev_ids TEXT DEFAULT '[]',
    trusted_user_ids TEXT DEFAULT '[]',
    whitelist_ids TEXT DEFAULT '[]',
    blacklist_ids TEXT DEFAULT '[]',
    two_factor_auth_enabled BOOLEAN DEFAULT 0,
    two_factor_hash TEXT DEFAULT NULL,
    database_backup_interval INTEGER DEFAULT 24,
    backup_retention INTEGER DEFAULT 7,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS command_hashes (
    command_path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS command_aliases (
    command_name TEXT NOT NULL,
    alias TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
