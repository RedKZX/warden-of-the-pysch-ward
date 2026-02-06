const logs = window.LOGS || [];
let filteredLogs = new Set(logs);
let currentFilter = 'all';
let currentLogId = null;
let ws;
let reconnectTimeout;
let autoScroll = true;
let searchFilters = {
    term: '',
    dateFrom: null,
    dateTo: null,
    categories: new Set()
};
const LOGS_PER_PAGE = 50;
let isLoading = false;
let hasMore = true;
let currentPage = 1;

const WS_URL = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`;
const logItemsContainer = document.getElementById('logs-items');
const emptyLogsElement = document.getElementById('empty-logs');
const logsContainer = document.getElementById('logs-container');
const loadingSpinner = document.getElementById('loading-spinner');
const loadMoreContainer = document.getElementById('load-more-container');
const lastUpdateElement = document.getElementById('last-update');
const logCountBadge = document.getElementById('log-count-badge');
const categoryDisplay = document.getElementById('category-display');
const autoScrollToggle = document.getElementById('autoScrollToggle');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && !isLoading && hasMore) {
            loadMoreLogs();
        }
    });
}, {
    threshold: 0.1
});

document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    setupCategoryCheckboxes();
    updateFilterCounts();
    updateUI();
    setupEventListeners();
    autoScrollToggle.classList.add('active');
    observer.observe(document.getElementById('load-more-btn'));

    requestAnimationFrame(() => {
        const logEntries = logItemsContainer.querySelectorAll('.log-entry');
        emptyLogsElement.style.display = logEntries.length ? 'none' : 'flex';
    });
});

function initializeWebSocket() {
    if (ws) {
        ws.close();
        ws = null;
    }

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('WebSocket connected');
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'getLogs' }));
        }
    };

    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'stats':
                    const { memoryUsage, uptime, ping } = data.data;
                    document.querySelector('.stat-item:first-child .text-violet-400').textContent = memoryUsage;
                    document.querySelector('.stat-item:last-child .text-emerald-400').textContent = uptime;
                    const pingEl = document.getElementById('ping-value');
                    pingEl.textContent = `${ping}ms`;
                    pingEl.className = `font-semibold ${ping < 100 ? 'text-emerald-400' : ping < 300 ? 'text-yellow-400' : 'text-red-400'}`;
                    break;
                case 'newLog':
                    insertNewLog(data.log);
                    break;
                case 'logDeleted':
                    removeLogEntry(data.id);
                    break;
                case 'logsCleared':
                    clearAllLogEntries();
                    break;
                case 'logs':
                    if (Array.isArray(data.logs)) {
                        filteredLogs = [...data.logs];
                        updateFilterCounts();
                        applyFilter(currentFilter);
                        updateUI();
                    }
                    break;
            }
            lastUpdateElement.textContent = 'Updated ' + formatTimeAgo(new Date());
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket disconnected, attempting to reconnect...');
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(initializeWebSocket, 3000);
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function setupEventListeners() {
    const searchInput = document.getElementById('searchLogs');
    const applyFiltersBtn = document.getElementById('applyFilters');
    const advancedSearchBtn = document.getElementById('advancedSearchBtn');
    const advancedSearch = document.getElementById('advancedSearch');

    searchInput.addEventListener('input', debounce(e => {
        searchFilters.term = e.target.value.toLowerCase();
        applySearchFilters();
    }, 300));

    applyFiltersBtn.addEventListener('click', () => {
        const dateFrom = document.getElementById('dateFrom').value;
        const dateTo = document.getElementById('dateTo').value;
        searchFilters.dateFrom = dateFrom ? new Date(dateFrom) : null;
        searchFilters.dateTo = dateTo ? new Date(dateTo) : null;
        searchFilters.categories = new Set(
            Array.from(document.querySelectorAll('#categoryCheckboxes input:checked')).map(input => input.value)
        );
        applySearchFilters();
        advancedSearch.classList.add('hidden');
    });

    advancedSearchBtn.addEventListener('click', () => 
        advancedSearch.classList.toggle('hidden'));

    document.addEventListener('click', (e) => {
        if (!advancedSearch.contains(e.target) && e.target !== advancedSearchBtn) {
            advancedSearch.classList.add('hidden');
        }
    });

    document.getElementById('scrollToTop').addEventListener('click', () => 
        logsContainer.scrollTo({ top: 0, behavior: 'smooth' }));

    autoScrollToggle.addEventListener('click', () => {
        autoScroll = !autoScroll;
        autoScrollToggle.classList.toggle('active');
    });

    const keyHandlers = {
        'f': (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                searchInput.focus();
            }
        },
        'Escape': () => closeLogDetails(),
        'e': (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                exportLogs();
            }
        }
    };

    document.addEventListener('keydown', (e) => keyHandlers[e.key]?.(e));
}

function setupCategoryCheckboxes() {
    const categories = [
        'system', 'command', 'error', 'info', 'warning', 'success',
        'startup', 'event', 'prefix', 'component', 'database',
        'api', 'cache', 'interaction'
    ];

    const container = document.getElementById('categoryCheckboxes');
    container.innerHTML = categories.map(category => `
        <div class="category-check-item">
            <input type="checkbox" id="category-${category}" class="category-checkbox" value="${category}">
            <label for="category-${category}" class="category-label">
                ${category.charAt(0).toUpperCase() + category.slice(1)}
            </label>
        </div>
    `).join('');
}

function updateFilterCounts() {
    const counts = {};
    logs.forEach(log => {
        const category = log.category.toLowerCase();
        counts[category] = (counts[category] || 0) + 1;
    });

    document.getElementById('all-count').textContent = logs.length;
    
    document.querySelectorAll('[id$="-count"]').forEach(el => {
        const category = el.id.replace('-count', '');
        if (category !== 'all') {
            el.textContent = counts[category] || 0;
        }
    });

    logCountBadge.textContent = `${logs.length} Logs`;
}

function filterLogs(type) {
    currentFilter = type;
    categoryDisplay.textContent = type === 'all' ? 'Viewing all logs' : `Viewing ${type} logs`;

    document.querySelectorAll('.category-filter-btn').forEach(btn => {
        btn.classList.toggle('active', 
            type === 'all' ? btn.textContent.includes('All') : 
            btn.dataset.category === type);
    });

    filteredLogs = type === 'all' ? 
        [...logs] : 
        logs.filter(log => log.category.toLowerCase() === type.toLowerCase());
    
    searchFilters = {
        term: '',
        dateFrom: null,
        dateTo: null,
        categories: new Set()
    };
    
    const searchInput = document.getElementById('searchLogs');
    if (searchInput) searchInput.value = '';
    
    updateUI();
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 120) return '1 minute ago';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 7200) return '1 hour ago';
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return date.toLocaleDateString();
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function loadMoreLogs() {
    if (isLoading || !hasMore) return;
    
    isLoading = true;
    loadingSpinner.classList.remove('hidden');
    
    try {
        const response = await fetch(`/logs/page/${currentPage}?filter=${currentFilter}`);
        if (!response.ok) throw new Error('Failed to load logs');
        
        const newLogs = await response.json();
        
        if (newLogs.length < LOGS_PER_PAGE) {
            hasMore = false;
            loadMoreContainer.classList.add('hidden');
        }
        
        if (newLogs.length > 0) {
            const uniqueLogs = newLogs.filter(newLog => 
                !logs.some(existingLog => existingLog.id === newLog.id)
            );
            
            logs.push(...uniqueLogs);
            if (currentFilter === 'all') {
                filteredLogs = Array.isArray(filteredLogs) ? 
                    [...filteredLogs, ...uniqueLogs] : 
                    new Set([...filteredLogs, ...uniqueLogs]);
            } else {
                const filtered = uniqueLogs.filter(log => 
                    log.category.toLowerCase() === currentFilter
                );
                filteredLogs = Array.isArray(filteredLogs) ? 
                    [...filteredLogs, ...filtered] : 
                    new Set([...filteredLogs, ...filtered]);
            }
            
            currentPage++;
            updateFilterCounts();
            updateUI();
        }
    } catch (error) {
        console.error('Error loading more logs:', error);
        showToast('error', 'Failed to load more logs');
    } finally {
        isLoading = false;
        loadingSpinner.classList.add('hidden');
    }
}

function showLogDetails(logId) {
    const log = logs.find(l => l.id === logId);
    if (!log) return;
    
    const modal = document.getElementById('logDetailsModal');
    const category = modal.querySelector('#modalCategory');
    const timestamp = modal.querySelector('#modalTimestamp');
    const message = modal.querySelector('#modalMessage');
    
    category.textContent = log.category;
    category.className = `log-category px-2 py-0.5 text-xs rounded-full font-medium ${window.getCategoryClass(log.category)}`;
    timestamp.textContent = new Date(log.timestamp).toLocaleString();
    message.textContent = log.message;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    currentLogId = logId;
}

function closeLogDetails() {
    const modal = document.getElementById('logDetailsModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    currentLogId = null;
}

async function copyLogDetails() {
    const message = document.getElementById('modalMessage').textContent;
    try {
        await navigator.clipboard.writeText(message);
        showToast('success', 'Log copied to clipboard');
    } catch (error) {
        showToast('error', 'Failed to copy to clipboard');
    }
}

async function deleteLog(event, button) {
    event.stopPropagation();
    const logEntry = button.closest('.log-entry');
    const logId = logEntry.dataset.id;
    
    const result = await confirmAction('Delete Log?', 'This action cannot be undone.');
    if (result.isConfirmed) {
        try {
            const response = await fetch('/logs/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: logId })
            });
            
            if (!response.ok) throw new Error('Failed to delete log');
            
            removeLogEntry(logId);
            showToast('success', 'Log deleted successfully');
        } catch (error) {
            showToast('error', 'Failed to delete log');
        }
    }
}

async function deleteLogFromModal() {
    if (!currentLogId) return;
    const result = await confirmAction('Delete Log?', 'This action cannot be undone.');
    if (result.isConfirmed) {
        try {
            const response = await fetch('/logs/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: currentLogId })
            });
            
            if (!response.ok) throw new Error('Failed to delete log');
            
            removeLogEntry(currentLogId);
            closeLogDetails();
            showToast('success', 'Log deleted successfully');
        } catch (error) {
            showToast('error', 'Failed to delete log');
        }
    }
}

async function clearAllLogs() {
    const result = await confirmAction('Clear All Logs?', 'This will permanently delete all logs. This action cannot be undone.');
    if (result.isConfirmed) {
        try {
            const response = await fetch('/logs/clear', { method: 'POST' });
            if (!response.ok) throw new Error('Failed to clear logs');
            
            logs.length = 0;
            updateUI();
            updateFilterCounts();
            showToast('success', 'All logs cleared successfully');
        } catch (error) {
            showToast('error', 'Failed to clear logs');
        }
    }
}

function exportLogs() {
    const logsToExport = currentFilter === 'all' ? 
        logs : 
        logs.filter(log => log.category.toLowerCase() === currentFilter);
    
    const logText = logsToExport
        .map(log => `[${new Date(log.timestamp).toLocaleString()}] [${log.category}] ${log.message}`)
        .join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    a.href = url;
    a.download = `synapse-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('success', 'Logs exported successfully');
}

function showToast(icon, title) {
    Swal.fire({
        toast: true,
        position: 'top-end',
        icon,
        title,
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: '#1a1b23',
        color: '#fff'
    });
}

function confirmAction(title, text) {
    return Swal.fire({
        title,
        text,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Confirm',
        cancelButtonText: 'Cancel',
        background: '#1a1b23',
        color: '#fff',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#374151'
    });
}

function applyFilter(type) {
    filteredLogs = logs.filter(log => 
        type === 'all' || log.category.toLowerCase() === type
    );
    currentPage = 1;
    hasMore = true;
    loadMoreContainer.classList.remove('hidden');
    updateUI();
}

function applySearchFilters() {
    const { term, dateFrom, dateTo, categories } = searchFilters;
    
    let filtered = currentFilter === 'all' ? 
        [...logs] : 
        logs.filter(log => log.category.toLowerCase() === currentFilter.toLowerCase());
    
    filtered = filtered.filter(log => {
        const matchesTerm = !term || 
            log.message.toLowerCase().includes(term) || 
            log.category.toLowerCase().includes(term);
        const matchesDate = (!dateFrom || new Date(log.timestamp) >= dateFrom) &&
            (!dateTo || new Date(log.timestamp) <= dateTo);
        const matchesCategory = !categories.size || 
            categories.has(log.category.toLowerCase());
        
        return matchesTerm && matchesDate && matchesCategory;
    });
    
    filteredLogs = filtered;
    updateUI();
}

function updateUI() {
    const container = document.getElementById('logs-container');
    const logItems = document.getElementById('logs-items');
    const emptyLogs = document.getElementById('empty-logs');
    
    const logsToDisplay = Array.isArray(filteredLogs) ? filteredLogs : Array.from(filteredLogs);

    if (logsToDisplay.length === 0) {
        emptyLogs.style.display = 'flex';
        logItems.innerHTML = '';
        return;
    }

    emptyLogs.style.display = 'none';
    logItems.innerHTML = '';

    logsToDisplay.forEach(log => {
        if (!log || !log.id || !log.message || !log.category) return;
        
        const entry = document.createElement('div');
        entry.className = 'log-entry glass-morphism rounded-lg p-3 hover:border-blue-500/30 transition-all flex flex-col';
        entry.dataset.category = log.category.toLowerCase();
        entry.dataset.id = log.id;
        entry.dataset.timestamp = log.timestamp;
        entry.onclick = () => showLogDetails(log.id);

        entry.innerHTML = `
            <div class="flex justify-between items-start">
                <div class="flex items-center space-x-3">
                    <span class="log-category px-2 py-0.5 text-xs rounded-full font-medium ${window.getCategoryClass(log.category)}">
                        ${log.category}
                    </span>
                    <span class="log-timestamp text-xs text-gray-400">
                        ${new Date(log.timestamp).toLocaleString()}
                    </span>
                </div>
                <button onclick="deleteLog(event, this)" class="text-gray-400 hover:text-red-400 transition-colors h-5 w-5 flex items-center justify-center">
                    <i class="mdi mdi-close text-lg"></i>
                </button>
            </div>
            <p class="log-message mt-1 text-gray-200 text-sm line-clamp-1">
                ${log.message}
            </p>
        `;

        logItems.appendChild(entry);
    });
}

function insertNewLog(log) {
    if (!log || !log.id || !log.category || !log.message) return;

    const existingIndex = logs.findIndex(l => l.id === log.id);
    if (existingIndex !== -1) {
        logs[existingIndex] = log;
    } else {
        logs.unshift(log);
    }

    updateFilterCounts();
    
    if (currentFilter === 'all' || log.category.toLowerCase() === currentFilter) {
        if (Array.isArray(filteredLogs)) {
            filteredLogs.unshift(log);
        } else {
            filteredLogs = [log, ...Array.from(filteredLogs)];
        }
        updateUI();
    }
}

function removeLogEntry(id) {
    const index = logs.findIndex(log => log.id === id);
    if (index !== -1) {
        logs.splice(index, 1);
        
        if (Array.isArray(filteredLogs)) {
            const filteredIndex = filteredLogs.findIndex(log => log.id === id);
            if (filteredIndex !== -1) {
                filteredLogs.splice(filteredIndex, 1);
            }
        } else {
            filteredLogs = new Set([...filteredLogs].filter(log => log.id !== id));
        }
        
        updateFilterCounts();
        updateUI();
    }
}

function clearAllLogEntries() {
    logs.length = 0;
    filteredLogs = Array.isArray(filteredLogs) ? [] : new Set();
    updateFilterCounts();
    updateUI();
}


window.showLogDetails = showLogDetails;
window.closeLogDetails = closeLogDetails;
window.copyLogDetails = copyLogDetails;
window.deleteLogFromModal = deleteLogFromModal;
window.deleteLog = deleteLog;
window.clearAllLogs = clearAllLogs;
window.exportLogs = exportLogs;
window.confirmShutdown = confirmShutdown;
window.toggleSidebar = toggleSidebar;
window.filterLogs = filterLogs;
