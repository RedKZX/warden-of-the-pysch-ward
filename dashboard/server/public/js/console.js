class ConsoleManager {
    constructor() {
        this.ws = null;
        this.consoleElement = document.getElementById('console');
        this.commandInput = document.getElementById('commandInput');
        this.MAX_LOGS = 300;
        this.isPaused = false;
        this.logBuffer = [];
        this.commandHistory = [];
        this.historyIndex = -1;
        this.allLogs = [];
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        
        this.init();
    }

    init() {
        this.connectWebSocket();
        this.setupEventListeners();
        this.commandInput.focus();
    }

    connectWebSocket() {
        this.ws = new WebSocket(`ws://${window.location.host}/console`);
        this.setupWebSocketHandlers();
    }

    setupWebSocketHandlers() {
        this.ws.onopen = () => {
            this.reconnectAttempts = 0;
            this.showStatus('Connected');
            this.ws.send(JSON.stringify({ type: 'getInitialLogs' }));
            this.appendLog({
                timestamp: new Date().toISOString(),
                message: "Welcome to Synapse Console. Type 'help' for commands.",
                level: "system",
                module: "Console"
            });
        };

        this.ws.onmessage = ({data}) => {
            try {
                const parsedData = JSON.parse(data);
                if (parsedData.type === 'initialLogs') {
                    this.handleInitialLogs(parsedData.logs);
                } else if (parsedData.type === 'newLog') {
                    this.appendLog(parsedData.log);
                }
            } catch (error) {
                this.handleError("WebSocket message parse error", error);
            }
        };

        this.ws.onclose = () => this.handleDisconnect();
    }

    handleInitialLogs(logs) {
        this.consoleElement.innerHTML = '';
        this.allLogs = [];
        const recentLogs = logs.slice(-this.MAX_LOGS);
        
        if (logs.length > this.MAX_LOGS) {
            this.appendLog({
                timestamp: new Date().toISOString(),
                message: `${logs.length - this.MAX_LOGS} older logs omitted`,
                level: "system",
                module: "Console"
            });
        }
        
        recentLogs.forEach(log => this.appendLog(log));
    }

    appendLog(log) {
        if (!log?.message) return;

        this.allLogs.push(log);
        this.trimLogs();

        if (this.isPaused) {
            this.logBuffer.push(log);
            return;
        }

        if (!this.shouldDisplayLog(log)) return;

        const logEntry = this.createLogEntry(log);
        this.consoleElement.appendChild(logEntry);
        this.scrollToBottom();
    }

    createLogEntry(log) {
        const entry = document.createElement('div');
        entry.className = `log-entry log-new ${log.level?.toLowerCase()}-log`;
        entry.dataset.level = log.level?.toLowerCase();
        entry.dataset.text = `${log.message} ${log.module || ''}`.toLowerCase();
        
        entry.innerHTML = `
            <div class="flex items-start">
                <div class="mr-2 ${this.getLogColor(log.level)}">
                    <i class="mdi ${this.getLevelIcon(log.level)}"></i>
                </div>
                <div class="flex-1">
                    <div class="flex justify-between">
                        <span class="${this.getLogColor(log.level)} font-medium">
                            [${log.level?.toUpperCase()}]${log.module ? ` ${log.module}` : ''}
                        </span>
                        <span class="timestamp">${this.formatTimestamp(log.timestamp)}</span>
                    </div>
                    <div class="mt-1 break-words whitespace-pre-wrap">${log.message}</div>
                </div>
            </div>
        `;

        setTimeout(() => entry.classList.remove('log-new'), 1000);
        return entry;
    }

    setupEventListeners() {
        document.getElementById('pauseConsole').onclick = () => this.togglePause();
        document.getElementById('clearConsole').onclick = () => this.clearConsole();
        document.getElementById('logFilter').onchange = () => this.filterLogs();
        document.getElementById('searchLogs').oninput = this.debounce(() => this.filterLogs(), 300);
        document.getElementById('commandForm').onsubmit = (e) => this.handleCommand(e);
        this.commandInput.onkeydown = (e) => this.handleKeyboardInput(e);
        
        document.onvisibilitychange = () => this.handleVisibilityChange();
        document.onkeydown = (e) => this.handleGlobalShortcuts(e);
    }

    getLogColor(level) {
        return {
            info: 'text-blue-400',
            warn: 'text-yellow-400',
            warning: 'text-yellow-400',
            error: 'text-red-400',
            system: 'text-green-400',
            command: 'text-purple-400',
            success: 'text-emerald-400',
            startup: 'text-cyan-400',
            api: 'text-indigo-400'
        }[String(level).toLowerCase()] || 'text-gray-200';
    }

    getLevelIcon(level) {
        return {
            info: 'mdi-information',
            warn: 'mdi-alert',
            warning: 'mdi-alert',
            error: 'mdi-alert-circle',
            system: 'mdi-desktop-tower-monitor',
            command: 'mdi-console',
            success: 'mdi-check-circle',
            startup: 'mdi-power',
            api: 'mdi-api'
        }[String(level).toLowerCase()] || 'mdi-text';
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return '';
        try {
            return new Date(timestamp).toTimeString().split(' ')[0];
        } catch (e) {
            return '';
        }
    }

    scrollToBottom() {
        if (!this.isPaused) {
            this.consoleElement.scrollTop = this.consoleElement.scrollHeight;
        }
    }

    trimLogs() {
        if (this.allLogs.length > this.MAX_LOGS) {
            const excess = this.allLogs.length - this.MAX_LOGS;
            this.allLogs = this.allLogs.slice(excess);
            
            if (!this.isPaused) {
                const logEntries = this.consoleElement.querySelectorAll('.log-entry');
                for (let i = 0; i < Math.min(excess, logEntries.length); i++) {
                    logEntries[i].remove();
                }
            }
        }
    }

    togglePause() {
        this.isPaused = !this.isPaused;
        const pauseBtn = document.getElementById('pauseConsole');
        
        if (this.isPaused) {
            pauseBtn.innerHTML = '<i class="mdi mdi-play"></i><span>Resume</span>';
            pauseBtn.classList.remove('bg-yellow-500/10', 'text-yellow-400', 'hover:bg-yellow-500/20');
            pauseBtn.classList.add('bg-green-500/10', 'text-green-400', 'hover:bg-green-500/20');
        } else {
            pauseBtn.innerHTML = '<i class="mdi mdi-pause"></i><span>Pause</span>';
            pauseBtn.classList.remove('bg-green-500/10', 'text-green-400', 'hover:bg-green-500/20');
            pauseBtn.classList.add('bg-yellow-500/10', 'text-yellow-400', 'hover:bg-yellow-500/20');
            
            this.logBuffer.forEach(log => this.appendLog(log));
            this.logBuffer = [];
            this.scrollToBottom();
        }
    }

    clearConsole() {
        Swal.fire({
            title: 'Clear Console?',
            text: 'This will clear all logs from the console view.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#8B5CF6',
            cancelButtonColor: '#374151',
            confirmButtonText: 'Yes, clear it!',
            background: '#13131a',
            color: '#fff'
        }).then((result) => {
            if (result.isConfirmed) {
                this.consoleElement.innerHTML = '';
                this.logBuffer = [];
                this.allLogs = [];
                
                this.appendLog({
                    timestamp: new Date().toISOString(),
                    message: "Console cleared",
                    level: "system",
                    module: "Console"
                });
            }
        });
    }

    shouldDisplayLog(log) {
        const filterValue = document.getElementById('logFilter').value;
        const searchValue = document.getElementById('searchLogs').value.toLowerCase();
        
        const logLevel = String(log.level || '').toLowerCase();
        const logText = `${log.message || ''} ${log.module || ''}`.toLowerCase();
        
        return (filterValue === 'all' || logLevel === filterValue) && 
               (!searchValue || logText.includes(searchValue));
    }

    filterLogs() {
        this.consoleElement.innerHTML = '';
        let matchCount = 0;
        
        this.allLogs.forEach(log => {
            if (this.shouldDisplayLog(log)) {
                const logEntry = this.createLogEntry(log);
                this.consoleElement.appendChild(logEntry);
                matchCount++;
            }
        });

        if (matchCount === 0) {
            this.showNoResults();
        } else if (!this.isPaused) {
            this.scrollToBottom();
        }
    }

    showNoResults() {
        const noResults = document.createElement('div');
        noResults.className = 'p-4 text-center text-gray-500';
        noResults.innerHTML = `
            <div class="flex flex-col items-center justify-center py-8">
                <i class="mdi mdi-file-search-outline text-4xl mb-3"></i>
                <p>No logs found matching your criteria.</p>
                <button class="mt-3 px-3 py-1 bg-violet-500/20 text-violet-400 rounded-lg text-xs hover:bg-violet-500/30 transition-all" 
                        onclick="window.consoleManager.clearFilters()">Clear Filters</button>
            </div>
        `;
        this.consoleElement.appendChild(noResults);
    }

    clearFilters() {
        document.getElementById('logFilter').value = 'all';
        document.getElementById('searchLogs').value = '';
        this.filterLogs();
    }

    handleKeyboardInput(e) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (this.historyIndex > 0) {
                this.historyIndex--;
                this.commandInput.value = this.commandHistory[this.historyIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (this.historyIndex < this.commandHistory.length - 1) {
                this.historyIndex++;
                this.commandInput.value = this.commandHistory[this.historyIndex];
            } else {
                this.historyIndex = this.commandHistory.length;
                this.commandInput.value = '';
            }
        }
    }

    handleGlobalShortcuts(e) {
        if (e.key === 'f' && e.ctrlKey) {
            e.preventDefault();
            document.getElementById('searchLogs').focus();
        }
        if (e.key === 'l' && e.ctrlKey) {
            e.preventDefault();
            this.clearConsole();
        }
        if (e.key === 'Escape') {
            const searchInput = document.getElementById('searchLogs');
            if (document.activeElement === searchInput) {
                searchInput.value = '';
                this.filterLogs();
                this.commandInput.focus();
            }
        }
    }

    handleVisibilityChange() {
        if (document.hidden && this.allLogs.length > this.MAX_LOGS / 2) {
            const logsToKeep = Math.floor(this.MAX_LOGS / 2);
            this.allLogs = this.allLogs.slice(-logsToKeep);
            
            if (!this.isPaused) {
                this.consoleElement.innerHTML = '';
                this.appendLog({
                    timestamp: new Date().toISOString(),
                    message: `Console was pruned while tab was inactive. ${this.allLogs.length} most recent logs retained.`,
                    level: "system",
                    module: "Console"
                });
                this.filterLogs();
            }
        }
    }

    handleDisconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.showStatus('Reconnecting...', 'warning');
            setTimeout(() => this.connectWebSocket(), 1000 * this.reconnectAttempts);
        } else {
            this.appendLog({
                timestamp: new Date().toISOString(),
                message: "Connection lost. Please refresh the page.",
                level: "error",
                module: "Console"
            });
        }
    }

    showStatus(message, type = 'success') {
        const status = document.createElement('div');
        status.className = `fixed bottom-4 right-4 px-3 py-1 rounded-full ${
            type === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
        } text-sm`;
        status.textContent = message;
        document.body.appendChild(status);
        setTimeout(() => status.remove(), 2000);
    }

    debounce(func, wait) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    handleCommand(e) {
        e.preventDefault();
        const command = this.commandInput.value.trim();
        if (!command) return;

        this.commandHistory.push(command);
        this.historyIndex = this.commandHistory.length;

        if (command.toLowerCase() === 'clear') {
            this.clearConsole();
        } else {
            this.ws.send(JSON.stringify({ type: 'executeCommand', command }));
        }

        this.commandInput.value = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.consoleManager = new ConsoleManager();
});
