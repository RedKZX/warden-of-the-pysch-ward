/**
 * Warden Dashboard - Settings Page JavaScript
 */

let settingsState = {};
let userLists = {
    owners: [],
    devs: [],
    trusted: []
};

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    setupTabs();
    setupUserRoleTabs();
    loadSettings();
    loadUserLists();
    setupEventListeners();

    $$('.toggle-switch input[type="checkbox"]').forEach(toggle => {
        if (toggle) {
            updateToggleVisual(toggle);
        }
    });

    $$('.settings-card').forEach((card, index) => {
        if (card) {
            card.style.animation = `cardEntrance 0.5s ease forwards ${index * 0.1}s`;
            card.style.opacity = '0';
        }
    });
}

function setupTabs() {
    const tabButtons = $$('.tab-button');
    const tabContents = $$('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.getAttribute('data-tab');

            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            tabContents.forEach(content => {
                if (content.id === `${tabName}-tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });
}

function setupUserRoleTabs() {
    const roleTabs = $$('.user-role-tab');
    const roleDescriptions = $$('.role-description');
    const userPanels = $$('.user-list-panel');

    roleTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const role = tab.getAttribute('data-role');

            roleTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            roleDescriptions.forEach(desc => {
                if (desc.id === `${role}-description`) {
                    desc.classList.add('active');
                } else {
                    desc.classList.remove('active');
                }
            });

            userPanels.forEach(panel => {
                if (panel.id === `${role}-panel`) {
                    panel.classList.add('active');
                } else {
                    panel.classList.remove('active');
                }
            });
        });
    });
}

function setupEventListeners() {
    $$('.toggle-switch input[type="checkbox"]').forEach(toggle => {
        toggle.addEventListener('change', () => updateToggleVisual(toggle));
    });
    
    $('#saveSettings')?.addEventListener('click', saveSettings);
    
    $('#backupNowBtn')?.addEventListener('click', performBackupNow);
    
    $('#addOwnerBtn')?.addEventListener('click', () => openModal('owner'));
    $('#addDevBtn')?.addEventListener('click', () => openModal('dev'));
    $('#addTrustedBtn')?.addEventListener('click', () => openModal('trusted'));
    
    $('#closeModal')?.addEventListener('click', closeModal);
    $('#cancelModalBtn')?.addEventListener('click', closeModal);
    $('#confirmModalBtn')?.addEventListener('click', confirmAddUser);
    
    $('#userModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'userModal') {
            closeModal();
        }
    });

    $('#twoFactorCode')?.addEventListener('input', function() {
        validateTwoFactorCode(this);
    });

    const shutdownBtn = $('.shutdown-button');
    if (shutdownBtn) {
        shutdownBtn.addEventListener('click', confirmShutdown);
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/dashboard-settings');
        if (!response.ok) throw new Error('Failed to fetch settings');

        settingsState = await response.json();

        for (const [key, value] of Object.entries(settingsState)) {
            const element = document.getElementById(key);
            if (element) {
                if (element.type === 'checkbox') {
                    element.checked = value;
                    updateToggleVisual(element);
                } else {
                    element.value = value;
                }
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('error', 'Failed to load settings');
    }
}

async function saveSettings() {
    try {
        const twoFactorEnabled = $('#twoFactorAuthEnabled')?.checked || false;
        const twoFactorCode = $('#twoFactorCode')?.value || '';
        const emergencyCode = $('#emergencyShutdownCode')?.value || '';

        if (twoFactorEnabled && $('#twoFactorCode') && 
            !validateTwoFactorCode($('#twoFactorCode'))) {
            showToast('error', 'Invalid 2FA code format');
            return;
        }

        let emergencyHash = '';
        if (emergencyCode) {
            const response = await fetch('/api/hash', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: emergencyCode })
            });
            const data = await response.json();
            if (!data.success) throw new Error('Failed to hash emergency code');
            emergencyHash = data.hash;
        }

        const settings = {
            hotReloadEnabled: $('#hotReloadEnabled')?.checked || false,
            webDashboardEnabled: $('#webDashboardEnabled')?.checked || false,
            commandLogsEnabled: $('#commandLogsEnabled')?.checked || false,
            databaseEnabled: $('#databaseEnabled')?.checked || false,
            maintenanceModeEnabled: $('#maintenanceModeEnabled')?.checked || false,
            commandRateLimit: parseInt($('#commandRateLimit')?.value || '60'),
            globalCommandCooldown: parseInt($('#globalCommandCooldown')?.value || '3'),
            autoRecoveryAttempts: parseInt($('#autoRecoveryAttempts')?.value || '3'),
            customStatusText: $('#customStatusText')?.value || '',
            customStatusType: $('#customStatusType')?.value || 'PLAYING',
            customStatusState: $('#customStatusState')?.value || 'online',
            dmResponseText: $('#dmResponseText')?.value || '',
            emergencyShutdownCode: emergencyCode ? emergencyHash : '',
            twoFactorAuthEnabled: twoFactorEnabled,
            twoFactorCode: twoFactorCode,
            databaseBackupInterval: parseInt($('#databaseBackupInterval')?.value || '24'),
            backupRetention: parseInt($('#backupRetention')?.value || '7')
        };

        const response = await fetch('/api/dashboard-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.details || 'Failed to save settings');
        }

        settingsState = settings;
        
        showSaveAnimation();
        setTimeout(() => showToast('success', 'Settings saved successfully'), 300);
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('error', error.message);
    }
}

async function loadUserLists() {
    try {
        const response = await fetch('/api/users');
        if (!response.ok) throw new Error('Failed to fetch user lists');

        const data = await response.json();
        userLists = {
            owners: data.owners || [],
            devs: data.devs || [],
            trusted: data.trusted || []
        };

        updateUserChips('owner', userLists.owners);
        updateUserChips('dev', userLists.devs);
        updateUserChips('trusted', userLists.trusted);
    } catch (error) {
        console.error('Error loading user lists:', error);
        showToast('error', 'Failed to load user lists');
    }
}

function updateUserChips(role, users) {
    const container = $(`#${role}Chips`);
    if (!container) return;

    container.innerHTML = '';

    users.forEach(user => {
        const chip = document.createElement('div');
        chip.className = 'user-chip';
        chip.innerHTML = `
            <img src="https://cdn.discordapp.com/avatars/${user.id}/${user.avatar || 'default'}.png" 
                 onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'"
                 alt="${user.username || 'User'}">
            <span>${user.username || user.id}</span>
            <button onclick="removeUser('${user.id}', '${role}')" title="Remove user">
                <i class="mdi mdi-close"></i>
            </button>
        `;
        container.appendChild(chip);
    });
}

async function removeUser(userId, role) {
    const userType = role === 'owner' ? 'owner' : role === 'dev' ? 'dev' : 'trusted';
    
    Swal.fire({
        title: 'Confirm Removal',
        text: 'Are you sure you want to remove this user?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7c3aed',
        cancelButtonColor: '#374151',
        confirmButtonText: 'Yes, remove',
        background: '#1a1b23',
        color: '#fff',
        borderRadius: '1rem'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const response = await fetch(`/api/users/${userType}/${userId}`, {
                    method: 'DELETE'
                });

                const data = await response.json();

                if (data.success) {
                    await loadUserLists();
                    showToast('success', 'User removed successfully');
                } else {
                    showToast('error', data.message || 'Failed to remove user');
                }
            } catch (error) {
                console.error('Error removing user:', error);
                showToast('error', 'An error occurred while removing the user');
            }
        }
    });
}

function openModal(type) {
    const modal = $('#userModal');
    const modalTitle = $('#modalTitle');

    if (modal) {
        modal.classList.add('active');

        if (modalTitle) {
            const titles = {
                'owner': 'Add New Owner',
                'dev': 'Add New Developer', 
                'trusted': 'Add New Trusted User'
            };
            modalTitle.textContent = titles[type] || 'Add New User';
        }

        $('#userIdInput').value = '';

        modal.setAttribute('data-type', type);
    }
}

function closeModal() {
    const modal = $('#userModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

async function confirmAddUser() {
    const modal = $('#userModal');
    const userIdInput = $('#userIdInput');

    if (!userIdInput || !modal) return;

    const userId = userIdInput.value.trim();
    const type = modal.getAttribute('data-type');

    if (!userId || !/^\d{17,19}$/.test(userId)) {
        showToast('error', 'Please enter a valid Discord User ID');
        return;
    }

    try {
        const response = await fetch(`/api/users/${type}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });

        const data = await response.json();

        if (data.success) {
            closeModal();
            showToast('success', `User added successfully`);
            await loadUserLists();
        } else {
            showToast('error', data.message || 'Failed to add user');
        }
    } catch (error) {
        console.error('Error adding user:', error);
        showToast('error', 'An error occurred while adding the user');
    }
}

function validateTwoFactorCode(input) {
    if (!input) return false;
    
    const errorElement = $('#twoFactorError');
    const value = input.value;

    if (value && !/^\d{6}$/.test(value)) {
        if (errorElement) {
            errorElement.textContent = 'Code must be exactly 6 digits';
            errorElement.classList.remove('hidden');
        }
        input.classList.add('error');
        return false;
    } else {
        if (errorElement) {
            errorElement.classList.add('hidden');
        }
        input.classList.remove('error');
        return true;
    }
}

async function performBackupNow() {
    try {
        const backupBtn = $('#backupNowBtn');
        if (!backupBtn || backupBtn.disabled) return;

        const originalHtml = backupBtn.innerHTML;
        backupBtn.disabled = true;
        backupBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i><span>Creating backup...</span>';

        const response = await fetch('/api/database/backup', {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', `Backup created successfully: ${result.file}`);
        } else {
            throw new Error(result.message || 'Failed to create backup');
        }
    } catch (error) {
        console.error('Error creating backup:', error);
        showToast('error', error.message || 'An error occurred during backup');
    } finally {
        const backupBtn = $('#backupNowBtn');
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.innerHTML = '<i class="mdi mdi-database-export"></i><span>Backup Now</span>';
        }
    }
}

function updateToggleVisual(toggleInput) {
    if (!toggleInput) return;
    
    const toggleItem = toggleInput.closest('.toggle-item');
    if (toggleItem) {
        if (toggleInput.checked) {
            toggleItem.classList.add('toggle-enabled');
            toggleItem.style.borderColor = 'rgba(124, 58, 237, 0.4)';
            toggleItem.style.boxShadow = '0 8px 20px rgba(124, 58, 237, 0.2)';
            toggleItem.setAttribute('data-enabled', 'true');
        } else {
            toggleItem.classList.remove('toggle-enabled');
            toggleItem.style.borderColor = 'rgba(124, 58, 237, 0.1)';
            toggleItem.style.boxShadow = 'none';
            toggleItem.setAttribute('data-enabled', 'false');
        }

        const toggleHandlers = {
            'webDashboardEnabled': () => {
                const warningElement = $('#dashboardWarning');
                if (warningElement) {
                    warningElement.style.display = toggleInput.checked ? 'none' : 'flex';
                }
            },
            'twoFactorAuthEnabled': () => {
                const authInput = $('#twoFactorAuthInput');
                if (authInput) {
                    authInput.style.display = toggleInput.checked ? 'block' : 'none';
                }
            },
            'ipRestrictionEnabled': () => {
                const ipInput = $('#ipRestrictionInput');
                if (ipInput) {
                    ipInput.style.display = toggleInput.checked ? 'block' : 'none';
                }
            }
        };

        if (toggleHandlers[toggleInput.id]) {
            toggleHandlers[toggleInput.id]();
        }
    }
}

function showSaveAnimation() {
    const saveBtn = $('#saveSettings');
    if (saveBtn) {
        saveBtn.classList.add('pulse-animation');

        setTimeout(() => {
            saveBtn.classList.remove('pulse-animation');
            
            $$('.toggle-item').forEach(item => {
                if (item.querySelector('input').checked) {
                    item.classList.add('highlighted');
                    setTimeout(() => item.classList.remove('highlighted'), 1000);
                }
            });
        }, 1000);
    }
}

function showToast(type, message) {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: type,
    title: message,
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    background: '#1a1b23',
    color: '#fff',
    customClass: {
      popup: 'dark-toast',
      title: 'dark-toast-title',
      timerProgressBar: 'dark-toast-progress'
    },
    didOpen: (toast) => {
      toast.style.backgroundColor = '#1a1b23';
      toast.style.boxShadow = '0 5px 15px rgba(0, 0, 0, 0.5)';
      
      const allTextElements = toast.querySelectorAll('*');
      allTextElements.forEach(el => {
        if (el.textContent) el.style.color = '#fff';
      });
      
      const titleEl = toast.querySelector('.swal2-title');
      if (titleEl) titleEl.style.color = '#fff';
      
      const progressBar = toast.querySelector('.swal2-timer-progress-bar');
      if (progressBar) {
        progressBar.style.backgroundColor = 
          type === 'success' ? '#10b981' : 
          type === 'error' ? '#ef4444' : 
          type === 'warning' ? '#f59e0b' : '#7c3aed';
      }
      
      toast.addEventListener('mouseenter', Swal.stopTimer);
      toast.addEventListener('mouseleave', Swal.resumeTimer);
    }
  });
}

function confirmShutdown() {
    Swal.fire({
        title: 'Confirm Shutdown',
        text: 'Are you sure you want to shut down the bot?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7c3aed',
        cancelButtonColor: '#374151',
        confirmButtonText: 'Yes, shutdown',
        background: '#1a1b23',
        color: '#fff',
        borderRadius: '1rem',
        showClass: {
            popup: 'animate__animated animate__fadeInDown'
        },
        hideClass: {
            popup: 'animate__animated animate__fadeOutUp'
        }
    }).then((result) => {
        if (result.isConfirmed) {
            shutdownBot();
        }
    });
}

async function shutdownBot() {
    try {
        const response = await fetch('/api/shutdown', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            Swal.fire({
                title: 'Shutting Down',
                text: 'The bot is shutting down. This dashboard will become unavailable.',
                icon: 'info',
                timer: 5000,
                timerProgressBar: true,
                showConfirmButton: false
            }).then(() => {
                window.location.href = '/';
            });
        } else {
            throw new Error(result.message || 'Shutdown failed');
        }
    } catch (error) {
        console.error('Error shutting down:', error);
        showToast('error', 'Failed to shut down the bot');
    }
}

window.removeUser = removeUser;
window.validateTwoFactorCode = validateTwoFactorCode;
window.confirmShutdown = confirmShutdown;

document.addEventListener('DOMContentLoaded', function () {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.add('hidden'));
            
            button.classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.remove('hidden');
        });
    });

    const userRoleTabs = document.querySelectorAll('.user-role-tab');
    const roleDescriptions = document.querySelectorAll('.role-description');
    const userListPanels = document.querySelectorAll('.user-list-panel');

    userRoleTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const role = tab.dataset.role;
            
            userRoleTabs.forEach(t => t.classList.remove('active'));
            roleDescriptions.forEach(desc => desc.classList.remove('active'));
            userListPanels.forEach(panel => panel.classList.remove('active'));
            
            tab.classList.add('active');
            document.getElementById(`${role}-description`).classList.add('active');
            document.getElementById(`${role}-panel`).classList.add('active');
        });
    });

    const toggles = document.querySelectorAll('input[type="checkbox"]');
    toggles.forEach(toggle => {
        toggle.addEventListener('change', function() {
            if (this.id === 'twoFactorAuthEnabled') {
                const inputContainer = document.getElementById('twoFactorAuthInput');
                inputContainer.style.display = this.checked ? 'block' : 'none';
            }
            
            if (this.id === 'webDashboardEnabled') {
                const warning = document.getElementById('dashboardWarning');
                warning.style.display = this.checked ? 'none' : 'flex';
            }
        });
    });

    const saveButton = document.getElementById('saveSettings');
    saveButton.addEventListener('click', saveAllSettings);

    const addOwnerBtn = document.getElementById('addOwnerBtn');
    const addDevBtn = document.getElementById('addDevBtn');
    const addWhitelistBtn = document.getElementById('addWhitelistBtn');
    const addBlacklistBtn = document.getElementById('addBlacklistBtn');
    
    if (addOwnerBtn) addOwnerBtn.addEventListener('click', () => openUserModal('owner'));
    if (addDevBtn) addDevBtn.addEventListener('click', () => openUserModal('dev'));
    if (addWhitelistBtn) addWhitelistBtn.addEventListener('click', () => openUserModal('whitelist'));
    if (addBlacklistBtn) addBlacklistBtn.addEventListener('click', () => openUserModal('blacklist'));
    
    const modal = document.getElementById('userModal');
    const closeModal = document.getElementById('closeModal');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmModalBtn = document.getElementById('confirmModalBtn');
    
    if (closeModal) closeModal.addEventListener('click', closeUserModal);
    if (cancelModalBtn) cancelModalBtn.addEventListener('click', closeUserModal);
    if (confirmModalBtn) confirmModalBtn.addEventListener('click', addUser);
    
    loadSettings();
    loadUserLists();
    
    if (document.getElementById('twoFactorCode')) {
        document.getElementById('twoFactorCode').addEventListener('input', function() {
            validateTwoFactorCode(this);
        });
    }
    
    const backupNowBtn = document.getElementById('backupNowBtn');
    if (backupNowBtn) {
        backupNowBtn.addEventListener('click', createBackup);
    }
});

let currentModalType = null;

async function loadSettings() {
    try {
        const response = await fetch('/api/dashboard-settings');
        const settings = await response.json();
        
        document.getElementById('hotReloadEnabled').checked = settings.hotReloadEnabled;
        document.getElementById('webDashboardEnabled').checked = settings.webDashboardEnabled;
        document.getElementById('commandLogsEnabled').checked = settings.commandLogsEnabled;
        document.getElementById('databaseEnabled').checked = settings.databaseEnabled;
        document.getElementById('maintenanceModeEnabled').checked = settings.maintenanceModeEnabled;
        
        document.getElementById('commandRateLimit').value = settings.commandRateLimit;
        document.getElementById('globalCommandCooldown').value = settings.globalCommandCooldown;
        document.getElementById('autoRecoveryAttempts').value = settings.autoRecoveryAttempts;
        
        document.getElementById('customStatusText').value = settings.customStatusText;
        document.getElementById('customStatusType').value = settings.customStatusType;
        document.getElementById('customStatusState').value = settings.customStatusState;
        document.getElementById('dmResponseText').value = settings.dmResponseText;
        document.getElementById('emergencyShutdownCode').value = settings.emergencyShutdownCode;
        
        const twoFactorToggle = document.getElementById('twoFactorAuthEnabled');
        twoFactorToggle.checked = settings.twoFactorAuthEnabled;
        
        const twoFactorInput = document.getElementById('twoFactorAuthInput');
        if (twoFactorInput) {
            twoFactorInput.style.display = settings.twoFactorAuthEnabled ? 'block' : 'none';
        }
        
        document.getElementById('databaseBackupInterval').value = settings.databaseBackupInterval;
        document.getElementById('backupRetention').value = settings.backupRetention;
        
        const dashboardWarning = document.getElementById('dashboardWarning');
        if (dashboardWarning) {
            dashboardWarning.style.display = settings.webDashboardEnabled ? 'none' : 'flex';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showToast('error', 'Failed to load settings. Please refresh the page.');
    }
}

async function loadUserLists() {
    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        
        populateUserChips('ownerChips', users.owners);
        populateUserChips('devChips', users.devs);
        populateUserChips('whitelistChips', users.whitelist);
        populateUserChips('blacklistChips', users.blacklist);
    } catch (error) {
        console.error('Error loading user lists:', error);
        showToast('error', 'Failed to load user lists. Please refresh the page.');
    }
}

function populateUserChips(containerId, users) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!users || users.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'text-gray-400 italic text-center py-4';
        emptyMessage.textContent = 'No users added';
        container.appendChild(emptyMessage);
        return;
    }
    
    users.forEach(user => {
        const chip = document.createElement('div');
        chip.className = 'user-chip';
        
        const userType = containerId.replace('Chips', '');
        
        chip.innerHTML = `
            <span>${user.username}</span>
            <span class="user-id">${user.id}</span>
            <button class="remove-user-btn" data-id="${user.id}" data-type="${userType}">
                <i class="mdi mdi-close"></i>
            </button>
        `;
        
        container.appendChild(chip);
        
        const removeBtn = chip.querySelector('.remove-user-btn');
        removeBtn.addEventListener('click', () => removeUser(user.id, userType));
    });
}

function openUserModal(type) {
    currentModalType = type;
    const modal = document.getElementById('userModal');
    const title = document.getElementById('modalTitle');
    
    switch(type) {
        case 'owner':
            title.textContent = 'Add Bot Owner';
            break;
        case 'dev':
            title.textContent = 'Add Developer';
            break;
        case 'whitelist':
            title.textContent = 'Add to Whitelist';
            break;
        case 'blacklist':
            title.textContent = 'Add to Blacklist';
            break;
    }
    
    document.getElementById('userIdInput').value = '';
    
    modal.classList.add('active');
}

function closeUserModal() {
    const modal = document.getElementById('userModal');
    modal.classList.remove('active');
    currentModalType = null;
}

async function addUser() {
    const userId = document.getElementById('userIdInput').value.trim();
    
    if (!userId || !/^\d{17,19}$/.test(userId)) {
        showToast('error', 'Please enter a valid Discord User ID');
        return;
    }
    
    try {
        const response = await fetch(`/api/users/${currentModalType}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('success', `User ${result.user.username} added successfully`);
            closeUserModal();
            loadUserLists();
        } else {
            showToast('error', result.message || 'Failed to add user');
        }
    } catch (error) {
        console.error('Error adding user:', error);
        showToast('error', 'Failed to add user. Please try again.');
    }
}

async function removeUser(userId, type) {
    try {
        const response = await fetch(`/api/users/${type}/${userId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('success', 'User removed successfully');
            loadUserLists();
        } else {
            showToast('error', result.message || 'Failed to remove user');
        }
    } catch (error) {
        console.error('Error removing user:', error);
        showToast('error', 'Failed to remove user. Please try again.');
    }
}

async function saveAllSettings() {
    try {
        const settings = {
            hotReloadEnabled: document.getElementById('hotReloadEnabled').checked,
            webDashboardEnabled: document.getElementById('webDashboardEnabled').checked,
            commandLogsEnabled: document.getElementById('commandLogsEnabled').checked,
            databaseEnabled: document.getElementById('databaseEnabled').checked,
            maintenanceModeEnabled: document.getElementById('maintenanceModeEnabled').checked,
            
            commandRateLimit: parseInt(document.getElementById('commandRateLimit').value),
            globalCommandCooldown: parseInt(document.getElementById('globalCommandCooldown').value),
            autoRecoveryAttempts: parseInt(document.getElementById('autoRecoveryAttempts').value),
            
            customStatusText: document.getElementById('customStatusText').value,
            customStatusType: document.getElementById('customStatusType').value,
            customStatusState: document.getElementById('customStatusState').value,
            dmResponseText: document.getElementById('dmResponseText').value,
            emergencyShutdownCode: document.getElementById('emergencyShutdownCode').value,
            
            twoFactorAuthEnabled: document.getElementById('twoFactorAuthEnabled').checked,
            
            databaseBackupInterval: parseInt(document.getElementById('databaseBackupInterval').value),
            backupRetention: parseInt(document.getElementById('backupRetention').value)
        };
        
        const twoFactorCode = document.getElementById('twoFactorCode');
        if (twoFactorCode && twoFactorCode.value) {
            settings.twoFactorCode = twoFactorCode.value;
        }
        
        const saveButton = document.getElementById('saveSettings');
        const originalText = saveButton.innerHTML;
        saveButton.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i><span>Saving...</span>';
        saveButton.disabled = true;
        
        const response = await fetch('/api/dashboard-settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        const result = await response.json();
        
        saveButton.innerHTML = originalText;
        saveButton.disabled = false;
        
        if (result.success) {
            showToast('success', 'Settings saved successfully');
        } else {
            showToast('error', result.details || 'Failed to save settings');
        }
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('error', 'Failed to save settings. Please try again.');
        
        const saveButton = document.getElementById('saveSettings');
        saveButton.innerHTML = '<i class="mdi mdi-content-save"></i><span>Save Changes</span>';
        saveButton.disabled = false;
    }
}

function validateTwoFactorCode(input) {
    const errorElement = document.getElementById('twoFactorError');
    const pattern = /^\d{6}$/;
    
    if (input.value && !pattern.test(input.value)) {
        input.classList.add('error');
        errorElement.textContent = 'Code must be exactly 6 digits';
        errorElement.classList.remove('hidden');
    } else {
        input.classList.remove('error');
        errorElement.classList.add('hidden');
    }
}

async function createBackup() {
    try {
        const backupBtn = $('#backupNowBtn');
        if (!backupBtn || backupBtn.disabled) return;

        const originalHtml = backupBtn.innerHTML;
        backupBtn.disabled = true;
        backupBtn.innerHTML = '<i class="mdi mdi-loading mdi-spin"></i><span>Creating backup...</span>';

        const response = await fetch('/api/database/backup', {
            method: 'POST'
        });

        const result = await response.json();

        if (result.success) {
            showToast('success', `Backup created successfully: ${result.file}`);
        } else {
            throw new Error(result.message || 'Failed to create backup');
        }
    } catch (error) {
        console.error('Error creating backup:', error);
        showToast('error', error.message || 'An error occurred during backup');
    } finally {
        const backupBtn = $('#backupNowBtn');
        if (backupBtn) {
            backupBtn.disabled = false;
            backupBtn.innerHTML = '<i class="mdi mdi-database-export"></i><span>Backup Now</span>';
        }
    }
}

function showToast(type, message) {
    Swal.fire({
        icon: type,
        title: type === 'success' ? 'Success' : 'Error',
        text: message,
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.addEventListener('mouseenter', Swal.stopTimer);
            toast.addEventListener('mouseleave', Swal.resumeTimer);
        }
    });
}

function confirmShutdown() {
    Swal.fire({
        title: 'Confirm Shutdown',
        text: 'Are you sure you want to shut down the bot? This will disconnect it from Discord.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, shut it down!',
        cancelButtonText: 'Cancel'
    }).then((result) => {
        if (result.isConfirmed) {
            shutdownBot();
        }
    });
}

async function shutdownBot() {
    try {
        const response = await fetch('/api/shutdown', { method: 'POST' });
        const result = await response.json();
        
        if (result.success) {
            Swal.fire({
                title: 'Shutting Down',
                text: 'The bot is shutting down. This dashboard will become unavailable.',
                icon: 'info',
                timer: 5000,
                timerProgressBar: true,
                showConfirmButton: false
            }).then(() => {
                window.location.href = '/';
            });
        } else {
            throw new Error(result.message || 'Shutdown failed');
        }
    } catch (error) {
        console.error('Error shutting down:', error);
        showToast('error', 'Failed to shut down the bot');
    }
}
