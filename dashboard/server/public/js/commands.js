let currentFilter = 'all';
let searchTimeout;

function filterCommands(category) {
    currentFilter = category;
    const commands = document.querySelectorAll('.command-card');
    const buttons = document.querySelectorAll('.filter-button');
    const searchTerm = document.getElementById('searchCommands').value.toLowerCase();

    buttons.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[onclick="filterCommands('${category}')"]`).classList.add('active');

    commands.forEach(cmd => {
        const matches = (category === 'all' || cmd.dataset.category === category) 
            && cmd.dataset.name.toLowerCase().includes(searchTerm);
        cmd.style.display = matches ? 'block' : 'none';
        cmd.style.opacity = matches ? '1' : '0.4';
        cmd.style.transform = matches ? 'translateY(0)' : 'translateY(10px)';
    });
}

function updateStatistics() {
    const commands = document.querySelectorAll('.command-card');
    const activeCommands = document.querySelectorAll('.command-card:not(.disabled)').length;
    const disabledCommands = commands.length - activeCommands;
    const categories = new Set(Array.from(commands).map(cmd => cmd.dataset.category));

    document.getElementById('active-commands-count').textContent = activeCommands;
    document.getElementById('disabled-commands-count').textContent = disabledCommands;
    document.getElementById('category-count').textContent = categories.size;
}

async function toggleCommandState(button, name) {
    const card = button.closest('.command-card');
    const isEnabled = button.classList.contains('enabled');
    const originalContent = button.innerHTML;
    const commandPath = card.dataset.path;

    try {
        button.disabled = true;
        button.innerHTML = `<i class="mdi mdi-loading loading-spinner"></i>`;

        const response = await fetch(`/api/commands/${encodeURIComponent(commandPath)}/${isEnabled ? 'unload' : 'reload'}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to toggle command state');
        }

        updateCommandState(name, !isEnabled);
        updateStatistics();

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `Command /${name} ${isEnabled ? 'disabled' : 'enabled'}`,
            showConfirmButton: false,
            timer: 2000,
            background: '#1a1b23',
            color: '#fff'
        });

    } catch (error) {
        console.error(error);
        button.innerHTML = originalContent;
        
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'error',
            title: error.message,
            showConfirmButton: false,
            timer: 3000,
            background: '#1a1b23',
            color: '#fff'
        });
    } finally {
        button.disabled = false;
    }
}

function updateCommandState(name, isEnabled) {
    const card = document.querySelector(`.command-card[data-name="${name}"]`);
    const toggleBtn = card.querySelector('.toggle-btn');

    card.classList.toggle('disabled', !isEnabled);
    card.classList.toggle('enabled', isEnabled);

    toggleBtn.classList.toggle('enabled', isEnabled);
    toggleBtn.classList.toggle('disabled', !isEnabled);
    toggleBtn.innerHTML = `<i class="mdi mdi-power"></i><span>${isEnabled ? 'Disable' : 'Enable'}</span>`;
}

function showCommandDetails(name) {
    const card = document.querySelector(`.command-card[data-name="${name}"]`);
    if (!card) return;

    const modal = document.getElementById('commandDetailsModal');
    const modalTitle = document.getElementById('modalCommandName');
    const modalContent = document.getElementById('modalContent');

    modalTitle.textContent = `/${name}`;

    const description = card.querySelector('p.text-sm.text-gray-400').textContent.trim();
    const category = card.dataset.category;
    const cooldown = card.querySelector('.cooldown').textContent;
    const permission = card.querySelector('.permission').textContent;
    const path = card.querySelector('.path').textContent;
    const guildOnly = card.querySelector('.bg-blue-500\\/10') !== null;
    const ownerOnly = card.querySelector('.bg-purple-500\\/10') !== null;

    modalContent.innerHTML = `
        <div class="bg-[#0f0f13] p-4 rounded-lg border border-violet-500/10">
            <h4 class="text-lg font-medium text-gray-200 mb-2">Command Description</h4>
            <p class="text-gray-400">${description}</p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div class="bg-[#0f0f13] p-4 rounded-lg border border-violet-500/10">
                <h4 class="text-lg font-medium text-gray-200 mb-2">Details</h4>
                <ul class="space-y-2">
                    <li class="flex items-center gap-2">
                        <span class="text-violet-400"><i class="mdi mdi-tag"></i></span>
                        <span class="text-gray-400">Category: <span class="text-gray-200">${category}</span></span>
                    </li>
                    <li class="flex items-center gap-2">
                        <span class="text-violet-400"><i class="mdi mdi-clock-outline"></i></span>
                        <span class="text-gray-400">${cooldown}</span>
                    </li>
                    <li class="flex items-center gap-2">
                        <span class="text-violet-400"><i class="mdi mdi-shield-check"></i></span>
                        <span class="text-gray-400">${permission}</span>
                    </li>
                </ul>
            </div>
            <div class="bg-[#0f0f13] p-4 rounded-lg border border-violet-500/10">
                <h4 class="text-lg font-medium text-gray-200 mb-2">Flags</h4>
                <div class="flex flex-wrap gap-2">
                    ${guildOnly ? `
                        <span class="px-2 py-1 text-xs rounded-full bg-blue-500/10 text-blue-400">
                            <i class="mdi mdi-server mr-1"></i>Server Only
                        </span>` : ''}
                    ${ownerOnly ? `
                        <span class="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-400">
                            <i class="mdi mdi-crown mr-1"></i>Owner Only
                        </span>` : ''}
                    ${!guildOnly && !ownerOnly ? `
                        <span class="px-2 py-1 text-xs rounded-full bg-gray-500/10 text-gray-400">
                            <i class="mdi mdi-check-circle-outline mr-1"></i>No Restrictions
                        </span>` : ''}
                </div>
            </div>
        </div>
        <div class="bg-[#0f0f13] p-4 rounded-lg border border-violet-500/10 mt-4">
            <h4 class="text-lg font-medium text-gray-200 mb-2">Command Path</h4>
            <code class="block bg-[#080810] p-3 rounded-md text-gray-300 overflow-x-auto">${path.replace('Path: ', '')}</code>
        </div>
        <div class="flex justify-end gap-3 mt-4">
            <button onclick="refreshCommand('${name}', true)" class="modal-btn reload-btn" id="reloadBtn-${name}">
                <i class="mdi mdi-refresh"></i>
                <span>Reload Command</span>
            </button>
            <button onclick="showCommandSettings('${name}')" class="modal-btn settings-btn">
                <i class="mdi mdi-cog"></i>
            </button>
            <button onclick="closeCommandDetails()" class="modal-btn cancel-btn">
                <i class="mdi mdi-close"></i>
                <span>Close</span>
            </button>
        </div>
    `;

    modal.classList.remove('hidden');
}

function closeCommandDetails() {
    document.getElementById('commandDetailsModal').classList.add('hidden');
}

async function refreshCommand(name, fromModal = false) {
    const card = document.querySelector(`.command-card[data-name="${name}"]`);
    const reloadBtn = fromModal ?
        document.getElementById(`reloadBtn-${name}`) :
        card.querySelector('.reload-btn');
    const originalContent = reloadBtn.innerHTML;
    const commandPath = card.dataset.path;

    try {
        reloadBtn.disabled = true;
        reloadBtn.innerHTML = `<i class="mdi mdi-loading loading-spinner"></i>`;

        const response = await fetch(`/api/commands/${encodeURIComponent(commandPath)}/reload`, {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to reload command');
        }

        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: `Command /${name} reloaded successfully`,
            showConfirmButton: false,
            timer: 2000,
            background: '#1a1b23',
            color: '#fff',
            customClass: { popup: 'modern-toast' }
        });

        if (fromModal) closeCommandDetails();

    } catch (error) {
        console.error(error);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'error',
            title: error.message || 'Failed to reload command',
            showConfirmButton: false,
            timer: 3000,
            background: '#1a1b23',
            color: '#fff',
            customClass: { popup: 'modern-toast' }
        });
    } finally {
        reloadBtn.disabled = false;
        reloadBtn.innerHTML = originalContent;
    }
}

async function showCommandSettings(name) {
    const card = document.querySelector(`.command-card[data-name="${name}"]`);
    if (!card) return;

    const command = {
        name: name,
        cooldown: parseInt(card.querySelector('.cooldown').textContent.match(/\d+/) || 0),
        permission: card.querySelector('.permission').textContent.replace('Permission: ', '').trim(),
        path: card.querySelector('.path').textContent.replace('Path: ', '').trim(),
        category: card.dataset.category,
        guildOnly: card.querySelector('.bg-blue-500\\/10') !== null,
        ownerOnly: card.querySelector('.bg-purple-500\\/10') !== null
    };

    const result = await Swal.fire({
        title: `/${name} Settings`,
        html: `
            <div class="text-left space-y-4">
                <div class="form-group">
                    <label class="text-gray-400 text-sm">Cooldown (seconds)</label>
                    <input type="number" id="cooldown" value="${command.cooldown}" min="0" 
                           class="settings-input w-full">
                </div>
                <div class="form-group">
                    <label class="text-gray-400 text-sm">Required Permission</label>
                    <select id="permission" class="settings-input w-full">
                        <option value="">None</option>
                        <option value="ADMINISTRATOR" ${command.permission === 'ADMINISTRATOR' ? 'selected' : ''}>Administrator</option>
                        <option value="MANAGE_GUILD" ${command.permission === 'MANAGE_GUILD' ? 'selected' : ''}>Manage Server</option>
                        <option value="MANAGE_MESSAGES" ${command.permission === 'MANAGE_MESSAGES' ? 'selected' : ''}>Manage Messages</option>
                        <option value="MODERATE_MEMBERS" ${command.permission === 'MODERATE_MEMBERS' ? 'selected' : ''}>Moderate Members</option>
                        <option value="BAN_MEMBERS" ${command.permission === 'BAN_MEMBERS' ? 'selected' : ''}>Ban Members</option>
                        <option value="KICK_MEMBERS" ${command.permission === 'KICK_MEMBERS' ? 'selected' : ''}>Kick Members</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="text-gray-400 text-sm mb-2 block">Command Flags</label>
                    <div class="space-y-2">
                        <label class="flex items-center">
                            <input type="checkbox" id="guildOnly" ${command.guildOnly ? 'checked' : ''} 
                                   class="form-checkbox">
                            <span class="ml-2 text-sm text-gray-300">Server Only</span>
                        </label>
                        <label class="flex items-center">
                            <input type="checkbox" id="ownerOnly" ${command.ownerOnly ? 'checked' : ''} 
                                   class="form-checkbox">
                            <span class="ml-2 text-sm text-gray-300">Owner Only</span>
                        </label>
                    </div>
                </div>
            </div>`,
        background: '#1a1b23',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Save Changes',
        customClass: {
            popup: 'modern-swal-popup',
            title: 'modern-swal-title',
            htmlContainer: 'modern-swal-content',
            confirmButton: 'modern-swal-confirm',
            cancelButton: 'modern-swal-cancel'
        },
        preConfirm: () => ({
            cooldown: parseInt(document.getElementById('cooldown').value) || 0,
            permission: document.getElementById('permission').value,
            guildOnly: document.getElementById('guildOnly').checked,
            ownerOnly: document.getElementById('ownerOnly').checked
        })
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`/api/commands/${encodeURIComponent(name)}/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(result.value)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to update command settings');
            }

            card.querySelector('.cooldown').textContent = `Cooldown: ${result.value.cooldown}s`;
            card.querySelector('.permission').textContent = `Permission: ${result.value.permission || 'None'}`;

            const flagsContainer = card.querySelector('.flex.flex-wrap.gap-2');
            flagsContainer.innerHTML = '';

            if (result.value.guildOnly) {
                flagsContainer.innerHTML += `
                    <span class="px-2 py-1 text-xs rounded-full bg-blue-500/10 text-blue-400">
                        <i class="mdi mdi-server mr-1"></i>Server Only
                    </span>`;
            }

            if (result.value.ownerOnly) {
                flagsContainer.innerHTML += `
                    <span class="px-2 py-1 text-xs rounded-full bg-purple-500/10 text-purple-400">
                        <i class="mdi mdi-crown mr-1"></i>Owner Only
                    </span>`;
            }

            flagsContainer.innerHTML += `
                <span class="px-2 py-1 text-xs rounded-full bg-gray-500/10 text-gray-400">
                    <i class="mdi mdi-calendar-check mr-1"></i>Updated ${new Date().toLocaleDateString()}
                </span>`;

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: `Settings updated for /${name}`,
                showConfirmButton: false,
                timer: 2000,
                customClass: { popup: 'modern-toast' }
            });
        } catch (error) {
            console.error('Error updating command settings:', error);
            Swal.fire({
                title: 'Error',
                text: error.message,
                icon: 'error',
                background: '#1a1b23',
                color: '#fff',
                customClass: { popup: 'modern-swal-popup' }
            });
        }
    }
}

async function refreshAllCommands() {
    const btn = document.getElementById('refreshAllCommands');
    const originalContent = btn.innerHTML;

    try {
        btn.disabled = true;
        btn.innerHTML = `<i class="mdi mdi-loading loading-spinner"></i><span>Refreshing...</span>`;

        const response = await fetch('/api/commands/refresh', {
            method: 'POST'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to refresh commands');
        }

        Swal.fire({
            title: 'Commands Refreshed',
            text: 'All commands have been refreshed successfully',
            icon: 'success',
            background: '#1a1b23',
            color: '#fff',
            customClass: { popup: 'modern-swal-popup' },
            showConfirmButton: false,
            timer: 2000
        });

        setTimeout(() => window.location.reload(), 1500);

    } catch (error) {
        console.error(error);
        Swal.fire({
            title: 'Error',
            text: error.message || 'Failed to refresh commands',
            icon: 'error',
            background: '#1a1b23',
            color: '#fff',
            customClass: { popup: 'modern-swal-popup' }
        });
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

function confirmShutdown() {
    Swal.fire({
        title: 'Are you sure?',
        text: 'This will completely shut down the bot',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Yes, shut down',
        background: '#1a1b23',
        color: '#fff',
        customClass: {
            popup: 'modern-swal-popup',
            confirmButton: 'modern-swal-confirm',
            cancelButton: 'modern-swal-cancel'
        }
    }).then((result) => {
        if (result.isConfirmed) {
            fetch('/api/bot/shutdown', { method: 'POST' })
            .then(response => {
                if (response.ok) {
                    Swal.fire({
                        title: 'Shutting down',
                        text: 'The bot is shutting down...',
                        icon: 'success',
                        background: '#1a1b23',
                        color: '#fff',
                        customClass: { popup: 'modern-swal-popup' },
                        showConfirmButton: false
                    });
                }
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updateStatistics();
    document.getElementById('searchCommands').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => filterCommands(currentFilter), 200);
    });
    document.getElementById('refreshAllCommands').addEventListener('click', refreshAllCommands);
});

window.filterCommands = filterCommands;
window.toggleCommandState = toggleCommandState;
window.showCommandDetails = showCommandDetails;
window.closeCommandDetails = closeCommandDetails;
window.refreshCommand = refreshCommand;
window.showCommandSettings = showCommandSettings;
window.refreshAllCommands = refreshAllCommands;
window.confirmShutdown = confirmShutdown;
