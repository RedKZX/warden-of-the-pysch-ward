const SwalConfig = {
    customClass: {
        popup: 'bg-[#13131a] rounded-xl border border-[#1c1c25] shadow-xl',
        title: 'text-white text-xl font-bold',
        htmlContainer: 'text-gray-300',
        confirmButton: 'bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 hover:text-violet-300 px-4 py-2 rounded-lg transition-all',
        cancelButton: 'bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/20 text-gray-400 hover:text-gray-300 px-4 py-2 rounded-lg transition-all',
        actions: 'space-x-3',
    },
    background: '#13131a',
    color: '#fff',
    iconColor: '#8b5cf6',
    showClass: { popup: 'animate__animated animate__fadeIn animate__faster' },
    hideClass: { popup: 'animate__animated animate__fadeOut animate__faster' }
};

const SwalToastConfig = {
    ...SwalConfig,
    customClass: {
        ...SwalConfig.customClass,
        popup: 'bg-[#13131a] rounded-lg border border-[#1c1c25] shadow-lg',
        title: 'text-white text-base font-medium',
    },
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
};

document.addEventListener('DOMContentLoaded', () => {
    requestAnimationFrame(() => {
        initializeSearchFunctionality();
        initializeGuildFunctions();
        initializeModalHandlers();
        initializeStatusBadgeAnimation();
        
        const guildCards = document.querySelectorAll('.guild-card');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        guildCards.forEach((card, index) => {
            card.style.opacity = '0';
            card.style.transform = 'translateY(20px)';
            card.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            card.style.transitionDelay = `${index % 10 * 50}ms`;
            observer.observe(card);
        });
    });
});

function initializeStatusBadgeAnimation() {
    setInterval(() => {
        document.querySelectorAll('.status-badge').forEach(badge => {
            if (Math.random() > 0.9) {
                badge.textContent = 'Inactive';
                badge.classList.remove('active');
                badge.classList.add('inactive');
                badge.innerHTML = '<i class="mdi mdi-circle text-xs mr-1"></i>Inactive';
            } else {
                badge.textContent = 'Active';
                badge.classList.remove('inactive');
                badge.classList.add('active');
                badge.innerHTML = '<i class="mdi mdi-circle text-xs mr-1"></i>Active';
            }
        });
    }, 5000);
}

function initializeGuildFunctions() {
    const leaveButtons = document.querySelectorAll('[data-guild-leave-btn]');
    const refreshButton = document.getElementById('refreshServers');

    leaveButtons.forEach(button => {
        button.addEventListener('click', handleLeaveGuild);
    });

    refreshButton.addEventListener('click', () => location.reload());
}

function initializeSearchFunctionality() {
    const searchInput = document.getElementById('guildSearch');
    const guildCards = document.querySelectorAll('.guild-card');
    const guildContainer = document.getElementById('guildContainer');

    const guildsData = Array.from(guildCards).map(card => ({
        element: card,
        name: card.querySelector('h3').textContent.toLowerCase(),
        id: card.querySelector('.text-gray-300 span').textContent.toLowerCase(),
        memberCount: parseInt(card.querySelector('.text-sm.text-gray-300').textContent.replace(/[^0-9]/g, '')),
    }));

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    function performSearch(searchTerm) {
        if (!searchTerm) {
            guildsData.forEach(guild => {
                guild.element.style.display = 'block';
                guild.element.classList.add('animate__animated', 'animate__fadeIn', 'animate__faster');
                setTimeout(() => guild.element.classList.remove('animate__animated', 'animate__fadeIn', 'animate__faster'), 500);
            });
            return;
        }

        searchTerm = searchTerm.toLowerCase();
        const results = guildsData.filter(guild =>
            guild.name.includes(searchTerm) || guild.id.includes(searchTerm)
        );

        guildsData.forEach(guild => {
            if (results.includes(guild)) {
                guild.element.style.display = 'block';
                guild.element.classList.add('animate__animated', 'animate__fadeIn', 'animate__faster');
                setTimeout(() => guild.element.classList.remove('animate__animated', 'animate__fadeIn', 'animate__faster'), 500);
            } else {
                guild.element.classList.add('animate__animated', 'animate__fadeOut', 'animate__faster');
                setTimeout(() => {
                    guild.element.style.display = 'none';
                    guild.element.classList.remove('animate__animated', 'animate__fadeOut', 'animate__faster');
                }, 300);
            }
        });

        const noResultsMsg = document.getElementById('noResultsMessage') || createNoResultsMessage();

        if (results.length === 0) {
            if (!document.getElementById('noResultsMessage')) {
                guildContainer.appendChild(noResultsMsg);
            }
            noResultsMsg.style.display = 'block';
            noResultsMsg.classList.add('animate__animated', 'animate__fadeIn', 'animate__faster');
        } else {
            noResultsMsg.style.display = 'none';
        }
    }

    function createNoResultsMessage() {
        const message = document.createElement('div');
        message.id = 'noResultsMessage';
        message.className = 'col-span-full text-center p-8 bg-[#13131a]/80 backdrop-blur-md rounded-xl border border-[#1c1c25] animate__animated animate__fadeIn animate__faster';
        message.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="p-4 rounded-full bg-gray-800/50 mb-4 border border-gray-700/30">
                    <i class="mdi mdi-magnify text-4xl text-gray-400"></i>
                </div>
                <h3 class="text-xl font-semibold mb-2 text-white">No Servers Found</h3>
                <p class="text-sm text-gray-400 mb-6">We couldn't find any servers matching your search criteria</p>
                <button id="resetSearchBtn" class="px-5 py-3 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 hover:text-violet-300 rounded-lg transition-all flex items-center">
                    <i class="mdi mdi-refresh mr-2"></i>Reset Search
                </button>
            </div>
        `;

        message.querySelector('#resetSearchBtn').addEventListener('click', () => {
            searchInput.value = '';
            performSearch('');
            searchInput.blur();
        });

        return message;
    }

    searchInput.addEventListener('input', debounce(e => performSearch(e.target.value), 200));
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            searchInput.value = '';
            performSearch('');
            searchInput.blur();
        }
    });
}

function initializeModalHandlers() {
    const modal = document.getElementById('addBotModal');
    const addBtn = document.getElementById('addBot');
    const closeBtn = document.getElementById('closeModalBtn');
    const closeBtn2 = document.getElementById('closeModalBtn2');
    const copyBtn = document.getElementById('copyLinkBtn');
    const inviteLink = document.getElementById('inviteLink');

    function openModal() {
        const clientId = document.querySelector('meta[name="client-id"]').content;
        inviteLink.textContent = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=8&scope=bot%20applications.commands`;
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const modalContainer = modal.querySelector('div');
        modalContainer.style.opacity = '0';
        modalContainer.style.transform = 'scale(0.95)';

        setTimeout(() => {
            modalContainer.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            modalContainer.style.opacity = '1';
            modalContainer.style.transform = 'scale(1)';
        }, 50);
    }

    function closeModal() {
        const modalContainer = modal.querySelector('div');
        modalContainer.style.opacity = '0';
        modalContainer.style.transform = 'scale(0.95)';

        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
        }, 300);
    }

    function copyLink() {
        navigator.clipboard.writeText(inviteLink.textContent).then(() => {
            copyBtn.innerHTML = '<i class="mdi mdi-check mr-2"></i>Copied';
            copyBtn.classList.add('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');
            copyBtn.classList.remove('bg-violet-500/10', 'text-violet-400', 'border-violet-500/20');

            setTimeout(() => {
                copyBtn.innerHTML = '<i class="mdi mdi-content-copy mr-2"></i>Copy Link';
                copyBtn.classList.remove('bg-emerald-500/20', 'text-emerald-400', 'border-emerald-500/30');
                copyBtn.classList.add('bg-violet-500/10', 'text-violet-400', 'border-violet-500/20');
            }, 2000);

            Swal.fire({
                ...SwalToastConfig,
                title: 'Copied to clipboard',
                icon: 'success',
                text: 'Bot invite link has been copied'
            });
        });
    }

    addBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    closeBtn2.addEventListener('click', closeModal);
    copyBtn.addEventListener('click', copyLink);

    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        }
    });
}

function handleLeaveGuild(event) {
    event.preventDefault();
    event.stopPropagation();

    const guildId = event.currentTarget.getAttribute('data-guild-id');
    const guildName = event.currentTarget.getAttribute('data-guild-name');

    if (!guildId || !guildName) {
        console.error('Missing guild details');
        return;
    }

    leaveGuild(guildId, guildName);
}

function leaveGuild(guildId, guildName) {
    Swal.fire({
        ...SwalConfig,
        title: 'Leave Server',
        html: `Are you sure you want to leave <strong class="text-violet-400">${guildName}</strong>?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Leave Server',
        cancelButtonText: 'Cancel',
        customClass: {
            ...SwalConfig.customClass,
            confirmButton: 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 px-4 py-2 rounded-lg transition-all',
        }
    }).then((result) => {
        if (result.isConfirmed) {
            const card = document.querySelector(`[data-guild-id="${guildId}"]`).closest('.guild-card');
            card.style.opacity = '0.6';
            card.style.transform = 'scale(0.98)';
            card.style.pointerEvents = 'none';

            fetch(`/api/guild/leave/${guildId}`, { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        card.classList.add('animate__animated', 'animate__fadeOutUp', 'animate__faster');

                        Swal.fire({
                            ...SwalToastConfig,
                            title: 'Server Left',
                            text: `Successfully left ${guildName}`,
                            icon: 'success'
                        }).then(() => {
                            setTimeout(() => {
                                location.reload();
                            }, 400);
                        });
                    } else {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                        card.style.pointerEvents = 'auto';

                        throw new Error(data.message || 'Failed to leave server');
                    }
                })
                .catch(error => {
                    Swal.fire({
                        ...SwalConfig,
                        title: 'Error',
                        text: error.message,
                        icon: 'error',
                        customClass: {
                            ...SwalConfig.customClass,
                            popup: 'bg-[#13131a] rounded-xl border border-red-500/20 shadow-xl',
                        }
                    });
                });
        }
    });
}

function confirmShutdown() {
    Swal.fire({
        ...SwalConfig,
        title: 'Shutdown Bot?',
        text: 'This action will take the bot offline. Are you sure?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Shutdown',
        cancelButtonText: 'Cancel',
        customClass: {
            ...SwalConfig.customClass,
            confirmButton: 'bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 hover:text-red-300 px-4 py-2 rounded-lg transition-all',
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire({
                title: 'Shutting down...',
                text: 'The bot is going offline',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                },
                customClass: SwalConfig.customClass
            });

            fetch("/api/shutdown", { method: "POST" })
                .then(response => response.json())
                .then(() => {
                    Swal.fire({
                        ...SwalConfig,
                        title: 'Bot is shutting down...',
                        text: 'The bot is now going offline',
                        icon: 'success',
                        timer: 3000,
                        showConfirmButton: false
                    });
                });
        }
    });
}
