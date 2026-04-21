import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

const firebaseConfig = {
    apiKey: "AIzaSyAc092YhusGKgqVnlUDGp6Cs-ShQteVZ1o",
    authDomain: "lueken-s-vending-machine.firebaseapp.com",
    projectId: "lueken-s-vending-machine",
    storageBucket: "lueken-s-vending-machine.firebasestorage.app",
    messagingSenderId: "252754856690",
    appId: "1:252754856690:web:320e7a25c6f935588f5e6b",
    measurementId: "G-KKN4C9V93Y"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const API_BASE = 'https://backend-vendomatic-3000.onrender.com';
let currentUser = null;
let currentUserEmail = null;
let idToken = null;

const memoryStorage = {
    data: {},
    getItem: function(key) { return this.data[key] || null; },
    setItem: function(key, value) { this.data[key] = value; },
    removeItem: function(key) { delete this.data[key]; }
};

window.signInWithGoogle = async function() {
    try {
        provider.setCustomParameters({
            prompt: 'select_account'
        });

        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        idToken = await user.getIdToken();

        memoryStorage.setItem('idToken', idToken);
        memoryStorage.setItem('userEmail', user.email);

        const response = await fetch(`${API_BASE}/auth/google`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });

        const data = await response.json();

        if (response.ok) {
            currentUser = data.user_id;
            currentUserEmail = user.email;

            if (data.is_admin) {
                loadAdminPanel();
            } else {
                document.getElementById('userPoints').textContent = data.points;
                document.getElementById('userEmail').textContent = user.email;
                showScreen('vendingScreen');
            }
        } else {
            showMessage('loginError', data.error || 'Login failed', true);
        }
    } catch (error) {
        console.error('Login error:', error);
        const errorMsg = error.code === 'auth/popup-blocked'
            ? 'Popup blocked! Please allow popups for this site.'
            : error.message || 'Login failed. This app needs to run in a normal browser (not Claude Artifacts).';
        showMessage('loginError', errorMsg, true);
    }
};

window.signOut = async function() {
    try {
        await firebaseSignOut(auth);
        currentUser = null;
        currentUserEmail = null;
        idToken = null;
        memoryStorage.removeItem('idToken');
        memoryStorage.removeItem('userEmail');
        showScreen('loginScreen');
    } catch (error) {
        console.error('Logout error:', error);
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            idToken = await user.getIdToken();
            memoryStorage.setItem('idToken', idToken);

            const response = await fetch(`${API_BASE}/auth/google`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                }
            });

            const data = await response.json();

            if (response.ok) {
                currentUser = data.user_id;
                currentUserEmail = user.email;

                if (data.is_admin) {
                    loadAdminPanel();
                } else {
                    document.getElementById('userPoints').textContent = data.points;
                    document.getElementById('userEmail').textContent = user.email;
                    showScreen('vendingScreen');
                }
            } else {
                showScreen('loginScreen');
            }
        } catch (error) {
            console.error('Session restore error:', error);
            showScreen('loginScreen');
        }
    } else {
        currentUser = null;
        currentUserEmail = null;
        idToken = null;
        showScreen('loginScreen');
    }
});

function showScreen(screenId) {
    document.querySelectorAll('.screen > div').forEach(div => {
        div.classList.add('hidden');
    });
    document.getElementById(screenId).classList.remove('hidden');
}

function showMessage(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    el.innerHTML = `<div class="${isError ? 'error' : 'success'}">${message}</div>`;
    setTimeout(() => {
        el.innerHTML = '';
    }, 3000);
}

window.buyItem = async function(itemName, cost) {
    if (!currentUser || !idToken) return;

    const pointsEl = document.getElementById('userPoints');
    const prevText = pointsEl.textContent;
    const prevPoints = parseInt(prevText, 10);
    const slots = document.querySelectorAll('#vendingScreen .slot');

    if (!Number.isNaN(prevPoints) && prevPoints < cost) {
        showMessage('vendingMessage', 'Not enough points', true);
        return;
    }

    if (!Number.isNaN(prevPoints)) {
        pointsEl.textContent = prevPoints - cost;
        pointsEl.classList.remove('flash');
        void pointsEl.offsetWidth;
        pointsEl.classList.add('flash');
    }
    slots.forEach(s => s.style.pointerEvents = 'none');

    try {
        const response = await fetch(`${API_BASE}/buy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                user_id: currentUser,
                item_name: itemName,
                cost: cost
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            pointsEl.textContent = prevText;
            showMessage('vendingMessage', data.error || 'Purchase failed', true);
            return;
        }

        if (typeof data.new_points === 'number') {
            pointsEl.textContent = data.new_points;
        }
        showMessage('vendingMessage', `Dispensing ${itemName}...`);
    } catch (error) {
        pointsEl.textContent = prevText;
        showMessage('vendingMessage', 'Connection error', true);
    } finally {
        slots.forEach(s => s.style.pointerEvents = '');
    }
};

let adminUsers = [];
let sortMode = 'points_desc';

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

window.renderUserList = function() {
    const query = (document.getElementById('userSearch')?.value || '').toLowerCase().trim();
    const filtered = adminUsers.filter(u =>
        !query || (u.email || '').toLowerCase().includes(query) || (u.user_id || '').toLowerCase().includes(query)
    );

    const sorted = [...filtered].sort((a, b) => {
        if (sortMode === 'points_desc') return (b.points ?? 0) - (a.points ?? 0);
        if (sortMode === 'points_asc') return (a.points ?? 0) - (b.points ?? 0);
        if (sortMode === 'email_asc') return (a.email || '').localeCompare(b.email || '');
        return 0;
    });

    const list = document.getElementById('userList');
    if (sorted.length === 0) {
        list.innerHTML = `<div class="empty-state">${adminUsers.length === 0 ? 'No users yet' : 'No matches'}</div>`;
        return;
    }

    list.innerHTML = sorted.map(user => {
        const label = escapeHtml(user.email || user.user_id);
        const id = escapeHtml(user.user_id);
        return `
            <div class="user-item" data-user-id="${id}">
                <div class="user-info">
                    <div class="user-id" title="${label}">${label}</div>
                    <div class="user-points">${user.points} pts</div>
                </div>
                <div class="user-actions">
                    <button class="button small-button" onclick="adjustPoints('${id}', 10, this)" title="Add 10 points">+10</button>
                    <button class="button danger small-button" onclick="adjustPoints('${id}', -10, this)" title="Remove 10 points">-10</button>
                    <button class="button danger icon-button" onclick="removeUser('${id}', '${label}', this)" title="Delete user" aria-label="Delete user">×</button>
                </div>
            </div>
        `;
    }).join('');
};

window.toggleSort = function() {
    const order = ['points_desc', 'points_asc', 'email_asc'];
    const labels = { points_desc: 'Points ↓', points_asc: 'Points ↑', email_asc: 'Email A–Z' };
    sortMode = order[(order.indexOf(sortMode) + 1) % order.length];
    document.getElementById('sortButton').textContent = labels[sortMode];
    renderUserList();
};

window.loadAdminPanel = async function() {
    if (!idToken) return;

    const list = document.getElementById('userList');
    list.innerHTML = '<div class="skeleton-item"></div><div class="skeleton-item"></div><div class="skeleton-item"></div>';
    showScreen('adminPanel');

    try {
        const response = await fetch(`${API_BASE}/users`, {
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });
        adminUsers = await response.json();
        renderUserList();
    } catch (error) {
        list.innerHTML = '';
        showMessage('adminMessage', 'Failed to load users', true);
    }
};

window.adjustPoints = async function(userId, adjustment, buttonEl) {
    if (!idToken) return;

    const userItem = buttonEl?.closest('.user-item');
    const pointsEl = userItem?.querySelector('.user-points');
    const buttons = userItem?.querySelectorAll('button') ?? [];
    const prevText = pointsEl?.textContent ?? '';
    const prevPoints = parseInt(prevText, 10);

    if (pointsEl && !Number.isNaN(prevPoints)) {
        pointsEl.textContent = `${prevPoints + adjustment} pts`;
        pointsEl.classList.remove('flash');
        void pointsEl.offsetWidth;
        pointsEl.classList.add('flash');
    }
    buttons.forEach(b => b.disabled = true);

    try {
        const response = await fetch(`${API_BASE}/buy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                user_id: userId,
                item_name: 'ADMIN_ADJUSTMENT',
                cost: -adjustment
            })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            if (pointsEl && typeof data.new_points === 'number') {
                pointsEl.textContent = `${data.new_points} pts`;
            }
            const idx = adminUsers.findIndex(u => u.user_id === userId);
            if (idx !== -1 && typeof data.new_points === 'number') {
                adminUsers[idx].points = data.new_points;
            }
        } else {
            if (pointsEl) pointsEl.textContent = prevText;
            showMessage('adminMessage', data.error || 'Failed to adjust points', true);
        }
    } catch (error) {
        if (pointsEl) pointsEl.textContent = prevText;
        console.error('Error adjusting points:', error);
        showMessage('adminMessage', 'Connection error', true);
    } finally {
        buttons.forEach(b => b.disabled = false);
    }
};

window.removeUser = async function(userId, userEmail, buttonEl) {
    if (!idToken) return;

    if (!confirm(`Remove ${userEmail}?\n\nThis will permanently delete this user. This cannot be undone.`)) {
        return;
    }

    const userItem = buttonEl?.closest('.user-item');
    const buttons = userItem?.querySelectorAll('button') ?? [];
    buttons.forEach(b => b.disabled = true);

    try {
        const response = await fetch(`${API_BASE}/users/${encodeURIComponent(userId)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${idToken}`
            }
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            adminUsers = adminUsers.filter(u => u.user_id !== userId);
            renderUserList();
            showMessage('adminMessage', `Removed ${userEmail}`);
        } else {
            buttons.forEach(b => b.disabled = false);
            showMessage('adminMessage', data.error || 'Failed to remove user', true);
        }
    } catch (error) {
        buttons.forEach(b => b.disabled = false);
        console.error('Error removing user:', error);
        showMessage('adminMessage', 'Connection error', true);
    }
};

window.adminDispense = async function(slotName) {
    if (!idToken) return;

    try {
        const response = await fetch(`${API_BASE}/buy`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({
                user_id: 'ADMIN',
                item_name: slotName,
                cost: 0
            })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage('adminDispenseMessage', `Dispensing ${slotName}...`);
        } else {
            showMessage('adminDispenseMessage', data.error || 'Dispense failed', true);
        }
    } catch (error) {
        showMessage('adminDispenseMessage', 'Connection error', true);
    }
};
