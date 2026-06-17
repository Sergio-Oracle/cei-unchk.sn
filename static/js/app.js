// Variables globales
let currentUser = null;
let authToken = null;

// ─── Fuseau horaire de référence : Dakar (UTC+0, pas de DST) ─────────────
const TZ_DAKAR = 'Africa/Dakar';

/**
 * Formater une date ISO en heure locale Dakar.
 * @param {string} isoStr  - chaîne ISO renvoyée par l'API (ex: "2026-01-02T17:54:00+00:00")
 * @param {object} opts    - options Intl supplémentaires
 */
function _locale() { return window._i18nLocale || 'fr-FR'; }
function fmtDakar(isoStr, opts = {}) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleString(_locale(), {
        timeZone: TZ_DAKAR,
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        ...opts
    });
}
function fmtDakarDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString(_locale(), { timeZone: TZ_DAKAR, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDakarTime(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleTimeString(_locale(), { timeZone: TZ_DAKAR, hour: '2-digit', minute: '2-digit' });
}

// ─── Traduction des erreurs techniques en messages lisibles ───────────────
function humanError(err) {
    if (!err) return t('msg.error_generic');
    // Erreur déjà gérée (session expirée, redirection login) — ne pas afficher une 2e alerte
    if (err.alreadyHandled) return null;
    // Le serveur a envoyé un message explicite (encodé par authenticatedFetch)
    if (err.serverMessage) return err.serverMessage;
    const m = String(err.message || err).toLowerCase();
    if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('network request'))
        return t('msg.error_network');
    if (m.includes('timeout') || m.includes('timed out'))
        return t('msg.error_timeout');
    if (m.includes('aborted'))
        return t('msg.error_generic');
    if (m.includes('json') || m.includes('unexpected token'))
        return t('msg.error_json');
    if (m.includes('unauthorized') || m.includes('401'))
        return t('auth.session_expired');
    if (m.includes('forbidden') || m.includes('403'))
        return t('auth.no_permission');
    if (m.includes('not found') || m.includes('404'))
        return t('auth.not_found');
    return t('msg.error_generic');
}


// Configuration des requêtes avec JWT
async function authenticatedFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
    const config = { ...options, headers };
    
    try {
        const response = await fetch(url, config);

        // 401/422 : session expirée → alerte immédiate + redirection login
        if (response.status === 401 || response.status === 422) {
            localStorage.removeItem('authToken');
            authToken = null;
            currentUser = null;
            showAlert('Votre session a expiré. Veuillez vous reconnecter.', 'warning');
            showLogin();
            const e401 = new Error('Session expirée');
            e401.alreadyHandled = true;
            throw e401;
        }

        // 400 / 403 / 404 / 5xx : encoder le message serveur dans l'erreur
        // (affiché UNE seule fois par le bloc catch de l'appelant via humanError)
        if (response.status === 400 || response.status === 403 ||
            response.status === 404 || response.status >= 500) {
            const body = await response.json().catch(() => ({}));
            const defaults = {
                400: 'Données invalides. Vérifiez les informations saisies.',
                403: 'Vous n\'avez pas l\'autorisation d\'effectuer cette action.',
                404: 'Ressource introuvable.',
            };
            const msg = body.error || defaults[response.status] || 'Erreur serveur. Veuillez réessayer plus tard.';
            const err = new Error(msg);
            err.serverMessage = msg;
            err.statusCode = response.status;
            throw err;
        }

        return response;
    } catch (error) {
        // Ne pas ré-afficher les erreurs déjà traitées (serverMessage / alreadyHandled)
        // Les erreurs réseau (Failed to fetch) sont gérées par humanError dans l'appelant
        throw error;
    }
}
// Initialisation
document.addEventListener('DOMContentLoaded', function() {
    authToken = localStorage.getItem('authToken');

    // Vérifier si un reset_token est présent dans l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset_token');
    if (resetToken) {
        showResetPasswordScreen(resetToken);
        return;
    }

    if (authToken) {
        verifyToken();
    } else {
        showLogin();
    }
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // Réadapter la sidebar au redimensionnement de fenêtre
    let _resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(initSidebar, 120);
    });
});

// ============================================================================
// MOT DE PASSE OUBLIÉ
// ============================================================================

function showForgotPasswordModal() {
    const existing = document.getElementById('forgot-pw-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'forgot-pw-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:16px;';
    modal.innerHTML = `
        <div id="forgot-pw-box" style="background:#fff;border-radius:16px;padding:36px 32px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.18);">
            <!-- Étape 1 : saisie email -->
            <div id="forgot-step-1">
                <div style="text-align:center;margin-bottom:24px;">
                    <div style="background:#eff6ff;border-radius:50%;width:60px;height:60px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
                        <i class="fas fa-lock" style="color:#3b82f6;font-size:26px;"></i>
                    </div>
                    <h3 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Mot de passe oublié ?</h3>
                    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.6;">Pas de problème. Entrez votre adresse email et nous vous enverrons un lien pour réinitialiser votre mot de passe.</p>
                </div>
                <div style="margin-bottom:20px;">
                    <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:8px;">Adresse email</label>
                    <input id="forgot-pw-email" type="email" placeholder="votre@email.com" autocomplete="email"
                        style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;box-sizing:border-box;outline:none;transition:border-color .15s;"
                        onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'"
                        onkeydown="if(event.key==='Enter') submitForgotPassword()">
                </div>
                <div id="forgot-pw-err" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;"></div>
                <button id="forgot-pw-send-btn" onclick="submitForgotPassword()"
                    style="width:100%;padding:13px;background:#3b82f6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;letter-spacing:.01em;transition:background .15s;"
                    onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                    Envoyer le lien de réinitialisation
                </button>
                <button onclick="document.getElementById('forgot-pw-modal').remove()"
                    style="width:100%;padding:10px;background:transparent;border:none;cursor:pointer;font-size:14px;color:#64748b;margin-top:10px;">
                    Annuler
                </button>
            </div>

            <!-- Étape 2 : confirmation (affichée après envoi) -->
            <div id="forgot-step-2" style="display:none;text-align:center;">
                <div style="background:#f0fdf4;border-radius:50%;width:70px;height:70px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:18px;">
                    <i class="fas fa-envelope-open-text" style="color:#16a34a;font-size:30px;"></i>
                </div>
                <h3 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#0f172a;">Email envoyé !</h3>
                <p id="forgot-sent-msg" style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.7;"></p>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;text-align:left;margin-bottom:20px;">
                    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.9;">
                        <strong style="color:#0f172a;">Vous ne le trouvez pas ?</strong><br>
                        • L'email arrive dans votre <strong>boîte de réception</strong> en quelques minutes<br>
                        • Le lien est valable <strong>1 heure</strong><br>
                        • Expéditeur : <strong>CEI — Centre d'Examen Intelligent</strong><br>
                        • Absent après 5 min ? Consultez aussi les <strong>Spams / Indésirables</strong>
                    </p>
                </div>
                <button id="forgot-resend-btn" onclick="showForgotPasswordModal()"
                    style="width:100%;padding:12px;background:transparent;border:1.5px solid #3b82f6;color:#3b82f6;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;margin-bottom:8px;">
                    <i class="fas fa-redo"></i> Renvoyer un lien
                </button>
                <button onclick="document.getElementById('forgot-pw-modal').remove()"
                    style="width:100%;padding:10px;background:transparent;border:none;cursor:pointer;font-size:14px;color:#64748b;">
                    Retour à la connexion
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => document.getElementById('forgot-pw-email')?.focus(), 80);
}

async function submitForgotPassword() {
    const emailInput = document.getElementById('forgot-pw-email');
    const email = emailInput?.value?.trim() || '';
    const errEl = document.getElementById('forgot-pw-err');
    const sendBtn = document.getElementById('forgot-pw-send-btn');

    const showErr = msg => {
        if (errEl) { errEl.style.display = 'block'; errEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${msg}`; }
        if (emailInput) emailInput.style.borderColor = '#fca5a5';
    };

    if (!email) return showErr('Veuillez entrer votre adresse email.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showErr('Format d\'email invalide.');

    if (errEl) errEl.style.display = 'none';
    if (emailInput) emailInput.style.borderColor = '#e2e8f0';
    if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Envoi en cours...'; }

    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        // Afficher l'étape 2 — confirmation
        document.getElementById('forgot-step-1').style.display = 'none';
        document.getElementById('forgot-step-2').style.display = 'block';

        const sentMsg = document.getElementById('forgot-sent-msg');
        if (sentMsg) {
            if (data.masked_email) {
                sentMsg.innerHTML = `Nous avons envoyé un lien de réinitialisation à <strong>${data.masked_email}</strong>.<br>Cliquez sur le lien dans l'email pour définir un nouveau mot de passe.`;
            } else {
                sentMsg.innerHTML = `Si cette adresse <strong>${email}</strong> est associée à un compte, vous recevrez un email sous quelques minutes.`;
            }
        }
    } catch(e) {
        if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = 'Envoyer le lien de réinitialisation'; }
        showErr('Erreur de connexion. Vérifiez votre réseau et réessayez.');
    }
}

function showResetPasswordScreen(token) {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.id = 'reset-pw-screen';
    // position:fixed + z-index élevé pour ne pas être bloqué par les overlays existants
    wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:20px;box-sizing:border-box;';
    wrap.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:36px 32px;max-width:440px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25);position:relative;z-index:1;">
            <div style="text-align:center;margin-bottom:28px;">
                <div style="background:#eff6ff;border-radius:50%;width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;">
                    <i class="fas fa-lock" style="color:#3b82f6;font-size:28px;"></i>
                </div>
                <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f172a;">Nouveau mot de passe</h2>
                <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5;">Choisissez un mot de passe sécurisé (min. 8 caractères).</p>
            </div>
            <div style="margin-bottom:16px;">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:7px;">
                    <i class="fas fa-lock" style="color:#3b82f6;"></i> Nouveau mot de passe
                </label>
                <input id="reset-pw-new" type="password" placeholder="••••••••" autocomplete="new-password"
                    style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;box-sizing:border-box;outline:none;font-family:inherit;"
                    onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
            </div>
            <div style="margin-bottom:22px;">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:7px;">
                    <i class="fas fa-lock" style="color:#3b82f6;"></i> Confirmer le mot de passe
                </label>
                <input id="reset-pw-confirm" type="password" placeholder="••••••••" autocomplete="new-password"
                    style="width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:15px;box-sizing:border-box;outline:none;font-family:inherit;"
                    onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'"
                    onkeydown="if(event.key==='Enter') submitResetPassword('${token}')">
            </div>
            <div id="reset-pw-msg" style="display:none;margin-bottom:16px;"></div>
            <button onclick="submitResetPassword('${token}')"
                style="width:100%;padding:13px;background:#3b82f6;color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;letter-spacing:.01em;"
                onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                <i class="fas fa-check"></i> Enregistrer le nouveau mot de passe
            </button>
            <p style="text-align:center;margin:16px 0 0;">
                <a href="/app" style="font-size:14px;color:#64748b;text-decoration:none;">
                    <i class="fas fa-arrow-left"></i> Retour à la connexion
                </a>
            </p>
        </div>
    `;
    document.body.appendChild(wrap);
}

async function submitResetPassword(token) {
    const newPw = document.getElementById('reset-pw-new')?.value || '';
    const confirm = document.getElementById('reset-pw-confirm')?.value || '';
    const msgEl = document.getElementById('reset-pw-msg');

    const showMsg = (text, color) => {
        if (msgEl) { msgEl.style.display='block'; msgEl.innerHTML=`<div style="background:${color==='error'?'#fee2e2':'#ecfdf5'};color:${color==='error'?'#dc2626':'#059669'};padding:10px 14px;border-radius:8px;font-size:13px;">${text}</div>`; }
    };
    if (newPw.length < 8) return showMsg('<i class="fas fa-exclamation-circle"></i> Le mot de passe doit contenir au moins 8 caractères.', 'error');
    if (newPw !== confirm) return showMsg('<i class="fas fa-exclamation-circle"></i> Les mots de passe ne correspondent pas.', 'error');

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPw })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showMsg('<i class="fas fa-check-circle"></i> Mot de passe mis à jour ! Redirection vers la connexion...', 'success');
            setTimeout(() => { window.location.href = '/app'; }, 2000);
        } else {
            showMsg(`<i class="fas fa-exclamation-circle"></i> ${data.error || 'Erreur inconnue'}`, 'error');
        }
    } catch(e) {
        showMsg('<i class="fas fa-exclamation-circle"></i> Erreur réseau. Réessayez.', 'error');
    }
}

// Authentification
async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    showLoader(true);
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (data.success) {
            authToken = data.access_token;
            currentUser = data.user;
            localStorage.setItem('authToken', authToken);
            showApp();
        } else {
            showAlert(data.error || 'Identifiants incorrects ou compte désactivé.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ✅ Fonction handleRegister() SUPPRIMÉE

async function verifyToken() {
    try {
        const response = await authenticatedFetch('/api/auth/me');
        if (response.ok) {
            currentUser = await response.json();
            showApp();
        } else {
            localStorage.removeItem('authToken');
            authToken = null;
            showLogin();
        }
    } catch (error) {
        localStorage.removeItem('authToken');
        authToken = null;
        showLogin();
    }
}

function logout() {
    localStorage.removeItem('authToken');
    authToken = null;
    currentUser = null;
    window.location.reload();
}

function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    // ✅ Ligne register-screen supprimée
    document.getElementById('app-screen').style.display = 'none';
}

// ✅ Fonction showRegister() SUPPRIMÉE

function getRoleColor(role) {
    return { admin: '#7c3aed', professor: '#2563eb', student: '#059669', surveillant: '#d97706' }[role] || '#3b82f6';
}

function buildInitials(name) {
    return (name || '?').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

window._currentView = null; // Garde la fonction de la vue active

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';
    refreshNavbarAvatar();
    loadNavigation();
    initSidebar();
    loadDashboard();
    startNotifPolling();
    // Rechargement complet quand la langue change
    const _origSetLang = window.setLang;
    window.setLang = function(code) {
        _origSetLang(code);
        if (currentUser) {
            loadNavigation();
            initSidebar();
            applyI18n();
            if (window._currentView) window._currentView();
        }
    };
}

function refreshNavbarAvatar() {
    const color    = getRoleColor(currentUser.role);
    const initials = buildInitials(currentUser.full_name);
    const roleLabel = getRoleLabel(currentUser.role);

    // Petite bulle dans la navbar
    const circle = document.getElementById('user-avatar-circle');
    if (circle) { circle.textContent = initials; circle.style.background = color; }
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = currentUser.full_name;
    const roleEl = document.getElementById('user-role');
    if (roleEl) roleEl.textContent = roleLabel;

    // Contenu du dropdown header
    const dlg = document.getElementById('dropdown-avatar-lg');
    if (dlg) { dlg.textContent = initials; dlg.style.background = color; }
    const dn = document.getElementById('dropdown-name');
    if (dn) dn.textContent = currentUser.full_name;
    const de = document.getElementById('dropdown-email');
    if (de) de.textContent = currentUser.email || '';
    const db = document.getElementById('dropdown-badge');
    if (db) { db.textContent = roleLabel; db.style.background = color; }
}

// ── Sidebar vertical ─────────────────────────────────────────────────────────

function _isMobile() { return window.innerWidth <= 768; }

function _sidebarCollapsed() {
    return localStorage.getItem('sidebar_collapsed') === '1';
}

function initSidebar() {
    const sidebar = document.getElementById('main-nav');
    if (!sidebar) return;

    // Ensure overlay exists
    if (!document.getElementById('sidebar-overlay')) {
        const ov = document.createElement('div');
        ov.id = 'sidebar-overlay';
        ov.onclick = closeSidebarMobile;
        document.body.appendChild(ov);
    }

    if (_isMobile()) {
        sidebar.classList.remove('collapsed');
        document.getElementById('sidebar-toggle').style.display = 'flex';
    } else {
        document.getElementById('sidebar-toggle').style.display = 'none';
        if (_sidebarCollapsed()) {
            sidebar.classList.add('collapsed');
            const ic = document.getElementById('collapse-icon');
            if (ic) ic.style.transform = 'rotate(180deg)';
        } else {
            sidebar.classList.remove('collapsed');
            const ic = document.getElementById('collapse-icon');
            if (ic) ic.style.transform = '';
        }
    }

    // Add tooltips to nav tabs for collapsed mode + close sidebar on click (mobile)
    sidebar.querySelectorAll('.nav-tab').forEach(btn => {
        const text = btn.textContent.trim();
        if (text && !btn.title) btn.title = text;
        // Close mobile sidebar when a tab is clicked
        btn.addEventListener('click', () => { if (_isMobile()) closeSidebarMobile(); }, { once: false });
    });
}

function toggleSidebar() {
    const sidebar = document.getElementById('main-nav');
    if (!sidebar) return;

    if (_isMobile()) {
        const isOpen = sidebar.classList.contains('open');
        sidebar.classList.toggle('open', !isOpen);
        const ov = document.getElementById('sidebar-overlay');
        if (ov) ov.classList.toggle('visible', !isOpen);
        const ic = document.getElementById('sidebar-toggle-icon');
        if (ic) ic.className = isOpen ? 'fas fa-bars' : 'fas fa-times';
    } else {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar_collapsed', isCollapsed ? '1' : '0');
        const ic = document.getElementById('collapse-icon');
        if (ic) ic.style.transform = isCollapsed ? 'rotate(180deg)' : '';
    }
}

function closeSidebarMobile() {
    const sidebar = document.getElementById('main-nav');
    if (sidebar) sidebar.classList.remove('open');
    const ov = document.getElementById('sidebar-overlay');
    if (ov) ov.classList.remove('visible');
    const ic = document.getElementById('sidebar-toggle-icon');
    if (ic) ic.className = 'fas fa-bars';
}

// Close mobile sidebar when a tab is clicked
function _navTabClicked() {
    if (_isMobile()) closeSidebarMobile();
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Notification bell (students only) ────────────────────────────────────────

let _notifData = [];
let _notifInterval = null;

function _notifReadKey() { return `notif_read_${currentUser?.id || 0}`; }

function _getReadSet() {
    try { return new Set(JSON.parse(localStorage.getItem(_notifReadKey()) || '[]')); }
    catch { return new Set(); }
}

function _saveReadSet(set) {
    localStorage.setItem(_notifReadKey(), JSON.stringify([...set]));
}

async function fetchNotifications() {
    if (!currentUser) return;
    try {
        const data = await apiCall('/api/notifications');
        _notifData = data.notifications || [];
        renderNotifBadge();
    } catch (_) {}
}

function renderNotifBadge() {
    const wrapper = document.getElementById('notif-bell-wrapper');
    const badge   = document.getElementById('notif-badge');
    if (!wrapper) return;
    wrapper.style.display = 'flex';
    const unread = _notifData.filter(n => !n.is_read);
    if (unread.length > 0) {
        badge.textContent = unread.length > 9 ? '9+' : unread.length;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

function renderNotifList() {
    const list = document.getElementById('notif-list');
    if (!list) return;
    if (_notifData.length === 0) {
        list.innerHTML = '<div class="notif-empty"><i class="fas fa-check-circle" style="color:#10b981;margin-right:6px;"></i>Aucune notification</div>';
        return;
    }
    const fmtDate = iso => {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    };
    list.innerHTML = _notifData.map(n => {
        return `<div class="notif-item${!n.is_read ? ' unread' : ''}" onclick="handleNotifClick('${n.id}','${n.type}',${n.attempt_id || n.paper_id || 0})">
            <div class="notif-title"><i class="fas fa-${n.type === 'online_exam' ? 'laptop' : 'file-alt'}" style="color:#6366f1;margin-right:6px;"></i>${n.title}</div>
            <div class="notif-msg">${n.message}</div>
            <div class="notif-time">${fmtDate(n.corrected_at)}</div>
        </div>`;
    }).join('');
}

function toggleNotifPanel(e) {
    if (e) e.stopPropagation();
    const panel = document.getElementById('notif-panel');
    if (!panel) return;
    const open = panel.style.display === 'block';
    panel.style.display = open ? 'none' : 'block';
    if (!open) renderNotifList();
}

function closeNotifPanel() {
    const panel = document.getElementById('notif-panel');
    if (panel) panel.style.display = 'none';
}

async function markAllNotifsRead(e) {
    if (e) e.stopPropagation();
    // Persiste en base de données
    try { await apiCall('/api/notifications/mark-read', { method: 'PUT' }); } catch (_) {}
    // Mise à jour locale immédiate
    _notifData.forEach(n => { n.is_read = true; });
    renderNotifBadge();
    renderNotifList();
}

function handleNotifClick(id, type, resourceId) {
    renderNotifBadge();
    closeNotifPanel();
    if (type === 'online_exam' && resourceId) {
        viewMyExamResult(resourceId);
    } else if (type === 'paper' && resourceId) {
        viewResult(resourceId);
    }
}

function startNotifPolling() {
    if (_notifInterval) clearInterval(_notifInterval);
    fetchNotifications();
    _notifInterval = setInterval(fetchNotifications, 60000);
}

// ─────────────────────────────────────────────────────────────────────────────

function toggleUserDropdown(e) {
    if (e) e.stopPropagation();
    const dd   = document.getElementById('user-dropdown');
    const chev = document.getElementById('av-chevron');
    const open = dd.style.display !== 'none';
    dd.style.display = open ? 'none' : 'block';
    if (chev) chev.classList.toggle('open', !open);
}

function closeUserDropdown() {
    const dd   = document.getElementById('user-dropdown');
    const chev = document.getElementById('av-chevron');
    if (dd)   dd.style.display = 'none';
    if (chev) chev.classList.remove('open');
}

function openProfileFromDropdown() {
    closeUserDropdown();
    showProfileModal('info');
}

function openPasswordFromDropdown() {
    closeUserDropdown();
    showProfileModal('pw');
}

function getRoleLabel(role) {
    return t('role.' + role) || role;
}
// Navigation
function loadNavigation() {
    const nav = document.getElementById('main-nav');
    let tabs = '';
    
    if (currentUser.role === 'admin') {
        tabs = `<div class="nav-tabs">
            <button class="nav-tab active" onclick="loadDashboard()">
                <i class="fas fa-chart-line"></i> ${t('nav.dashboard')}
            </button>
            <button class="nav-tab" onclick="showCreateCourseWithAISuggestionsModal()">
                <i class="fas fa-magic"></i> ${t('nav.ai_suggestions')}
            </button>
            <button class="nav-tab" onclick="loadCreateSubject()">
                <i class="fas fa-plus-circle"></i> ${t('nav.create_subject')}
            </button>
            <button class="nav-tab" onclick="loadUsers()">
                <i class="fas fa-users"></i> ${t('nav.users')}
            </button>
            <button class="nav-tab" onclick="loadSubjects()">
                <i class="fas fa-file-alt"></i> ${t('nav.subjects')}
            </button>
            <button class="nav-tab" onclick="loadCorrectedPapersList()">
                <i class="fas fa-check-circle"></i> ${t('nav.corrected_papers')}
            </button>
            <button class="nav-tab" onclick="loadMaquette()">
                <i class="fas fa-layer-group"></i> ${t('nav.maquette')}
            </button>
            <button class="nav-tab" onclick="loadECAssignments()">
                <i class="fas fa-link"></i> ${t('nav.ec_assignments')}
            </button>
            <button class="nav-tab" onclick="loadStudentEnrollments()">
                <i class="fas fa-user-graduate"></i> ${t('nav.ue_enrollments')}
            </button>
            <button class="nav-tab" onclick="loadOnlineExams()">
                <i class="fas fa-laptop-code"></i> ${t('nav.online_exams')}
            </button>
            <button class="nav-tab" onclick="loadExamsHistory()">
                <i class="fas fa-history"></i> ${t('nav.exam_history')}
            </button>
            <button class="nav-tab" onclick="loadExamCalendar()">
                <i class="fas fa-calendar-alt"></i> Calendrier
            </button>
            <button class="nav-tab" onclick="loadProfessorAnalytics()">
                <i class="fas fa-chart-line"></i> Analytique
            </button>
            <button class="nav-tab" onclick="loadTranscripts()">
                <i class="fas fa-file-alt"></i> ${t('nav.transcripts')}
            </button>
            <button class="nav-tab" onclick="loadReclamations()">
                <i class="fas fa-exclamation-triangle"></i> ${t('nav.reclamations')}
            </button>
            <button class="nav-tab" onclick="loadSecurityReport()">
                <i class="fas fa-shield-alt"></i> Sécurité
            </button>
            <button class="nav-tab" onclick="toggleTheme()" id="theme-toggle-btn" title="${t('nav.change_theme')}">
                <i class="fas fa-moon"></i>
            </button>
        </div>`;
    } else if (currentUser.role === 'professor') {
    tabs = `<div class="nav-tabs">
        <button class="nav-tab active" onclick="loadDashboard()">
            <i class="fas fa-chart-line"></i> ${t('nav.dashboard')}
        </button>
        <button class="nav-tab" onclick="showCreateCourseWithAISuggestionsModal()">
            <i class="fas fa-magic"></i> ${t('nav.ai_suggestions')}
        </button>
        <button class="nav-tab" onclick="loadCreateSubject()">
            <i class="fas fa-plus-circle"></i> ${t('nav.create_subject')}
        </button>
        <button class="nav-tab" onclick="loadCorrectPapers()">
            <i class="fas fa-pencil-alt"></i> ${t('nav.correct_papers')}
        </button>
        <button class="nav-tab" onclick="loadCorrectedPapersList()">
            <i class="fas fa-check-circle"></i> ${t('nav.corrected_papers')}
        </button>
        <button class="nav-tab" onclick="loadMySubjects()">
            <i class="fas fa-book"></i> ${t('nav.my_subjects')}
        </button>
        <button class="nav-tab" onclick="loadOnlineExams()">
            <i class="fas fa-laptop-code"></i> ${t('nav.online_exams')}
        </button>
        <button class="nav-tab" onclick="loadExamCorrections()">
            <i class="fas fa-check-circle"></i> ${t('nav.correct_online')}
        </button>
        <button class="nav-tab" onclick="loadViewResults()">
            <i class="fas fa-chart-bar"></i> ${t('nav.results')}
        </button>
        <button class="nav-tab" onclick="loadTranscripts()">
            <i class="fas fa-file-alt"></i> ${t('nav.transcripts')}
        </button>
        <button class="nav-tab" onclick="loadReclamations()">
            <i class="fas fa-exclamation-triangle"></i> ${t('nav.reclamations')}
        </button>
        <button class="nav-tab" onclick="loadSecurityReport()">
            <i class="fas fa-shield-alt"></i> Sécurité
        </button>
        <button class="nav-tab" id="notif-tab" onclick="showProfessorNotifications()" style="position: relative;">
            <i class="fas fa-bell"></i> ${t('nav.notifications')}
            <span id="notif-badge" style="display: none; position: absolute; top: 5px; right: 5px; background: #ef4444; color: white; border-radius: 50%; width: 20px; height: 20px; font-size: 11px; line-height: 20px; text-align: center;"></span>
        </button>
        <button class="nav-tab" onclick="toggleTheme()" id="theme-toggle-btn" title="${t('nav.change_theme')}">
            <i class="fas fa-moon"></i>
        </button>
    </div>`;

    } else if (currentUser.role === 'surveillant') {
        tabs = `<div class="nav-tabs">
            <button class="nav-tab active" onclick="loadDashboard()">
                <i class="fas fa-tachometer-alt"></i> Dashboard
            </button>
            <button class="nav-tab" onclick="loadSurveillantExams()">
                <i class="fas fa-clipboard-list"></i> Mes Examens
            </button>
            <button class="nav-tab" onclick="toggleTheme()" id="theme-toggle-btn" title="${t('nav.change_theme')}">
                <i class="fas fa-moon"></i>
            </button>
        </div>`;
    } else {
        tabs = `<div class="nav-tabs">
            <button class="nav-tab active" onclick="loadDashboard()">
                <i class="fas fa-chart-bar"></i> ${t('nav.my_grades')}
            </button>
            <button class="nav-tab" onclick="loadOnlineExams()">
                <i class="fas fa-laptop-code"></i> ${t('nav.my_exams')}
            </button>
            <button class="nav-tab" onclick="loadMyTranscripts()">
                <i class="fas fa-file-alt"></i> ${t('nav.my_transcripts')}
            </button>
            <button class="nav-tab" onclick="loadMyReclamations()">
                <i class="fas fa-exclamation-circle"></i> ${t('nav.my_reclamations')}
            </button>
            <button class="nav-tab" onclick="loadExamSchedule()">
                <i class="fas fa-calendar-alt"></i> Planning
            </button>
            <button class="nav-tab" onclick="loadStudentHelp()">
                <i class="fas fa-question-circle"></i> Aide
            </button>
            <button class="nav-tab" onclick="toggleTheme()" id="theme-toggle-btn" title="${t('nav.change_theme')}">
                <i class="fas fa-moon"></i>
            </button>
        </div>`;
    }
    
    nav.innerHTML = tabs;
}

function setActiveTab(button) {
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    if (button) button.classList.add('active');
}

// Dashboard
async function loadDashboard() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    window._currentView = loadDashboard;
    if (currentUser.role === 'admin') await loadAdminDashboard();
    else if (currentUser.role === 'professor') await loadProfessorDashboard();
    else if (currentUser.role === 'surveillant') await loadSurveillantDashboard();
    else await loadStudentDashboard();
}

async function loadAdminDashboard() {
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/admin/dashboard');
        if (!response.ok) {
            throw new Error(await response.text());
        }
        const data = await response.json();
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-chart-line"></i> ${t('section.admin_dashboard')}</h2>
            </div>
            <div class="grid">
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-users"></i> ${t('section.total_users')}</div>
                    <div class="stat-value">${data.total_users || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-user-graduate"></i> ${t('section.total_students')}</div>
                    <div class="stat-value">${data.total_students || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-chalkboard-teacher"></i> ${t('section.total_professors')}</div>
                    <div class="stat-value">${data.total_professors || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-eye"></i> ${t('section.total_surveillants')}</div>
                    <div class="stat-value">${data.total_surveillants || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-file-alt"></i> ${t('section.total_subjects')}</div>
                    <div class="stat-value">${data.total_subjects || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-file"></i> ${t('section.total_copies')}</div>
                    <div class="stat-value">${data.total_papers || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-check-circle"></i> ${t('section.corrected_copies')}</div>
                    <div class="stat-value">${data.total_corrected_papers || 0}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-exclamation-triangle"></i> ${t('section.reclamations')}</div>
                    <div class="stat-value">${data.pending_reclamations || 0}</div>
                </div>
            </div>
            <div style="margin-top:16px;">
                <button class="btn btn-primary" onclick="loadAdminCorrectedPapers()">
                    <i class="fas fa-file-pdf"></i> ${t('section.recent_copies')}
                </button>
            </div>
        `;
    } catch (error) {
        showAlert('Impossible de charger le tableau de bord. Veuillez actualiser la page.', 'error');
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-chart-line"></i> Tableau de Bord Administrateur</h2>
            </div>
            <div class="alert alert-error">
                <i class="fas fa-exclamation-circle"></i>
                <div>Erreur de chargement des données. Veuillez vérifier la base de données ou réessayer.</div>
            </div>
        `;
    } finally {
        showLoader(false);
    }
}

async function loadProfessorDashboard() {
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/professor/dashboard');
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-chart-line"></i> ${t('section.professor_dashboard')}</h2>
                <p>${t('section.welcome')} ${currentUser.full_name}</p>
            </div>
            <div class="grid">
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-book"></i> ${t('section.my_subjects')}</div>
                    <div class="stat-value">${data.my_subjects}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label"><i class="fas fa-check-circle"></i> ${t('section.corrected_copies')}</div>
                    <div class="stat-value">${data.papers_corrected}</div>
                </div>
            </div>
            <div class="card mt-3">
                <div class="card-header">
                    <h3><i class="fas fa-rocket"></i> ${t('section.quick_actions')}</h3>
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-primary" onclick="loadCreateSubject()">
                        <i class="fas fa-plus-circle"></i> ${t('btn.create_subject_action')}
                    </button>
                    <button class="btn btn-success" onclick="loadCorrectPapers()">
                        <i class="fas fa-pencil-alt"></i> ${t('btn.correct_papers_action')}
                    </button>
                </div>
            </div>
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function loadAdminCorrectedPapers() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/admin/corrected_papers');
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        let html = `<div class="page-header">
            <h2><i class="fas fa-file-pdf"></i> ${t('nav.corrected_papers')}</h2>
        </div>`;
        if (!data.papers || data.papers.length === 0) {
            html += `<div class="alert alert-info">
                <i class="fas fa-info-circle"></i>
                <div>${t('section.no_copies_recent')}</div>
            </div>`;
        } else {
            html += `<div class="card">
                <table class="user-table">
                    <thead>
                        <tr>
                            <th><i class="fas fa-user"></i> Étudiant</th>
                            <th><i class="fas fa-envelope"></i> Email</th>
                            <th><i class="fas fa-file-alt"></i> Sujet</th>
                            <th><i class="fas fa-star"></i> Note</th>
                            <th><i class="fas fa-calendar"></i> Date</th>
                            <th><i class="fas fa-cog"></i> Actions</th>
                        </tr>
                    </thead>
                    <tbody>`;
            data.papers.forEach(p => {
                html += `<tr>
                    <td>${p.student_name}</td>
                    <td>${p.student_email}</td>
                    <td>${p.subject_title}</td>
                    <td>${p.score !== null ? p.score + '/20' : 'N/A'}</td>
                    <td>${p.corrected_at ? new Date(p.corrected_at).toLocaleString('fr-FR') : 'N/A'}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="viewPaperDetail(${p.id})">
                            <i class="fas fa-eye"></i> Détail
                        </button>
                    </td>
                </tr>`;
            });
            html += `</tbody></table></div>`;
        }
        document.getElementById('main-content').innerHTML = html;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function loadStudentDashboard() {
    showLoader(true);
    try {
        const [papersRes, onlineRes] = await Promise.all([
            authenticatedFetch('/api/student/papers'),
            authenticatedFetch('/api/student/online_results')
        ]);
        const papers  = papersRes.ok  ? await papersRes.json()  : [];
        const online  = onlineRes.ok  ? await onlineRes.json()  : [];

        const content = document.getElementById('main-content');

        // ── Stats ────────────────────────────────────────────────────────────
        const paperScores  = papers.filter(p => p.score !== null && p.score !== undefined).map(p => p.score);
        const onlineScores = online.filter(o => o.score !== null && o.score !== undefined).map(o => o.score);
        const allScores    = [...paperScores, ...onlineScores];
        const avgAll       = allScores.length ? (allScores.reduce((a,b) => a+b, 0) / allScores.length).toFixed(2) : '—';
        const avgPaper     = paperScores.length ? (paperScores.reduce((a,b) => a+b, 0) / paperScores.length).toFixed(2) : '—';
        const avgOnline    = onlineScores.length ? (onlineScores.reduce((a,b) => a+b, 0) / onlineScores.length).toFixed(2) : '—';
        const admis        = allScores.filter(s => s >= 10).length;
        const pending      = papers.filter(p => !p.score).length + online.filter(o => !o.score).length;

        const scoreColor = s => s >= 10 ? '#10b981' : '#ef4444';
        const scoreBadge = s => s !== null && s !== undefined
            ? `<span style="font-weight:700;color:${scoreColor(s)};font-size:13px;">${Number(s).toFixed(2)}/20</span>`
            : `<span style="color:#94a3b8;font-size:12px;"><i class="fas fa-clock"></i> En attente</span>`;

        const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('fr-FR', {day:'2-digit',month:'short',year:'numeric'}) : '—';

        const reclamBadge = (hasRec, recStatus) => {
            if (!hasRec) return '';
            const colors = { pending:'#f59e0b', accepted:'#10b981', rejected:'#ef4444' };
            const labels = { pending:'En cours', accepted:'Acceptée', rejected:'Rejetée' };
            const c = colors[recStatus] || '#94a3b8';
            return `<span style="font-size:10px;font-weight:700;color:${c};background:${c}22;padding:2px 7px;border-radius:99px;margin-left:6px;">${labels[recStatus]||recStatus}</span>`;
        };

        // ── Rows copies papier ───────────────────────────────────────────────
        const paperRows = papers.map(p => `
            <tr>
                <td style="font-size:13px;">
                    <i class="fas fa-file-alt" style="color:#3b82f6;margin-right:6px;"></i>
                    ${p.subject_title || '—'}
                    ${reclamBadge(p.has_reclamation, p.reclamation_status)}
                </td>
                <td><span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;">Copie</span></td>
                <td>${scoreBadge(p.score)}</td>
                <td style="font-size:12px;color:#64748b;">${fmtDate(p.corrected_at || p.created_at)}</td>
                <td>
                    ${p.score !== null && p.score !== undefined ? `
                        <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button class="btn btn-sm" onclick="exportPaperPDF(${p.id})" style="font-size:11px;padding:5px 10px;background:#3b82f6;color:white;border:none;border-radius:6px;cursor:pointer;">
                                <i class="fas fa-file-pdf"></i> PDF
                            </button>
                            ${!p.has_reclamation ? `
                            <button class="btn btn-sm" onclick="showCreateReclamationModal(${p.id})" style="font-size:11px;padding:5px 10px;background:#f59e0b;color:white;border:none;border-radius:6px;cursor:pointer;">
                                <i class="fas fa-exclamation-triangle"></i> Réclamer
                            </button>` : ''}
                        </div>
                    ` : `<span style="color:#94a3b8;font-size:12px;">—</span>`}
                </td>
            </tr>`).join('');

        // ── Rows examens en ligne ────────────────────────────────────────────
        const onlineRows = online.map(o => `
            <tr>
                <td style="font-size:13px;">
                    <i class="fas fa-laptop" style="color:#6366f1;margin-right:6px;"></i>
                    ${o.exam_title || '—'}
                    ${reclamBadge(o.has_reclamation, o.reclamation_status)}
                </td>
                <td><span style="font-size:11px;background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:99px;">${o.auto_correct ? 'IA auto' : 'En ligne'}</span></td>
                <td>${scoreBadge(o.score)}</td>
                <td style="font-size:12px;color:#64748b;">${fmtDate(o.corrected_at)}</td>
                <td>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <button class="btn btn-sm" onclick="viewMyExamResult(${o.attempt_id})" style="font-size:11px;padding:5px 10px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;">
                            <i class="fas fa-eye"></i> Voir
                        </button>
                        ${!o.has_reclamation ? `
                        <button class="btn btn-sm" onclick="showReclamationModalForAttempt(${o.attempt_id},'${(o.exam_title||'').replace(/'/g,"\\'")}')" style="font-size:11px;padding:5px 10px;background:#f59e0b;color:white;border:none;border-radius:6px;cursor:pointer;">
                            <i class="fas fa-exclamation-triangle"></i> Réclamer
                        </button>` : ''}
                    </div>
                </td>
            </tr>`).join('');

        const totalCount = papers.length + online.length;

        content.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-chart-bar"></i> Mon tableau de bord</h2>
                <p>Bienvenue, <strong>${currentUser.full_name}</strong></p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:24px;">
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:#0f172a;">${totalCount}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-file"></i> Évaluations</div>
                </div>
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:${avgAll >= 10 ? '#10b981' : avgAll === '—' ? '#94a3b8' : '#ef4444'};">${avgAll}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-star"></i> Moyenne générale /20</div>
                </div>
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:#10b981;">${admis}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-check-circle"></i> Admis (≥ 10)</div>
                </div>
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:28px;font-weight:800;color:#f59e0b;">${pending}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-hourglass-half"></i> En attente</div>
                </div>
                ${paperScores.length && onlineScores.length ? `
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:20px;font-weight:800;color:#3b82f6;">${avgPaper}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:4px;"><i class="fas fa-file-alt"></i> Moy. copies /20</div>
                </div>
                <div class="stat-card" style="text-align:center;">
                    <div style="font-size:20px;font-weight:800;color:#6366f1;">${avgOnline}</div>
                    <div style="font-size:11px;color:#64748b;margin-top:4px;"><i class="fas fa-laptop"></i> Moy. en ligne /20</div>
                </div>` : ''}
            </div>

            ${totalCount === 0 ? `
            <div class="card" style="text-align:center;padding:40px;">
                <i class="fas fa-inbox" style="font-size:48px;color:#cbd5e1;margin-bottom:16px;display:block;"></i>
                <p style="color:#94a3b8;margin:0;">Aucune évaluation pour le moment.<br>Vos notes apparaîtront ici après correction.</p>
            </div>` : `
            <div class="card">
                <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <h3 style="margin:0;"><i class="fas fa-list-alt"></i> Historique de toutes mes notes</h3>
                    <span style="font-size:12px;color:#94a3b8;">${totalCount} évaluation(s)</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Intitulé</th>
                                <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Type</th>
                                <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Note</th>
                                <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Date</th>
                                <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${paperRows}
                            ${onlineRows}
                        </tbody>
                    </table>
                </div>
            </div>`}
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// GESTION DES UTILISATEURS
// ============================================================================
async function loadUsers(searchQuery = '', niveauFilter = '') {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        // Toujours charger TOUS les utilisateurs — filtrage étudiant côté client
        const response = await authenticatedFetch('/api/admin/users');
        const users = await response.json();

        const allStudents   = users.filter(u => u.role === 'student');
        const professors    = users.filter(u => u.role === 'professor');
        const admins        = users.filter(u => u.role === 'admin');
        const surveillants  = users.filter(u => u.role === 'surveillant');

        // Filtrage étudiant : niveau + recherche (client-side)
        let students = allStudents;
        if (niveauFilter) students = students.filter(u => u.niveau === niveauFilter);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            students = students.filter(u =>
                u.full_name.toLowerCase().includes(q) ||
                (u.email || '').toLowerCase().includes(q)
            );
        }

        const niveauColors = {
            'L1': ['#eff6ff','#1d4ed8'], 'L2': ['#f0fdf4','#15803d'],
            'L3': ['#fefce8','#a16207'], 'M1': ['#fdf4ff','#7c3aed'], 'M2': ['#fff1f2','#be123c']
        };
        const niveauBadge = (n) => {
            if (!n) return '';
            const [bg, color] = niveauColors[n] || ['#f1f5f9','#475569'];
            return `<span style="background:${bg};color:${color};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${n}</span>`;
        };

        const makeRow = (user, canDelete, showNiveau = false) => {
            const initials  = user.full_name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
            const statusBadge = user.is_active
                ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#dcfce7;color:#15803d;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;"><i class="fas fa-circle" style="font-size:5px;"></i> ${t('status.active')}</span>`
                : `<span style="display:inline-flex;align-items:center;gap:4px;background:#fee2e2;color:#991b1b;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;"><i class="fas fa-circle" style="font-size:5px;"></i> ${t('status.inactive')}</span>`;
            return `
                <tr style="transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                        <div style="display:flex;align-items:center;gap:9px;">
                            <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                            <div>
                                <span style="font-size:13px;font-weight:600;color:#0f172a;">${user.full_name}</span>
                                ${showNiveau && user.niveau ? `<br><span style="font-size:11px;color:#94a3b8;">${user.email}</span>` : ''}
                            </div>
                        </div>
                    </td>
                    ${showNiveau ? `<td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">${niveauBadge(user.niveau) || '<span style="color:#94a3b8;font-size:12px;">—</span>'}</td>` : ''}
                    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${showNiveau ? '' : user.email}</td>
                    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">${statusBadge}</td>
                    <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <button onclick="showEditUserModal(${user.id})"
                                style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                                <i class="fas fa-pen-to-square"></i> ${t('btn.edit')}
                            </button>
                            ${canDelete ? `
                            <button onclick="deleteUser(${user.id})"
                                style="display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;background:#fff;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#fee2e2';this.style.color='#ef4444';this.style.borderColor='#fecaca'"
                                onmouseout="this.style.background='#fff';this.style.color='#94a3b8';this.style.borderColor='#e2e8f0'"
                                title="Supprimer">
                                <i class="fas fa-trash-can" style="font-size:11px;"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        };

        const makeTable = (list, canDelete, showNiveau = false) => `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8fafc;">
                            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Nom</th>
                            ${showNiveau ? `<th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Niveau</th>` : ''}
                            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">${showNiveau ? '' : 'Email'}</th>
                            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Statut</th>
                            <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${list.map(u => makeRow(u, canDelete, showNiveau)).join('')}</tbody>
                </table>
            </div>
        `;

        const makeSection = (title, icon, color, bg, list, canDelete, emptyMsg) => `
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px;">
                <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px;">
                    <div style="width:32px;height:32px;border-radius:8px;background:${bg};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="${icon}" style="color:${color};font-size:14px;"></i>
                    </div>
                    <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">${title}</h3>
                    <span style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;margin-left:2px;">${list.length}</span>
                </div>
                ${list.length === 0
                    ? `<p style="padding:32px 20px;text-align:center;color:#94a3b8;margin:0;font-size:13px;"><i class="fas fa-inbox" style="display:block;font-size:28px;margin-bottom:8px;"></i>${emptyMsg}</p>`
                    : makeTable(list, canDelete)}
            </div>
        `;

        document.getElementById('main-content').innerHTML = `
            <!-- En-tête + boutons -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
                <div>
                    <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-users" style="color:#3b82f6;"></i> ${t('section.users_management')}
                    </h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:13px;">${t('section.users_management_desc')}</p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button onclick="showCreateUserModal('student')"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                        <i class="fas fa-user-plus"></i> ${t('role.student')}
                    </button>
                    <button onclick="showCreateUserModal('professor')"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#f0fdf4;color:#15803d;border:1px solid #86efac;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
                        <i class="fas fa-chalkboard-user"></i> ${t('role.professor')}
                    </button>
                    <button onclick="showCreateUserModal('surveillant')"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#fde68a'" onmouseout="this.style.background='#fef3c7'">
                        <i class="fas fa-eye"></i> ${t('role.surveillant')}
                    </button>
                    <button onclick="showCreateStudentNoEmailModal()"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#faf5ff;color:#6d28d9;border:1px solid #ddd6fe;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#ede9fe'" onmouseout="this.style.background='#faf5ff'">
                        <i class="fas fa-user-slash"></i> ${t('section.without_email')}
                    </button>
                    <button onclick="showImportUsersModal()"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 14px;background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#ffedd5'" onmouseout="this.style.background='#fff7ed'">
                        <i class="fas fa-file-csv"></i> ${t('section.import_csv')}
                    </button>
                </div>
            </div>

            <!-- Compteurs -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#fffbeb;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-crown" style="color:#f59e0b;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${admins.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.counter_admins')}</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-chalkboard-user" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${professors.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.counter_professors')}</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-eye" style="color:#f59e0b;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${surveillants.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.counter_surveillants')}</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-user-graduate" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${allStudents.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.counter_students')}</p>
                    </div>
                </div>
            </div>

            ${makeSection(t('section.section_admins'), 'fas fa-crown', '#f59e0b', '#fffbeb', admins, false, t('section.no_admins'))}
            ${makeSection(t('section.section_professors'), 'fas fa-chalkboard-user', '#10b981', '#dcfce7', professors, true, t('section.no_professors'))}
            ${makeSection(t('section.section_surveillants'), 'fas fa-eye', '#f59e0b', '#fef3c7', surveillants, true, t('section.no_surveillants'))}

            <!-- Section étudiants avec recherche + filtres niveau -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px;">
                <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:32px;height:32px;border-radius:8px;background:#dbeafe;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                                <i class="fas fa-user-graduate" style="color:#3b82f6;font-size:14px;"></i>
                            </div>
                            <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">${t('section.section_students')}</h3>
                            <span id="student-count-badge" style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;">${students.length}</span>
                        </div>
                        <!-- Barre de recherche -->
                        <div style="display:flex;align-items:center;gap:8px;flex:1;max-width:340px;min-width:200px;">
                            <div style="position:relative;flex:1;">
                                <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#94a3b8;font-size:12px;pointer-events:none;"></i>
                                <input id="student-search-input" type="text" placeholder="Rechercher par nom ou email…"
                                    value="${searchQuery}"
                                    oninput="clearTimeout(window._searchTimer); window._searchTimer = setTimeout(() => loadUsers(this.value, document.querySelector('[data-niveau-active]')?.dataset.niveauActive || ''), 300)"
                                    style="width:100%;padding:7px 10px 7px 30px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;outline:none;"
                                    onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                            </div>
                        </div>
                    </div>
                    <!-- Onglets de niveau -->
                    <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap;" id="niveau-tabs">
                        ${['','L1','L2','L3','M1','M2'].map(n => {
                            const label = n || 'Tous';
                            const count = n ? allStudents.filter(s => s.niveau === n).length : allStudents.length;
                            const isActive = niveauFilter === n;
                            const [bg, color] = n ? (niveauColors[n] || ['#f1f5f9','#475569']) : ['#eff6ff','#1d4ed8'];
                            return `<button
                                data-niveau-active="${n}"
                                onclick="loadUsers(document.getElementById('student-search-input')?.value||'', '${n}')"
                                style="padding:5px 14px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer;border:2px solid ${isActive ? color : 'transparent'};background:${isActive ? bg : '#f8fafc'};color:${isActive ? color : '#64748b'};transition:all .15s;"
                                onmouseover="this.style.background='${bg}';this.style.color='${color}'"
                                onmouseout="${isActive ? '' : "this.style.background='#f8fafc';this.style.color='#64748b'"}">
                                ${label} <span style="opacity:.7;">(${count})</span>
                            </button>`;
                        }).join('')}
                    </div>
                </div>
                ${students.length === 0
                    ? `<p style="padding:32px 20px;text-align:center;color:#94a3b8;margin:0;font-size:13px;"><i class="fas fa-search" style="display:block;font-size:28px;margin-bottom:8px;"></i>${searchQuery || niveauFilter ? 'Aucun étudiant trouvé pour cette recherche.' : t('section.no_students')}</p>`
                    : makeTable(students, true, true)}
            </div>
        `;

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function showCreateUserModal(role = 'student') {
    const roleLabels = { student: t('role.student'), professor: t('role.professor'), surveillant: t('role.surveillant'), admin: t('role.admin') };
    const modalContent = `
        <h2><i class="fas fa-user-plus"></i> Créer un ${roleLabels[role] || 'Utilisateur'}</h2>
        <form id="create-user-form">
            <div class="form-group">
                <label><i class="fas fa-user"></i> Nom Complet *</label>
                <input type="text" id="new-user-name" required>
            </div>
            <div class="form-group">
                <label><i class="fas fa-envelope"></i> Email *</label>
                <input type="email" id="new-user-email" required>
            </div>
            <div class="form-group">
                <label><i class="fas fa-lock"></i> Mot de Passe *</label>
                <input type="password" id="new-user-password" required>
            </div>
            <div class="form-group">
                <label><i class="fas fa-user-tag"></i> Rôle</label>
                <select id="new-user-role" onchange="document.getElementById('new-user-niveau-group').style.display=this.value==='student'?'block':'none'">
                    <option value="student" ${role === 'student' ? 'selected' : ''}>${t('role.student')}</option>
                    <option value="professor" ${role === 'professor' ? 'selected' : ''}>${t('role.professor')}</option>
                    <option value="surveillant" ${role === 'surveillant' ? 'selected' : ''}>${t('role.surveillant')}</option>
                </select>
            </div>
            <div class="form-group" id="new-user-niveau-group" style="display:${role === 'student' ? 'block' : 'none'}">
                <label><i class="fas fa-layer-group"></i> Niveau</label>
                <select id="new-user-niveau">
                    <option value="">— Non défini —</option>
                    <option value="L1">Licence 1 (L1)</option>
                    <option value="L2">Licence 2 (L2)</option>
                    <option value="L3">Licence 3 (L3)</option>
                    <option value="M1">Master 1 (M1)</option>
                    <option value="M2">Master 2 (M2)</option>
                </select>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent);
    document.getElementById('create-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: document.getElementById('new-user-name').value,
                    email: document.getElementById('new-user-email').value,
                    password: document.getElementById('new-user-password').value,
                    role: document.getElementById('new-user-role').value,
                    niveau: document.getElementById('new-user-niveau')?.value || ''
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert("L'utilisateur a été créé avec succès.", 'success');
                closeModal();
                loadUsers();
            } else {
                showAlert(data.error || 'Impossible de créer l\'utilisateur. Vérifiez que l\'email n\'est pas déjà utilisé.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

// ============================================================================
// FONCTION MANQUANTE : MODIFIER UTILISATEUR
// ============================================================================

async function showEditUserModal(userId) {
    showLoader(true);
    try {
        // Récupérer les données de l'utilisateur
        const response = await authenticatedFetch('/api/admin/users');
        const users = await response.json();
        const user = users.find(u => u.id === userId);

        if (!user) {
            showAlert('Utilisateur introuvable. Il a peut-être été supprimé. Veuillez actualiser la liste.', 'error');
            showLoader(false);
            return;
        }

        const modalContent = `
            <h2><i class="fas fa-user-edit"></i> ${t('section.edit_user')}</h2>
            <form id="edit-user-form">
                <div class="form-group">
                    <label><i class="fas fa-user"></i> Nom Complet *</label>
                    <input type="text" id="edit-user-name" required value="${user.full_name}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-envelope"></i> Email *</label>
                    <input type="email" id="edit-user-email" required value="${user.email}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-lock"></i> ${t('section.new_password_optional')}</label>
                    <input type="password" id="edit-user-password" placeholder="Nouveau mot de passe (optionnel)">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-user-tag"></i> Rôle</label>
                    <select id="edit-user-role" onchange="document.getElementById('edit-user-niveau-group').style.display=this.value==='student'?'block':'none'">
                        <option value="student" ${user.role === 'student' ? 'selected' : ''}>${t('role.student')}</option>
                        <option value="professor" ${user.role === 'professor' ? 'selected' : ''}>${t('role.professor')}</option>
                        <option value="surveillant" ${user.role === 'surveillant' ? 'selected' : ''}>${t('role.surveillant')}</option>
                        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>${t('role.admin')}</option>
                    </select>
                </div>
                <div class="form-group" id="edit-user-niveau-group" style="display:${user.role==='student'?'block':'none'}">
                    <label><i class="fas fa-layer-group"></i> Niveau</label>
                    <select id="edit-user-niveau">
                        <option value="" ${!user.niveau ? 'selected' : ''}>— Non défini —</option>
                        <option value="L1" ${user.niveau==='L1' ? 'selected' : ''}>Licence 1 (L1)</option>
                        <option value="L2" ${user.niveau==='L2' ? 'selected' : ''}>Licence 2 (L2)</option>
                        <option value="L3" ${user.niveau==='L3' ? 'selected' : ''}>Licence 3 (L3)</option>
                        <option value="M1" ${user.niveau==='M1' ? 'selected' : ''}>Master 1 (M1)</option>
                        <option value="M2" ${user.niveau==='M2' ? 'selected' : ''}>Master 2 (M2)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-user-active" ${user.is_active ? 'checked' : ''}>
                        ${t('section.active_account')}
                    </label>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Enregistrer
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;
        
        showModal(modalContent);
        showLoader(false);

        // Gestionnaire de soumission
        document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);
            
            try {
                const updateData = {
                    full_name: document.getElementById('edit-user-name').value,
                    email: document.getElementById('edit-user-email').value,
                    role: document.getElementById('edit-user-role').value,
                    is_active: document.getElementById('edit-user-active').checked,
                    niveau: document.getElementById('edit-user-niveau')?.value || ''
                };

                // Ajouter le mot de passe seulement s'il a été rempli
                const password = document.getElementById('edit-user-password').value;
                if (password) {
                    updateData.password = password;
                }

                const response = await authenticatedFetch(`/api/admin/users/${userId}`, {
                    method: 'PUT',
                    body: JSON.stringify(updateData)
                });

                const data = await response.json();
                
                if (data.success) {
                    showAlert("Les informations de l'utilisateur ont été mises à jour avec succès.", 'success');
                    closeModal();
                    loadUsers(); // Recharger la liste
                } else {
                    showAlert(data.error || 'Impossible de modifier l\'utilisateur. L\'email est peut-être déjà utilisé.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });

    } catch (error) {
        showAlert('Impossible de charger les données de l\'utilisateur. Veuillez actualiser la page.', 'error');
        showLoader(false);
    }
}

async function deleteUser(userId) {
    if (!confirm('Confirmer la suppression?')) return;
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
        const data = await response.json();
        if (data.success) {
            showAlert("L'utilisateur a été supprimé définitivement.", 'success');
            loadUsers();
        } else {
            showAlert(data.error || 'Impossible de supprimer cet utilisateur. Il est peut-être lié à des examens ou des copies.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// GESTION DES SUJETS
// ============================================================================
async function loadSubjects() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/subjects');
        const subjects = await response.json();
        const isProfessor = currentUser.role === 'professor';
        const isAdmin     = currentUser.role === 'admin';

        if (subjects.length === 0) {
            document.getElementById('main-content').innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
                    <div>
                        <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                            <i class="fas fa-file-alt" style="color:#3b82f6;"></i> ${t('section.subjects_management')}
                        </h2>
                        <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Vos sujets d'examen et leurs barèmes générés par l'IA</p>
                    </div>
                    ${isProfessor ? `
                    <button class="btn btn-primary" onclick="loadCreateSubject()" style="border-radius:8px;padding:10px 18px;font-weight:600;">
                        <i class="fas fa-plus"></i> Nouveau Sujet
                    </button>` : ''}
                </div>
                <div style="text-align:center;padding:64px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
                    <i class="fas fa-folder-open" style="font-size:52px;color:#94a3b8;margin-bottom:18px;display:block;"></i>
                    <h3 style="color:#334155;margin:0 0 10px;">Aucun sujet disponible</h3>
                    <p style="color:#64748b;margin:0 0 24px;max-width:400px;margin-left:auto;margin-right:auto;">
                        ${isProfessor
                            ? 'Vous n\'avez pas encore créé de sujet. Créez votre premier sujet et l\'IA générera automatiquement le barème de notation.'
                            : 'Aucun sujet n\'a encore été créé sur la plateforme.'}
                    </p>
                    ${isProfessor ? `
                    <button class="btn btn-primary" onclick="loadCreateSubject()" style="padding:12px 28px;font-size:15px;border-radius:8px;font-weight:600;">
                        <i class="fas fa-plus-circle"></i> Créer mon premier sujet
                    </button>` : ''}
                </div>
            `;
            showLoader(false);
            return;
        }

        const activeCount = subjects.filter(s => s.is_active).length;

        const rows = subjects.map(s => {
            const canDelete = isAdmin || (isProfessor && s.creator_id === currentUser.id);
            const dateStr   = new Date(s.created_at).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
            const initials  = (s.creator_name || 'N/A').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
            const ecBadge   = s.ec_code
                ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;margin-top:4px;">
                       <i class="fas fa-book" style="font-size:9px;"></i> ${s.ec_code}
                   </span>`
                : '';

            return `
                <tr style="transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;max-width:320px;">
                        <p style="margin:0;font-weight:600;color:#0f172a;font-size:14px;line-height:1.4;">${s.title}</p>
                        ${ecBadge}
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:30px;height:30px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                            <span style="font-size:13px;color:#334155;">${s.creator_name || 'N/A'}</span>
                        </div>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:6px;color:#64748b;font-size:13px;">
                            <i class="fas fa-calendar-day" style="color:#94a3b8;font-size:12px;"></i>
                            ${dateStr}
                        </div>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;">
                        ${s.is_active
                            ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">
                                   <i class="fas fa-circle" style="font-size:6px;"></i> ${t('status.active')}
                               </span>`
                            : `<span style="display:inline-flex;align-items:center;gap:5px;background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">
                                   <i class="fas fa-circle" style="font-size:6px;"></i> ${t('status.inactive')}
                               </span>`}
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <button onclick="viewSubjectDetail(${s.id})"
                                style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'"
                                title="Voir les détails">
                                <i class="fas fa-eye"></i> Détails
                            </button>
                            ${canDelete ? `
                            <button onclick="deleteSubject(${s.id})"
                                style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;background:#fff;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#fee2e2';this.style.color='#ef4444';this.style.borderColor='#fecaca'"
                                onmouseout="this.style.background='#fff';this.style.color='#94a3b8';this.style.borderColor='#e2e8f0'"
                                title="Supprimer ce sujet">
                                <i class="fas fa-trash-can" style="font-size:12px;"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('main-content').innerHTML = `
            <!-- En-tête -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
                <div>
                    <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-file-alt" style="color:#3b82f6;"></i> ${t('section.subjects_management')}
                    </h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:13px;">
                        ${isProfessor ? 'Vos sujets d\'examen' : 'Tous les sujets de la plateforme'}
                    </p>
                </div>
                ${isProfessor ? `
                <button class="btn btn-primary" onclick="loadCreateSubject()" style="border-radius:8px;padding:10px 18px;font-weight:600;">
                    <i class="fas fa-plus"></i> Nouveau Sujet
                </button>` : ''}
            </div>

            <!-- Compteurs -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-file-alt" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${subjects.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">Total sujets</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-circle-check" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${activeCount}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.active_subjects')}</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-robot" style="color:#8b5cf6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${subjects.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">${t('section.generated_rubrics')}</p>
                    </div>
                </div>
            </div>

            <!-- Tableau -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                    <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-list" style="color:#64748b;font-size:13px;"></i>
                        ${t('section.subjects_list')}
                        <span style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:500;">${subjects.length}</span>
                    </h3>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">
                                    Titre du Sujet
                                </th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">
                                    Créateur
                                </th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">
                                    Date
                                </th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">
                                    Statut
                                </th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function loadMySubjects() {
    loadSubjects();
}

// ============================================================================
// UTILITAIRES
// ============================================================================
function showLoader(show) {
    document.getElementById('loader').style.display = show ? 'flex' : 'none';
}

function showAlert(message, type = 'info') {
    if (!message) return;
    const icons = {
        'info': 'fa-info-circle',
        'success': 'fa-check-circle',
        'warning': 'fa-exclamation-triangle',
        'error': 'fa-exclamation-circle'
    };
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = `
        <i class="fas ${icons[type]}"></i>
        <div>${message}</div>
    `;
    alertDiv.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 10000; min-width: 300px; max-width: 500px;';
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 5000);
}

function showModal(content, width = '600px') {
    const modal = document.getElementById('modal');
    document.getElementById('modal-body').innerHTML = content;
    modal.style.display = 'block';
    document.querySelector('.modal-content').style.maxWidth = width;
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

window.onclick = function(event) {
    if (event.target == document.getElementById('modal')) {
        closeModal();
    }
    // Close notif panel when clicking outside
    const wrapper = document.getElementById('notif-bell-wrapper');
    const panel   = document.getElementById('notif-panel');
    if (panel && panel.style.display === 'block' && wrapper && !wrapper.contains(event.target)) {
        panel.style.display = 'none';
    }
}

// Theme handling
function setTheme(theme) {
    document.body.classList.remove('theme-dark', 'theme-solar');
    if (theme === 'dark') document.body.classList.add('theme-dark');
    if (theme === 'solar') document.body.classList.add('theme-solar');
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById('theme-toggle-btn');
    
    if (body.classList.contains('theme-dark')) {
        body.classList.remove('theme-dark');
        localStorage.setItem('theme', 'light');
        if (btn) btn.innerHTML = '<i class="fas fa-moon"></i>';
    } else {
        body.classList.add('theme-dark');
        localStorage.setItem('theme', 'dark');
        if (btn) btn.innerHTML = '<i class="fas fa-sun"></i>';
    }
}

// Au chargement de l'app, appliquer le thème sauvegardé
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('theme-dark');
        const btn = document.getElementById('theme-toggle-btn');
        if (btn) btn.innerHTML = '<i class="fas fa-sun"></i>';
    }
});

// Continuation de app.js - Partie 3 (Fonctions restantes)

// ============================================================================
// CRÉATION DE SUJET
// ============================================================================
async function loadCreateSubject() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const [ecsResponse, formationsResponse] = await Promise.all([
            authenticatedFetch('/api/ecs'),
            authenticatedFetch('/api/formations')
        ]);
        const ecs = await ecsResponse.json();
        const formations = await formationsResponse.json();

        window._allEcsCreate = ecs; // cache pour le filtre dynamique

        let formationsOptions = '<option value="">— Toutes les formations —</option>';
        formations.forEach(f => {
            formationsOptions += `<option value="${f.id}">${f.name}</option>`;
        });

        const niveaux = ['L1','L2','L3','M1','M2'];
        let niveauOptions = '<option value="">— Tous les niveaux —</option>';
        niveaux.forEach(n => { niveauOptions += `<option value="${n}">${n}</option>`; });

        function buildEcsOptions(ecsList) {
            let opts = '<option value="">— Aucun (sujet indépendant) —</option>';
            ecsList.forEach(ec => {
                opts += `<option value="${ec.id}">${ec.ue_code} › ${ec.code} — ${ec.name}</option>`;
            });
            return opts;
        }

        window._filterEcsCreate = function() {
            const fid = parseInt(document.getElementById('filter-formation-create')?.value) || null;
            const niv = document.getElementById('filter-niveau-create')?.value || '';
            let filtered = window._allEcsCreate || [];
            if (fid) filtered = filtered.filter(ec => ec.formation_id === fid);
            if (niv) filtered = filtered.filter(ec => ec.formation_level === niv);
            const sel = document.getElementById('subject-ec');
            if (sel) sel.innerHTML = buildEcsOptions(filtered);
        };

        let ecsOptions = buildEcsOptions(ecs);

        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-file-circle-plus" style="color:#3b82f6;"></i> Créer un Sujet d'Examen</h2>
                <p>Déposez votre fichier — l'IA génère automatiquement le barème de notation</p>
            </div>

            <!-- Indicateur d'étapes -->
            <div style="display:flex;align-items:center;gap:0;margin-bottom:28px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px 24px;overflow-x:auto;">
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                    <div style="width:32px;height:32px;border-radius:50%;background:#3b82f6;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">1</div>
                    <span style="font-size:13px;font-weight:600;color:#0f172a;">Remplir le formulaire</span>
                </div>
                <div style="flex:1;min-width:24px;height:2px;background:#e2e8f0;margin:0 12px;"></div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                    <div style="width:32px;height:32px;border-radius:50%;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">2</div>
                    <span style="font-size:13px;color:#64748b;">Analyse IA du fichier</span>
                </div>
                <div style="flex:1;min-width:24px;height:2px;background:#e2e8f0;margin:0 12px;"></div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                    <div style="width:32px;height:32px;border-radius:50%;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">3</div>
                    <span style="font-size:13px;color:#64748b;">Barème généré automatiquement</span>
                </div>
                <div style="flex:1;min-width:24px;height:2px;background:#e2e8f0;margin:0 12px;"></div>
                <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
                    <div style="width:32px;height:32px;border-radius:50%;background:#e2e8f0;color:#64748b;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;">4</div>
                    <span style="font-size:13px;color:#64748b;">Sujet prêt à l'emploi</span>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 340px;gap:24px;align-items:start;">

                <!-- Formulaire principal -->
                <div class="card" style="border-top:3px solid #3b82f6;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                        <i class="fas fa-pen-to-square" style="color:#3b82f6;font-size:18px;"></i>
                        <h3 style="margin:0;font-size:16px;color:#0f172a;">Informations du sujet</h3>
                    </div>

                    <form id="create-subject-form">

                        <!-- Titre -->
                        <div class="form-group" style="margin-bottom:22px;">
                            <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                <i class="fas fa-heading" style="color:#3b82f6;width:16px;"></i>
                                Titre du Sujet
                                <span style="color:#ef4444;font-size:11px;margin-left:2px;">obligatoire</span>
                            </label>
                            <input type="text" id="subject-title" required
                                placeholder="Ex: Examen final — Réseaux informatiques S2"
                                style="font-size:15px;padding:12px 14px;border:2px solid #e2e8f0;border-radius:8px;width:100%;transition:border-color .2s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                            <small style="color:#64748b;margin-top:6px;display:block;">
                                <i class="fas fa-lightbulb" style="color:#f59e0b;"></i>
                                Choisissez un titre clair qui identifie la matière et le niveau
                            </small>
                        </div>

                        <!-- Filtres EC : Formation + Niveau -->
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
                            <div class="form-group" style="margin-bottom:0;">
                                <label style="font-weight:600;color:#334155;margin-bottom:6px;display:flex;align-items:center;gap:6px;font-size:13px;">
                                    <i class="fas fa-university" style="color:#3b82f6;width:14px;"></i>
                                    Filtrer par formation
                                </label>
                                <select id="ec-filter-formation"
                                    style="font-size:13px;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;width:100%;background:#fff;"
                                    onchange="filterECSelect()">
                                    ${formationsOptions}
                                </select>
                            </div>
                            <div class="form-group" style="margin-bottom:0;">
                                <label style="font-weight:600;color:#334155;margin-bottom:6px;display:flex;align-items:center;gap:6px;font-size:13px;">
                                    <i class="fas fa-layer-group" style="color:#8b5cf6;width:14px;"></i>
                                    Filtrer par niveau
                                </label>
                                <select id="ec-filter-niveau"
                                    style="font-size:13px;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;width:100%;background:#fff;"
                                    onchange="filterECSelect()">
                                    <option value="">— Tous les niveaux —</option>
                                    <option value="L1">Licence 1 (L1)</option>
                                    <option value="L2">Licence 2 (L2)</option>
                                    <option value="L3">Licence 3 (L3)</option>
                                    <option value="M1">Master 1 (M1)</option>
                                    <option value="M2">Master 2 (M2)</option>
                                </select>
                            </div>
                        </div>

                        <!-- EC -->
                        <div class="form-group" style="margin-bottom:22px;">
                            <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                <i class="fas fa-layer-group" style="color:#8b5cf6;width:16px;"></i>
                                Élément Constitutif (EC)
                                <span style="color:#94a3b8;font-size:11px;margin-left:2px;font-weight:400;">optionnel</span>
                            </label>
                            <select id="subject-ec"
                                style="font-size:14px;padding:11px 14px;border:2px solid #e2e8f0;border-radius:8px;width:100%;background:#fff;transition:border-color .2s;"
                                onfocus="this.style.borderColor='#8b5cf6'" onblur="this.style.borderColor='#e2e8f0'">
                                ${ecsOptions}
                            </select>
                            <small style="color:#64748b;margin-top:6px;display:block;">
                                <i class="fas fa-info-circle" style="color:#8b5cf6;"></i>
                                Liez ce sujet à un EC pour l'associer à votre maquette pédagogique
                            </small>
                        </div>

                        <!-- Zone de dépôt fichier -->
                        <div class="form-group" style="margin-bottom:28px;">
                            <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                <i class="fas fa-file-arrow-up" style="color:#10b981;width:16px;"></i>
                                Fichier du Sujet
                                <span style="color:#ef4444;font-size:11px;margin-left:2px;">obligatoire</span>
                            </label>

                            <label for="subject-file" id="drop-zone"
                                style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:36px 24px;border:2px dashed #cbd5e1;border-radius:12px;cursor:pointer;background:#f8fafc;transition:all .2s;text-align:center;"
                                ondragover="event.preventDefault();this.style.borderColor='#10b981';this.style.background='#f0fdf4';"
                                ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';"
                                ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';document.getElementById('subject-file').files=event.dataTransfer.files;updateDropZone(event.dataTransfer.files[0]);">
                                <i class="fas fa-cloud-arrow-up" id="drop-icon" style="font-size:40px;color:#94a3b8;"></i>
                                <div>
                                    <p id="drop-text" style="margin:0;font-weight:600;color:#475569;font-size:15px;">Glissez votre fichier ici</p>
                                    <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">ou cliquez pour parcourir</p>
                                </div>
                                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                                    <span style="background:#dbeafe;color:#1d4ed8;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">PDF</span>
                                    <span style="background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">DOCX</span>
                                    <span style="background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">TXT</span>
                                </div>
                            </label>
                            <input type="file" id="subject-file" accept=".pdf,.docx,.doc,.txt" required
                                style="display:none;"
                                onchange="updateDropZone(this.files[0])">
                            <div id="file-info" style="display:none;margin-top:10px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;display:flex;align-items:center;gap:10px;">
                                <i class="fas fa-file-check" style="color:#10b981;font-size:18px;"></i>
                                <div>
                                    <p id="file-name" style="margin:0;font-weight:600;color:#15803d;font-size:13px;"></p>
                                    <p id="file-size" style="margin:0;color:#64748b;font-size:12px;"></p>
                                </div>
                                <button type="button" onclick="clearFile()" style="margin-left:auto;background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;" title="Supprimer">
                                    <i class="fas fa-times-circle"></i>
                                </button>
                            </div>
                        </div>

                        <!-- Boutons -->
                        <div style="display:flex;gap:12px;padding-top:8px;border-top:1px solid #f1f5f9;">
                            <button type="submit" class="btn btn-primary" style="flex:1;padding:13px;font-size:15px;font-weight:600;border-radius:8px;">
                                <i class="fas fa-wand-magic-sparkles"></i> Créer le Sujet
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="loadDashboard()" style="padding:13px 20px;border-radius:8px;">
                                <i class="fas fa-times"></i> Annuler
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Panneau d'information latéral -->
                <div style="display:flex;flex-direction:column;gap:16px;">

                    <!-- Formats acceptés -->
                    <div class="card" style="border-top:3px solid #10b981;padding:20px;">
                        <h4 style="margin:0 0 14px;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-file-circle-check" style="color:#10b981;"></i> Formats acceptés
                        </h4>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8fafc;border-radius:8px;">
                                <i class="fas fa-file-pdf" style="color:#ef4444;font-size:20px;width:24px;text-align:center;"></i>
                                <div>
                                    <p style="margin:0;font-weight:600;font-size:13px;color:#334155;">PDF</p>
                                    <p style="margin:0;font-size:11px;color:#64748b;">Documents imprimés scannés ou natifs</p>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8fafc;border-radius:8px;">
                                <i class="fas fa-file-word" style="color:#2563eb;font-size:20px;width:24px;text-align:center;"></i>
                                <div>
                                    <p style="margin:0;font-weight:600;font-size:13px;color:#334155;">DOCX / DOC</p>
                                    <p style="margin:0;font-size:11px;color:#64748b;">Documents Microsoft Word</p>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;padding:10px;background:#f8fafc;border-radius:8px;">
                                <i class="fas fa-file-lines" style="color:#10b981;font-size:20px;width:24px;text-align:center;"></i>
                                <div>
                                    <p style="margin:0;font-weight:600;font-size:13px;color:#334155;">TXT</p>
                                    <p style="margin:0;font-size:11px;color:#64748b;">Texte brut</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Ce que fait l'IA -->
                    <div class="card" style="border-top:3px solid #8b5cf6;padding:20px;">
                        <h4 style="margin:0 0 14px;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-robot" style="color:#8b5cf6;"></i> Ce que fait l'IA
                        </h4>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <i class="fas fa-magnifying-glass" style="color:#8b5cf6;margin-top:2px;flex-shrink:0;"></i>
                                <p style="margin:0;font-size:13px;color:#475569;">Analyse le contenu et structure des questions</p>
                            </div>
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <i class="fas fa-scale-balanced" style="color:#8b5cf6;margin-top:2px;flex-shrink:0;"></i>
                                <p style="margin:0;font-size:13px;color:#475569;">Attribue des points à chaque question selon la difficulté</p>
                            </div>
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <i class="fas fa-list-check" style="color:#8b5cf6;margin-top:2px;flex-shrink:0;"></i>
                                <p style="margin:0;font-size:13px;color:#475569;">Génère un barème détaillé prêt à utiliser pour la correction</p>
                            </div>
                        </div>
                    </div>

                    <!-- Conseil -->
                    <div style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
                        <p style="margin:0 0 6px;font-weight:600;font-size:13px;color:#92400e;">
                            <i class="fas fa-lightbulb" style="color:#f59e0b;"></i> Conseil
                        </p>
                        <p style="margin:0;font-size:12px;color:#78350f;line-height:1.6;">
                            Pour un meilleur barème, assurez-vous que les questions sont numérotées clairement dans votre document.
                        </p>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('create-subject-form').addEventListener('submit', handleCreateSubject);

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function filterECSelect() {
    const formation = document.getElementById('ec-filter-formation')?.value || '';
    const niveau = document.getElementById('ec-filter-niveau')?.value || '';
    const select = document.getElementById('subject-ec');
    if (!select) return;
    const allECs = window._allEcsCreate || [];
    let html = '<option value="">— Aucun (sujet indépendant) —</option>';
    allECs.forEach(ec => {
        if (formation && String(ec.formation_id) !== String(formation)) return;
        if (niveau && ec.formation_level !== niveau) return;
        html += `<option value="${ec.id}" data-niveau="${ec.formation_level || ''}" data-formation="${ec.formation_id || ''}">${ec.ue_code} › ${ec.code} — ${ec.name}</option>`;
    });
    select.innerHTML = html;
}

function updateDropZone(file) {
    if (!file) return;
    const zone = document.getElementById('drop-zone');
    const icon = document.getElementById('drop-icon');
    const text = document.getElementById('drop-text');
    const info = document.getElementById('file-info');
    const nameEl = document.getElementById('file-name');
    const sizeEl = document.getElementById('file-size');

    zone.style.borderColor = '#10b981';
    zone.style.background = '#f0fdf4';
    icon.className = 'fas fa-file-check';
    icon.style.color = '#10b981';
    text.textContent = 'Fichier sélectionné';

    const sizeMb = (file.size / 1024 / 1024).toFixed(2);
    nameEl.textContent = file.name;
    sizeEl.textContent = `${sizeMb} Mo`;
    info.style.display = 'flex';
}

function clearFile() {
    document.getElementById('subject-file').value = '';
    const zone = document.getElementById('drop-zone');
    const icon = document.getElementById('drop-icon');
    const text = document.getElementById('drop-text');
    const info = document.getElementById('file-info');

    zone.style.borderColor = '#cbd5e1';
    zone.style.background = '#f8fafc';
    icon.className = 'fas fa-cloud-arrow-up';
    icon.style.color = '#94a3b8';
    text.textContent = 'Glissez votre fichier ici';
    info.style.display = 'none';
}

async function handleCreateSubject(e) {
    e.preventDefault();
    showLoader(true);
    const title = document.getElementById('subject-title').value;
    const ecId = document.getElementById('subject-ec').value;
    const fileInput = document.getElementById('subject-file');
    const file = fileInput.files[0];
    if (!file) {
        showAlert('Veuillez sélectionner un fichier', 'error');
        showLoader(false);
        return;
    }
    const formData = new FormData();
    formData.append('title', title);
    if (ecId) formData.append('ec_id', ecId);
    formData.append('file', file);
    try {
        const response = await fetch('/api/subjects/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        const data = await response.json();
        if (data.success) {
            showSubjectCreatedPreview(data.subject);
        } else {
            showAlert(data.error || 'Impossible de créer le sujet. Vérifiez le fichier (PDF, DOCX ou TXT requis) et les champs obligatoires.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function showSubjectCreatedPreview(subject) {
    const rubricHtml = (subject.rubric || '').replace(/\n/g, '<br>').replace(/══+/g, '<hr style="border-color:#3b82f6;margin:8px 0;">').replace(/──+/g, '<hr style="border-color:#e2e8f0;margin:4px 0;">');
    const contentHtml = (subject.content || '').replace(/\n/g, '<br>').replace(/══+/g, '<hr style="border-color:#3b82f6;margin:8px 0;">').replace(/──+/g, '<hr style="border-color:#e2e8f0;margin:4px 0;">');

    document.getElementById('main-content').innerHTML = `
        <div style="max-width:900px;margin:0 auto;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
                <div>
                    <h2 style="margin:0;color:#0f172a;"><i class="fas fa-check-circle" style="color:#10b981;"></i> Sujet créé avec succès</h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:14px;">Le barème de notation a été généré automatiquement par l'IA</p>
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick="loadMySubjects()">
                        <i class="fas fa-list"></i> Voir mes sujets
                    </button>
                    <button class="btn btn-primary" onclick="loadCreateSubject()">
                        <i class="fas fa-plus"></i> Créer un autre sujet
                    </button>
                </div>
            </div>

            <!-- Infos du sujet -->
            <div class="card" style="margin-bottom:20px;border-left:4px solid #3b82f6;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                    <i class="fas fa-file-alt" style="font-size:28px;color:#3b82f6;"></i>
                    <div>
                        <h3 style="margin:0;color:#0f172a;">${subject.title}</h3>
                        <small style="color:#64748b;">
                            <i class="fas fa-calendar"></i> Créé le ${new Date(subject.created_at).toLocaleString('fr-FR')}
                            &nbsp;·&nbsp;
                            <i class="fas fa-check-circle" style="color:#10b981;"></i> ${t('status.active')}
                        </small>
                    </div>
                </div>
            </div>

            <!-- Contenu du sujet -->
            <div class="card" style="margin-bottom:20px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">
                    <i class="fas fa-file-lines" style="color:#3b82f6;font-size:18px;"></i>
                    <h3 style="margin:0;font-size:16px;">Contenu du Sujet</h3>
                </div>
                <div style="max-height:350px;overflow-y:auto;padding:16px;background:#f8fafc;border-radius:8px;font-family:monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;">${subject.content || 'Contenu non disponible'}</div>
            </div>

            <!-- Barème généré -->
            <div class="card" style="border-left:4px solid #10b981;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #e2e8f0;">
                    <i class="fas fa-clipboard-list" style="color:#10b981;font-size:18px;"></i>
                    <h3 style="margin:0;font-size:16px;">Barème de Notation Généré par l'IA</h3>
                    <span style="margin-left:auto;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">
                        <i class="fas fa-robot"></i> Auto-généré
                    </span>
                </div>
                <div style="max-height:450px;overflow-y:auto;padding:16px;background:#f0fdf4;border-radius:8px;font-family:monospace;font-size:13px;line-height:1.8;white-space:pre-wrap;">${subject.rubric || 'Barème non disponible'}</div>
            </div>

            <div style="margin-top:20px;padding:16px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
                <i class="fas fa-lightbulb" style="color:#3b82f6;"></i>
                <strong style="color:#1e40af;"> Conseil :</strong>
                <span style="color:#1e40af;font-size:14px;"> Ce sujet et son barème sont maintenant disponibles pour créer un examen en ligne. Allez dans <em>Examens en ligne → Créer un examen</em> pour l'utiliser.</span>
            </div>
        </div>
    `;
}

// ============================================================================
// FONCTIONS MANQUANTES : VOIR DÉTAIL ET SUPPRIMER SUJET
// ============================================================================

async function viewSubjectDetail(subjectId) {
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/subjects/${subjectId}`);
        if (!response.ok) throw new Error('Erreur lors du chargement du sujet');
        const subject = await response.json();

        const canDelete  = currentUser.role === 'admin' || subject.creator_id === currentUser.id;
        const dateStr    = new Date(subject.created_at).toLocaleString('fr-FR');
        const initials   = (subject.creator_name || 'N').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
        const statusBadge = subject.is_active
            ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;"><i class="fas fa-circle" style="font-size:6px;"></i> ${t('status.active')}</span>`
            : `<span style="display:inline-flex;align-items:center;gap:5px;background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;"><i class="fas fa-circle" style="font-size:6px;"></i> ${t('status.inactive')}</span>`;
        const ecBadge = subject.ec_code
            ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#ede9fe;color:#6d28d9;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">
                   <i class="fas fa-book" style="font-size:10px;"></i> ${subject.ec_code} — ${subject.ec_name}
                   ${subject.ue_code ? `<span style="color:#a78bfa;">· UE ${subject.ue_code}</span>` : ''}
               </span>`
            : `<span style="color:#94a3b8;font-size:13px;"><i class="fas fa-minus" style="font-size:10px;"></i> Aucun EC associé</span>`;

        const contentHtml = (subject.content || 'Contenu non disponible').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const rubricHtml  = (subject.rubric  || 'Barème non disponible').replace(/</g,'&lt;').replace(/>/g,'&gt;');

        const modalContent = `
            <!-- En-tête modal -->
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:44px;height:44px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-file-alt" style="color:#3b82f6;font-size:18px;"></i>
                    </div>
                    <div>
                        <h2 style="margin:0;font-size:17px;color:#0f172a;font-weight:700;">${subject.title}</h2>
                        <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
                            ${statusBadge}
                            ${ecBadge}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Méta-données -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
                <div style="padding:12px 14px;background:#f8fafc;border-radius:8px;border:1px solid #f1f5f9;">
                    <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Créateur</p>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="width:26px;height:26px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">${initials}</div>
                        <span style="font-size:13px;font-weight:600;color:#334155;">${subject.creator_name || 'N/A'}</span>
                    </div>
                </div>
                <div style="padding:12px 14px;background:#f8fafc;border-radius:8px;border:1px solid #f1f5f9;">
                    <p style="margin:0 0 4px;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Date de création</p>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-calendar-day" style="color:#94a3b8;font-size:12px;"></i>
                        <span style="font-size:13px;font-weight:600;color:#334155;">${dateStr}</span>
                    </div>
                </div>
            </div>

            <!-- Onglets Contenu / Barème -->
            <div style="display:flex;border-bottom:2px solid #e2e8f0;margin-bottom:16px;gap:0;">
                <button id="sd-tab-content" onclick="switchSubjectDetailTab('content')"
                    style="padding:9px 18px;border:none;border-bottom:2px solid #3b82f6;margin-bottom:-2px;background:none;color:#3b82f6;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-file-lines"></i> Contenu du sujet
                </button>
                <button id="sd-tab-rubric" onclick="switchSubjectDetailTab('rubric')"
                    style="padding:9px 18px;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:none;color:#64748b;font-weight:600;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-clipboard-list"></i> Barème IA
                    <span style="background:#ede9fe;color:#6d28d9;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:700;">IA</span>
                </button>
            </div>

            <div id="sd-panel-content">
                <div style="max-height:280px;overflow-y:auto;padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-family:'Courier New',monospace;font-size:12.5px;line-height:1.8;color:#334155;white-space:pre-wrap;">${contentHtml}</div>
            </div>
            <div id="sd-panel-rubric" style="display:none;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;">
                    <i class="fas fa-robot" style="color:#8b5cf6;"></i>
                    <span style="font-size:12px;color:#64748b;">Barème généré automatiquement par l'IA à partir du contenu du sujet</span>
                </div>
                <div style="max-height:280px;overflow-y:auto;padding:16px;background:#faf5ff;border:1px solid #ddd6fe;border-radius:8px;font-family:'Courier New',monospace;font-size:12.5px;line-height:1.8;color:#3b0764;white-space:pre-wrap;">${rubricHtml}</div>
            </div>

            <!-- Boutons actions -->
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;flex-wrap:wrap;gap:10px;">
                <div>
                    ${canDelete ? `
                    <button onclick="closeModal();deleteSubject(${subject.id})"
                        style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#fff;color:#ef4444;border:1px solid #fecaca;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                        onmouseover="this.style.background='#fee2e2'" onmouseout="this.style.background='#fff'">
                        <i class="fas fa-trash-can"></i> Supprimer
                    </button>` : ''}
                </div>
                <button onclick="closeModal()"
                    style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;"
                    onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;

        showModal(modalContent, '760px');

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function switchSubjectDetailTab(tab) {
    const isContent = tab === 'content';
    document.getElementById('sd-panel-content').style.display = isContent ? 'block' : 'none';
    document.getElementById('sd-panel-rubric').style.display  = isContent ? 'none'  : 'block';
    const tabC = document.getElementById('sd-tab-content');
    const tabR = document.getElementById('sd-tab-rubric');
    tabC.style.color        = isContent ? '#3b82f6' : '#64748b';
    tabC.style.fontWeight   = isContent ? '700' : '600';
    tabC.style.borderBottom = isContent ? '2px solid #3b82f6' : '2px solid transparent';
    tabR.style.color        = isContent ? '#64748b' : '#8b5cf6';
    tabR.style.fontWeight   = isContent ? '600' : '700';
    tabR.style.borderBottom = isContent ? '2px solid transparent' : '2px solid #8b5cf6';
}

async function deleteSubject(subjectId) {
    showModal(`
        <div style="text-align:center;padding:8px 0;">
            <div style="width:56px;height:56px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
                <i class="fas fa-triangle-exclamation" style="font-size:24px;color:#ef4444;"></i>
            </div>
            <h3 style="margin:0 0 8px;color:#0f172a;">Supprimer ce sujet ?</h3>
            <p style="margin:0 0 6px;color:#64748b;font-size:14px;">Cette action est <strong>irréversible</strong>.</p>
            <div style="background:#fff8f8;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:16px 0;text-align:left;">
                <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#991b1b;">
                    <i class="fas fa-circle-exclamation"></i> Seront également supprimés :
                </p>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#7f1d1d;line-height:1.9;">
                    <li>Tous les examens en ligne liés à ce sujet</li>
                    <li>Toutes les copies corrigées associées</li>
                    <li>Le barème de notation généré par l'IA</li>
                </ul>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;">
                <button onclick="closeModal()"
                    style="flex:1;max-width:160px;padding:10px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
                    <i class="fas fa-times"></i> Annuler
                </button>
                <button id="confirm-delete-btn" onclick="confirmDeleteSubject(${subjectId})"
                    style="flex:1;max-width:160px;padding:10px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">
                    <i class="fas fa-trash-can"></i> Supprimer
                </button>
            </div>
        </div>
    `);
}

async function confirmDeleteSubject(subjectId) {
    const btn = document.getElementById('confirm-delete-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression…'; }
    try {
        const response = await authenticatedFetch(`/api/subjects/${subjectId}`, { method: 'DELETE' });
        const data = await response.json();
        closeModal();
        if (data.success) {
            showAlert(data.message || 'Sujet supprimé avec succès.', 'success');
            loadSubjects();
        } else {
            showAlert(data.error || 'Impossible de supprimer ce sujet. Il est peut-être utilisé dans un examen actif.', 'error');
        }
    } catch (error) {
        closeModal();
        showAlert('Impossible de supprimer ce sujet. Vérifiez votre connexion et réessayez.', 'error');
    } finally {
        showLoader(false);
    }
}

async function loadViewResults() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    
    try {
        // Récupérer les sujets du professeur
        const response = await authenticatedFetch('/api/subjects');
        const subjects = await response.json();
        
        if (subjects.length === 0) {
            document.getElementById('main-content').innerHTML = `
                <div class="page-header">
                    <h2><i class="fas fa-chart-bar"></i> Résultats et Statistiques</h2>
                </div>
                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>
                        Vous n'avez créé aucun sujet. Créez d'abord un sujet pour voir les résultats.
                        <br><br>
                        <button class="btn btn-primary" onclick="loadCreateSubject()">
                            <i class="fas fa-plus-circle"></i> Créer un Sujet
                        </button>
                    </div>
                </div>
            `;
            showLoader(false);
            return;
        }
        
        // Créer la liste des sujets avec bouton "Voir Statistiques"
        let subjectsHTML = subjects.map(s => {
            const ecInfo = s.ec_code ? `<br><small><i class="fas fa-book"></i> ${s.ec_code}: ${s.ec_name}</small>` : '';
            return `
                <tr>
                    <td>
                        <strong>${s.title}</strong>
                        ${ecInfo}
                    </td>
                    <td><i class="fas fa-calendar"></i> ${new Date(s.created_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="viewSubjectStatistics(${s.id})">
                            <i class="fas fa-chart-line"></i> Voir Statistiques
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
        
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-chart-bar"></i> Résultats et Statistiques</h2>
                <p>Consultez les statistiques détaillées de vos sujets</p>
            </div>
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-file-alt"></i> Mes Sujets</h3>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th><i class="fas fa-heading"></i> Titre</th>
                            <th><i class="fas fa-calendar"></i> Date de Création</th>
                            <th><i class="fas fa-cog"></i> Actions</th>
                        </tr>
                    </thead>
                    <tbody>${subjectsHTML}</tbody>
                </table>
            </div>
            
            <div id="statistics-container" style="margin-top: 20px; display: none;">
                <!-- Les statistiques s'afficheront ici -->
            </div>
        `;
        
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// FONCTION : AFFICHER LES STATISTIQUES D'UN SUJET
// ============================================================================

async function viewSubjectStatistics(subjectId) {
    showLoader(true);

    try {
        const response = await authenticatedFetch(`/api/statistics/${subjectId}`);
        const stats = await response.json();

        const statsContainer = document.getElementById('statistics-container');
        const hasPapers   = stats.papers   && stats.papers.length   > 0;
        const hasAttempts = stats.attempts && stats.attempts.length > 0;

        if (stats.totalStudents === 0) {
            const hasOnlineExams = stats.online_exams && stats.online_exams.length > 0;
            statsContainer.innerHTML = `
                <div class="card">
                    <div class="card-header">
                        <h3><i class="fas fa-chart-pie"></i> Statistiques — ${stats.subject_title}</h3>
                    </div>
                    <div class="alert alert-info" style="margin:16px;">
                        <i class="fas fa-info-circle"></i>
                        <div>Aucune copie corrigée pour ce sujet.
                        ${hasOnlineExams ? `<br><small>${stats.online_exams.length} examen(s) en ligne associé(s) — aucune tentative corrigée.</small>` : ''}</div>
                    </div>
                </div>`;
            statsContainer.style.display = 'block';
            showLoader(false);
            return;
        }

        const scoreColor = s => s >= 10 ? '#10b981' : '#ef4444';
        const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR') : '—';

        // ── Tableaux détail ──────────────────────────────────────────────────────
        const papersTableHTML = hasPapers ? `
            <div style="margin-top:24px;">
                <h4 style="font-size:14px;font-weight:700;color:#374151;margin-bottom:10px;">
                    <i class="fas fa-file-alt" style="color:#6366f1;margin-right:6px;"></i>Copies Papier (${stats.papers.length})
                </h4>
                <table><thead><tr>
                    <th>Étudiant</th><th>Email</th><th>Note</th><th>Corrigé le</th>
                </tr></thead><tbody>
                ${stats.papers.map(p => `<tr>
                    <td>${p.student_name}</td><td>${p.student_email}</td>
                    <td><span style="font-weight:700;color:${scoreColor(p.score)}">${p.score}/20</span></td>
                    <td>${fmtDate(p.corrected_at)}</td>
                </tr>`).join('')}
                </tbody></table>
            </div>` : '';

        const attemptsTableHTML = hasAttempts ? `
            <div style="margin-top:24px;">
                <h4 style="font-size:14px;font-weight:700;color:#374151;margin-bottom:10px;">
                    <i class="fas fa-laptop-code" style="color:#3b82f6;margin-right:6px;"></i>Examens en Ligne (${stats.attempts.length})
                </h4>
                <table><thead><tr>
                    <th>Étudiant</th><th>Email</th><th>Examen</th><th>Note</th><th>Date</th>
                </tr></thead><tbody>
                ${stats.attempts.map(a => `<tr>
                    <td>${a.student_name}</td><td>${a.student_email}</td>
                    <td style="font-size:12px;color:#64748b;">${a.exam_title}</td>
                    <td><span style="font-weight:700;color:${scoreColor(a.score)}">${a.score}/20</span></td>
                    <td>${fmtDate(a.corrected_at)}</td>
                </tr>`).join('')}
                </tbody></table>
            </div>` : '';

        statsContainer.innerHTML = `
            <div class="card" style="padding:0;">
                <div class="card-header" style="padding:16px 20px;border-bottom:1px solid #f1f5f9;">
                    <h3 style="margin:0;font-size:17px;"><i class="fas fa-chart-pie" style="color:#6366f1;margin-right:8px;"></i>${stats.subject_title}</h3>
                </div>
                <div style="padding:20px;">

                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:20px;">
                        ${[
                            ['fas fa-users','#6366f1','Total','rgba(99,102,241,.1)', stats.totalStudents],
                            ['fas fa-chart-line','#10b981','Moyenne','rgba(16,185,129,.1)', stats.averageScore+'/20'],
                            ['fas fa-sort-numeric-up','#f59e0b','Médiane','rgba(245,158,11,.1)', stats.medianScore+'/20'],
                            ['fas fa-arrow-down','#ef4444','Min','rgba(239,68,68,.1)', stats.minScore+'/20'],
                            ['fas fa-arrow-up','#3b82f6','Max','rgba(59,130,246,.1)', stats.maxScore+'/20'],
                            ['fas fa-percentage','#059669','Réussite','rgba(5,150,105,.1)', stats.passRate+'%'],
                        ].map(([icon,color,label,bg,val]) => `
                            <div style="background:white;border:1px solid #f1f5f9;border-radius:10px;padding:14px 12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.04);">
                                <div style="width:36px;height:36px;background:${bg};border-radius:9px;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">
                                    <i class="${icon}" style="color:${color};font-size:15px;"></i>
                                </div>
                                <div style="font-size:20px;font-weight:800;color:#0f172a;">${val}</div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">${label}</div>
                            </div>`).join('')}
                    </div>

                    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:4px;">
                        <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#374151;">
                            <i class="fas fa-chart-bar" style="margin-right:6px;color:#6366f1;"></i>Distribution des notes
                        </p>
                        <div style="display:flex;gap:16px;justify-content:space-around;flex-wrap:wrap;">
                            ${[['0-5','#ef4444'],['5-10','#f59e0b'],['10-15','#10b981'],['15-20','#3b82f6']].map(([r,c]) => `
                            <div style="text-align:center;">
                                <div style="font-size:28px;font-weight:800;color:${c};">${stats.scoreDistribution[r]}</div>
                                <div style="font-size:12px;color:#64748b;">${r}</div>
                            </div>`).join('')}
                        </div>
                    </div>

                    ${papersTableHTML}
                    ${attemptsTableHTML}
                </div>
            </div>`;

        statsContainer.style.display = 'block';
        statsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}
// ============================================================================
// CORRECTION DE COPIES
// ============================================================================
async function loadCorrectPapers() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const subjectsResponse = await authenticatedFetch('/api/subjects');
        const subjects = await subjectsResponse.json();

        if (subjects.length === 0) {
            document.getElementById('main-content').innerHTML = `
                <div class="page-header">
                    <h2><i class="fas fa-pen-ruler" style="color:#3b82f6;"></i> Corriger des Copies</h2>
                    <p>Correction automatique avec IA</p>
                </div>
                <div style="text-align:center;padding:60px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
                    <i class="fas fa-file-circle-exclamation" style="font-size:56px;color:#94a3b8;margin-bottom:20px;display:block;"></i>
                    <h3 style="color:#334155;margin-bottom:10px;">Aucun sujet disponible</h3>
                    <p style="color:#64748b;margin-bottom:24px;max-width:420px;margin-left:auto;margin-right:auto;">
                        Vous devez d'abord créer un sujet d'examen avant de pouvoir corriger des copies.
                        L'IA se basera sur ce sujet pour évaluer les copies de vos étudiants.
                    </p>
                    <button class="btn btn-primary" style="padding:12px 28px;font-size:15px;" onclick="loadCreateSubject()">
                        <i class="fas fa-plus-circle"></i> Créer un Sujet d'Examen
                    </button>
                </div>
            `;
            showLoader(false);
            return;
        }

        const subjectsOptions = subjects.map(s => {
            const ecInfo = s.ec_code ? ` — ${s.ec_code}` : '';
            return `<option value="${s.id}">${s.title}${ecInfo}</option>`;
        }).join('');

        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                    <div>
                        <h2 style="margin:0;"><i class="fas fa-pen-ruler" style="color:#3b82f6;"></i> Corriger des Copies</h2>
                        <p style="margin:4px 0 0;color:#64748b;">L'IA analyse chaque copie et attribue une note avec un feedback détaillé</p>
                    </div>
                    <span style="background:#ede9fe;color:#6d28d9;padding:6px 14px;border-radius:99px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-robot"></i> Correction par IA
                    </span>
                </div>
            </div>

            <!-- Sélecteur de mode -->
            <div style="display:flex;gap:0;margin-bottom:24px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                <button id="tab-single" onclick="switchCorrectionTab('single')"
                    style="flex:1;padding:14px 20px;border:none;background:#3b82f6;color:#fff;font-weight:600;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;">
                    <i class="fas fa-user"></i> Copie Individuelle
                </button>
                <button id="tab-batch" onclick="switchCorrectionTab('batch')"
                    style="flex:1;padding:14px 20px;border:none;background:#f8fafc;color:#64748b;font-weight:600;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;transition:all .2s;">
                    <i class="fas fa-layer-group"></i> Lot de Copies
                    <span style="background:#e2e8f0;color:#475569;padding:1px 8px;border-radius:99px;font-size:11px;">${subjects.length > 0 ? 'Plusieurs fichiers' : ''}</span>
                </button>
            </div>

            <div style="display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start;">

                <!-- ── PANNEAU COPIE INDIVIDUELLE ── -->
                <div id="panel-single">
                    <div class="card" style="border-top:3px solid #3b82f6;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                            <i class="fas fa-user-graduate" style="color:#3b82f6;font-size:18px;"></i>
                            <h3 style="margin:0;font-size:16px;color:#0f172a;">Correction d'une Seule Copie</h3>
                        </div>
                        <form id="single-correction-form">

                            <div class="form-group" style="margin-bottom:20px;">
                                <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                    <i class="fas fa-file-alt" style="color:#3b82f6;width:16px;"></i> Sujet d'Examen
                                    <span style="color:#ef4444;font-size:11px;">obligatoire</span>
                                </label>
                                <select id="single-subject" required
                                    style="font-size:14px;padding:11px 14px;border:2px solid #e2e8f0;border-radius:8px;width:100%;background:#fff;transition:border-color .2s;"
                                    onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                                    <option value="">— Choisir un sujet —</option>
                                    ${subjectsOptions}
                                </select>
                            </div>

                            <div class="form-group" style="margin-bottom:20px;">
                                <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                    <i class="fas fa-user" style="color:#8b5cf6;width:16px;"></i> Nom de l'Étudiant
                                    <span style="color:#ef4444;font-size:11px;">obligatoire</span>
                                </label>
                                <input type="text" id="single-student-name" required
                                    placeholder="Ex: Amadou Diallo"
                                    style="font-size:15px;padding:12px 14px;border:2px solid #e2e8f0;border-radius:8px;width:100%;transition:border-color .2s;"
                                    onfocus="this.style.borderColor='#8b5cf6'" onblur="this.style.borderColor='#e2e8f0'">
                            </div>

                            <div class="form-group" style="margin-bottom:28px;">
                                <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                    <i class="fas fa-file-arrow-up" style="color:#10b981;width:16px;"></i> Copie de l'Étudiant
                                    <span style="color:#ef4444;font-size:11px;">obligatoire</span>
                                </label>
                                <label for="single-paper-file" id="single-drop-zone"
                                    style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 20px;border:2px dashed #cbd5e1;border-radius:12px;cursor:pointer;background:#f8fafc;transition:all .2s;text-align:center;"
                                    ondragover="event.preventDefault();this.style.borderColor='#10b981';this.style.background='#f0fdf4';"
                                    ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';"
                                    ondrop="event.preventDefault();this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';document.getElementById('single-paper-file').files=event.dataTransfer.files;updateSingleDropZone(event.dataTransfer.files[0]);">
                                    <i class="fas fa-cloud-arrow-up" id="single-drop-icon" style="font-size:36px;color:#94a3b8;"></i>
                                    <div>
                                        <p id="single-drop-text" style="margin:0;font-weight:600;color:#475569;font-size:14px;">Glissez la copie ici</p>
                                        <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">ou cliquez pour parcourir</p>
                                    </div>
                                    <div style="display:flex;gap:6px;">
                                        <span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">PDF</span>
                                        <span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">DOCX</span>
                                        <span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">TXT</span>
                                    </div>
                                </label>
                                <input type="file" id="single-paper-file" accept=".pdf,.docx,.doc,.txt" required
                                    style="display:none;" onchange="updateSingleDropZone(this.files[0])">
                                <div id="single-file-info" style="display:none;margin-top:10px;padding:10px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;align-items:center;gap:10px;">
                                    <i class="fas fa-file-check" style="color:#10b981;font-size:18px;flex-shrink:0;"></i>
                                    <div style="flex:1;min-width:0;">
                                        <p id="single-file-name" style="margin:0;font-weight:600;color:#15803d;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></p>
                                        <p id="single-file-size" style="margin:0;color:#64748b;font-size:12px;"></p>
                                    </div>
                                    <button type="button" onclick="clearSingleFile()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;flex-shrink:0;" title="Supprimer">
                                        <i class="fas fa-times-circle"></i>
                                    </button>
                                </div>
                            </div>

                            <div style="display:flex;gap:12px;padding-top:8px;border-top:1px solid #f1f5f9;">
                                <button type="submit" class="btn btn-primary" style="flex:1;padding:13px;font-size:15px;font-weight:600;border-radius:8px;">
                                    <i class="fas fa-wand-magic-sparkles"></i> Corriger cette Copie
                                </button>
                                <button type="button" class="btn btn-secondary" onclick="loadCorrectPapers()" style="padding:13px 18px;border-radius:8px;">
                                    <i class="fas fa-redo"></i>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- ── PANNEAU LOT DE COPIES ── -->
                <div id="panel-batch" style="display:none;">
                    <div class="card" style="border-top:3px solid #10b981;">
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                            <i class="fas fa-layer-group" style="color:#10b981;font-size:18px;"></i>
                            <h3 style="margin:0;font-size:16px;color:#0f172a;">Correction en Lot</h3>
                            <span style="margin-left:auto;background:#dcfce7;color:#15803d;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">Plusieurs copies à la fois</span>
                        </div>
                        <form id="batch-correction-form">

                            <div class="form-group" style="margin-bottom:20px;">
                                <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                    <i class="fas fa-file-alt" style="color:#10b981;width:16px;"></i> Sujet d'Examen
                                    <span style="color:#ef4444;font-size:11px;">obligatoire</span>
                                </label>
                                <select id="batch-subject" required
                                    style="font-size:14px;padding:11px 14px;border:2px solid #e2e8f0;border-radius:8px;width:100%;background:#fff;transition:border-color .2s;"
                                    onfocus="this.style.borderColor='#10b981'" onblur="this.style.borderColor='#e2e8f0'">
                                    <option value="">— Choisir un sujet —</option>
                                    ${subjectsOptions}
                                </select>
                            </div>

                            <div class="form-group" style="margin-bottom:20px;">
                                <label style="font-weight:600;color:#334155;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                                    <i class="fas fa-folder-open" style="color:#f59e0b;width:16px;"></i> Copies des Étudiants
                                    <span style="color:#ef4444;font-size:11px;">obligatoire</span>
                                </label>
                                <label for="batch-papers-files" id="batch-drop-zone"
                                    style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:36px 20px;border:2px dashed #cbd5e1;border-radius:12px;cursor:pointer;background:#f8fafc;transition:all .2s;text-align:center;"
                                    ondragover="event.preventDefault();this.style.borderColor='#f59e0b';this.style.background='#fffbeb';"
                                    ondragleave="this.style.borderColor='#cbd5e1';this.style.background='#f8fafc';">
                                    <i class="fas fa-folder-arrow-up" id="batch-drop-icon" style="font-size:40px;color:#94a3b8;"></i>
                                    <div>
                                        <p id="batch-drop-text" style="margin:0;font-weight:600;color:#475569;font-size:14px;">Glissez un dossier de copies ici</p>
                                        <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">ou cliquez pour sélectionner un dossier</p>
                                    </div>
                                    <div style="display:flex;gap:6px;">
                                        <span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">PDF</span>
                                        <span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">DOCX</span>
                                        <span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">TXT</span>
                                    </div>
                                </label>
                                <input type="file" id="batch-papers-files" accept=".pdf,.docx,.doc,.txt" multiple required webkitdirectory directory
                                    style="display:none;" onchange="updateBatchDropZone(this.files)">
                                <div id="batch-file-info" style="display:none;margin-top:10px;padding:12px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;align-items:center;gap:10px;">
                                    <i class="fas fa-folder-check" style="color:#f59e0b;font-size:20px;flex-shrink:0;"></i>
                                    <div style="flex:1;">
                                        <p id="batch-file-count" style="margin:0;font-weight:600;color:#92400e;font-size:13px;"></p>
                                        <p id="batch-file-names" style="margin:2px 0 0;color:#78350f;font-size:12px;"></p>
                                    </div>
                                    <button type="button" onclick="clearBatchFiles()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:16px;flex-shrink:0;">
                                        <i class="fas fa-times-circle"></i>
                                    </button>
                                </div>
                            </div>

                            <div class="form-group" style="margin-bottom:24px;">
                                <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:14px;background:#f8fafc;border:2px solid #e2e8f0;border-radius:8px;transition:border-color .2s;"
                                    onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='#e2e8f0'">
                                    <input type="checkbox" id="batch-auto-extract" checked style="width:16px;height:16px;margin-top:2px;accent-color:#3b82f6;flex-shrink:0;">
                                    <div>
                                        <p style="margin:0;font-weight:600;color:#334155;font-size:13px;">
                                            <i class="fas fa-wand-magic-sparkles" style="color:#8b5cf6;"></i>
                                            Extraction automatique des noms
                                        </p>
                                        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">
                                            L'IA extrait le nom de l'étudiant depuis chaque copie et envoie un email de résultat si son adresse est connue
                                        </p>
                                    </div>
                                </label>
                            </div>

                            <div style="padding:12px 14px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;margin-bottom:20px;font-size:12px;color:#15803d;">
                                <i class="fas fa-lightbulb" style="color:#10b981;"></i>
                                <strong>Astuce :</strong> Nommez vos fichiers avec le nom de l'étudiant
                                (ex: <code>copie_amadou_diallo.pdf</code>) pour faciliter l'identification.
                            </div>

                            <div style="display:flex;gap:12px;padding-top:8px;border-top:1px solid #f1f5f9;">
                                <button type="submit" class="btn btn-success" style="flex:1;padding:13px;font-size:15px;font-weight:600;border-radius:8px;">
                                    <i class="fas fa-wand-magic-sparkles"></i> Corriger Toutes les Copies
                                </button>
                                <button type="button" class="btn btn-secondary" onclick="loadCorrectPapers()" style="padding:13px 18px;border-radius:8px;">
                                    <i class="fas fa-redo"></i>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- Panneau latéral -->
                <div style="display:flex;flex-direction:column;gap:16px;">

                    <div class="card" style="border-top:3px solid #8b5cf6;padding:20px;">
                        <h4 style="margin:0 0 14px;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-robot" style="color:#8b5cf6;"></i> Comment ça marche
                        </h4>
                        <div style="display:flex;flex-direction:column;gap:12px;">
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <div style="width:22px;height:22px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">1</div>
                                <p style="margin:0;font-size:12px;color:#475569;">Sélectionnez le sujet d'examen de référence</p>
                            </div>
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <div style="width:22px;height:22px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">2</div>
                                <p style="margin:0;font-size:12px;color:#475569;">Déposez la copie (ou le dossier de copies)</p>
                            </div>
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <div style="width:22px;height:22px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">3</div>
                                <p style="margin:0;font-size:12px;color:#475569;">L'IA compare la copie au barème et attribue une note /20</p>
                            </div>
                            <div style="display:flex;gap:10px;align-items:flex-start;">
                                <div style="width:22px;height:22px;border-radius:50%;background:#8b5cf6;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">4</div>
                                <p style="margin:0;font-size:12px;color:#475569;">Un feedback détaillé et un PDF sont générés automatiquement</p>
                            </div>
                        </div>
                    </div>

                    <div class="card" style="border-top:3px solid #f59e0b;padding:20px;">
                        <h4 style="margin:0 0 12px;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:8px;">
                            <i class="fas fa-circle-info" style="color:#f59e0b;"></i> Quand utiliser chaque mode ?
                        </h4>
                        <div style="display:flex;flex-direction:column;gap:10px;">
                            <div style="padding:10px;background:#eff6ff;border-radius:8px;">
                                <p style="margin:0 0 4px;font-weight:600;font-size:12px;color:#1d4ed8;"><i class="fas fa-user"></i> Copie individuelle</p>
                                <p style="margin:0;font-size:11px;color:#475569;">Pour corriger une copie spécifique ou tester le système</p>
                            </div>
                            <div style="padding:10px;background:#f0fdf4;border-radius:8px;">
                                <p style="margin:0 0 4px;font-weight:600;font-size:12px;color:#15803d;"><i class="fas fa-layer-group"></i> Lot de copies</p>
                                <p style="margin:0;font-size:11px;color:#475569;">Pour corriger toute une classe en une seule opération — gain de temps maximum</p>
                            </div>
                        </div>
                    </div>

                    <div style="padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
                        <p style="margin:0 0 6px;font-weight:600;font-size:12px;color:#991b1b;">
                            <i class="fas fa-triangle-exclamation" style="color:#ef4444;"></i> À savoir
                        </p>
                        <p style="margin:0;font-size:11px;color:#7f1d1d;line-height:1.6;">
                            La correction peut prendre quelques secondes par copie selon la longueur du document. Ne fermez pas la page pendant le traitement.
                        </p>
                    </div>
                </div>
            </div>

            <!-- Zone de résultats -->
            <div id="correction-results" style="display:none;margin-top:24px;">
                <div id="correction-results-content"></div>
            </div>
        `;

        document.getElementById('single-correction-form').addEventListener('submit', handleSingleCorrection);
        document.getElementById('batch-correction-form').addEventListener('submit', handleBatchCorrection);

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function switchCorrectionTab(tab) {
    const single = document.getElementById('panel-single');
    const batch  = document.getElementById('panel-batch');
    const tabS   = document.getElementById('tab-single');
    const tabB   = document.getElementById('tab-batch');

    if (tab === 'single') {
        single.style.display = 'block';
        batch.style.display  = 'none';
        tabS.style.background = '#3b82f6'; tabS.style.color = '#fff';
        tabB.style.background = '#f8fafc'; tabB.style.color = '#64748b';
    } else {
        single.style.display = 'none';
        batch.style.display  = 'block';
        tabS.style.background = '#f8fafc'; tabS.style.color = '#64748b';
        tabB.style.background = '#10b981'; tabB.style.color = '#fff';
    }
}

function updateSingleDropZone(file) {
    if (!file) return;
    const zone = document.getElementById('single-drop-zone');
    const icon = document.getElementById('single-drop-icon');
    const text = document.getElementById('single-drop-text');
    const info = document.getElementById('single-file-info');
    zone.style.borderColor = '#10b981'; zone.style.background = '#f0fdf4';
    icon.className = 'fas fa-file-check'; icon.style.color = '#10b981';
    text.textContent = 'Fichier sélectionné';
    document.getElementById('single-file-name').textContent = file.name;
    document.getElementById('single-file-size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' Mo';
    info.style.display = 'flex';
}

function clearSingleFile() {
    document.getElementById('single-paper-file').value = '';
    const zone = document.getElementById('single-drop-zone');
    const icon = document.getElementById('single-drop-icon');
    const text = document.getElementById('single-drop-text');
    zone.style.borderColor = '#cbd5e1'; zone.style.background = '#f8fafc';
    icon.className = 'fas fa-cloud-arrow-up'; icon.style.color = '#94a3b8';
    text.textContent = 'Glissez la copie ici';
    document.getElementById('single-file-info').style.display = 'none';
}

function updateBatchDropZone(files) {
    if (!files || files.length === 0) return;
    const zone  = document.getElementById('batch-drop-zone');
    const icon  = document.getElementById('batch-drop-icon');
    const text  = document.getElementById('batch-drop-text');
    const info  = document.getElementById('batch-file-info');
    zone.style.borderColor = '#f59e0b'; zone.style.background = '#fffbeb';
    icon.className = 'fas fa-folder-check'; icon.style.color = '#f59e0b';
    text.textContent = `${files.length} fichier(s) sélectionné(s)`;
    document.getElementById('batch-file-count').textContent = `${files.length} copie(s) prête(s) à corriger`;
    const names = Array.from(files).slice(0, 3).map(f => f.name).join(', ');
    document.getElementById('batch-file-names').textContent = files.length > 3 ? names + ` … et ${files.length - 3} autre(s)` : names;
    info.style.display = 'flex';
}

function clearBatchFiles() {
    document.getElementById('batch-papers-files').value = '';
    const zone = document.getElementById('batch-drop-zone');
    const icon = document.getElementById('batch-drop-icon');
    const text = document.getElementById('batch-drop-text');
    zone.style.borderColor = '#cbd5e1'; zone.style.background = '#f8fafc';
    icon.className = 'fas fa-folder-arrow-up'; icon.style.color = '#94a3b8';
    text.textContent = 'Glissez un dossier de copies ici';
    document.getElementById('batch-file-info').style.display = 'none';
}

async function handleSingleCorrection(e) {
    e.preventDefault();
    showLoader(true);
    
    const subjectId = document.getElementById('single-subject').value;
    const studentName = document.getElementById('single-student-name').value;
    const fileInput = document.getElementById('single-paper-file');
    const file = fileInput.files[0];
    
    if (!subjectId || !studentName || !file) {
        showAlert('Veuillez remplir tous les champs', 'error');
        showLoader(false);
        return;
    }
    
    const formData = new FormData();
    formData.append('subject_id', subjectId);
    formData.append('student_name', studentName);
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/papers/correct', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            const scoreColor = data.paper.score >= 10 ? '#10b981' : '#ef4444';
            const scoreBg    = data.paper.score >= 10 ? '#dcfce7' : '#fee2e2';
            const mention    = data.paper.score >= 16 ? 'Très Bien' : data.paper.score >= 14 ? 'Bien' : data.paper.score >= 12 ? 'Assez Bien' : data.paper.score >= 10 ? 'Passable' : 'Insuffisant';
            const feedbackHtml = (data.paper.feedback || '').replace(/\n/g, '<br>');

            const resultsContainer = document.getElementById('correction-results');
            const resultsContent   = document.getElementById('correction-results-content');

            resultsContent.innerHTML = `
                <div class="card" style="border-top:3px solid ${scoreColor};margin-bottom:0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex;align-items:center;gap:14px;">
                            <div style="width:48px;height:48px;border-radius:50%;background:${scoreBg};display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-check-circle" style="font-size:24px;color:${scoreColor};"></i>
                            </div>
                            <div>
                                <h3 style="margin:0;color:#0f172a;">Correction terminée</h3>
                                <p style="margin:2px 0 0;color:#64748b;font-size:13px;">${data.paper.subject_title}</p>
                            </div>
                        </div>
                        <div style="display:flex;gap:10px;">
                            <button class="btn btn-primary" onclick="exportPaperPDF(${data.paper.id})" style="border-radius:8px;">
                                <i class="fas fa-file-pdf"></i> Télécharger PDF
                            </button>
                            <button class="btn btn-secondary" onclick="document.getElementById('correction-results').style.display='none'" style="border-radius:8px;">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;">
                        <div style="padding:16px;background:#f8fafc;border-radius:10px;text-align:center;">
                            <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Étudiant</p>
                            <p style="margin:0;font-weight:700;font-size:15px;color:#0f172a;">${data.paper.student_name}</p>
                        </div>
                        <div style="padding:16px;background:${scoreBg};border-radius:10px;text-align:center;">
                            <p style="margin:0 0 4px;font-size:12px;color:${scoreColor};text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Note</p>
                            <p style="margin:0;font-weight:800;font-size:28px;color:${scoreColor};">${data.paper.score}<span style="font-size:14px;font-weight:500;">/20</span></p>
                        </div>
                        <div style="padding:16px;background:#f8fafc;border-radius:10px;text-align:center;">
                            <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;">Mention</p>
                            <p style="margin:0;font-weight:700;font-size:15px;color:#0f172a;">${mention}</p>
                        </div>
                    </div>

                    <div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                            <i class="fas fa-comment-dots" style="color:#8b5cf6;"></i>
                            <h4 style="margin:0;font-size:14px;color:#0f172a;">Feedback détaillé de l'IA</h4>
                        </div>
                        <div style="padding:16px;background:#f8fafc;border-radius:8px;font-size:13px;line-height:1.8;color:#334155;max-height:320px;overflow-y:auto;">${feedbackHtml}</div>
                    </div>
                </div>
            `;

            resultsContainer.style.display = 'block';
            resultsContainer.scrollIntoView({ behavior: 'smooth' });
            document.getElementById('single-correction-form').reset();
            clearSingleFile();
            
        } else {
            showAlert(data.error || 'Impossible de corriger la copie. Vérifiez que le sujet sélectionné a un barème valide.', 'error');
        }
    } catch (error) {
        showAlert('Impossible de corriger la copie. Vérifiez votre connexion et réessayez.', 'error');
    } finally {
        showLoader(false);
    }
}

async function handleBatchCorrection(e) {
    e.preventDefault();

    // Récupérer éléments du DOM (IDs utilisés dans loadCorrectPapers)
    const subjectId = document.getElementById('batch-subject') ? document.getElementById('batch-subject').value : '';
    const filesInput = document.getElementById('batch-papers-files');
    const autoExtractElem = document.getElementById('batch-auto-extract');

    if (!filesInput) {
        showAlert('Erreur technique : formulaire incomplet. Veuillez actualiser la page et réessayer.', 'error');
        return;
    }

    const files = filesInput.files;
    if (!subjectId) {
        showAlert('Veuillez sélectionner un sujet', 'warning');
        return;
    }
    if (!files || files.length === 0) {
        showAlert('Veuillez sélectionner au moins un fichier', 'error');
        return;
    }

    showLoader(true);
    showAlert(`Correction de ${files.length} copie(s) en cours... Veuillez patienter.`, 'info');

    const formData = new FormData();
    formData.append('subject_id', subjectId);
    const autoExtract = autoExtractElem ? (autoExtractElem.checked ? '1' : '0') : '0';
    formData.append('auto_extract', autoExtract);

    for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
    }

    try {
        // IMPORTANT: ne pas utiliser authenticatedFetch car il ajoute 'Content-Type: application/json'
        // qui casse l'envoi de FormData (boundary). Utiliser fetch et ajouter manuellement l'Authorization.
        const response = await fetch('/api/papers/upload-batch', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });

        // essayer d'extraire JSON si possible
        let data = {};
        try { data = await response.json(); } catch (e) { /* ignore */ }

        if (response.ok && data.success) {
            const corrected = data.corrected || 0;
            const errors    = data.errors || 0;
            const total     = corrected + errors;
            const avg       = data.results && data.results.length > 0
                ? (data.results.filter(r => typeof r.score === 'number').reduce((a, r) => a + r.score, 0) /
                   data.results.filter(r => typeof r.score === 'number').length).toFixed(1)
                : null;

            let resultsHTML = `
                <div class="card" style="border-top:3px solid #10b981;margin-bottom:0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="width:44px;height:44px;border-radius:50%;background:#dcfce7;display:flex;align-items:center;justify-content:center;">
                                <i class="fas fa-layer-group" style="font-size:20px;color:#10b981;"></i>
                            </div>
                            <div>
                                <h3 style="margin:0;color:#0f172a;">Correction en lot terminée</h3>
                                <p style="margin:2px 0 0;color:#64748b;font-size:13px;">${total} copie(s) traitée(s)</p>
                            </div>
                        </div>
                        <button class="btn btn-secondary" onclick="document.getElementById('correction-results').style.display='none'" style="border-radius:8px;">
                            <i class="fas fa-times"></i> Fermer
                        </button>
                    </div>

                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px;">
                        <div style="padding:14px;background:#dcfce7;border-radius:10px;text-align:center;">
                            <p style="margin:0 0 2px;font-size:11px;color:#15803d;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Corrigées</p>
                            <p style="margin:0;font-weight:800;font-size:26px;color:#15803d;">${corrected}</p>
                        </div>
                        ${avg !== null ? `
                        <div style="padding:14px;background:#eff6ff;border-radius:10px;text-align:center;">
                            <p style="margin:0 0 2px;font-size:11px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Moyenne</p>
                            <p style="margin:0;font-weight:800;font-size:26px;color:#1d4ed8;">${avg}<span style="font-size:13px;font-weight:500;">/20</span></p>
                        </div>` : '<div></div>'}
                        <div style="padding:14px;background:${errors > 0 ? '#fee2e2' : '#f8fafc'};border-radius:10px;text-align:center;">
                            <p style="margin:0 0 2px;font-size:11px;color:${errors > 0 ? '#991b1b' : '#64748b'};text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Erreurs</p>
                            <p style="margin:0;font-weight:800;font-size:26px;color:${errors > 0 ? '#ef4444' : '#94a3b8'};">${errors}</p>
                        </div>
                    </div>
            `;

            if (data.results && data.results.length > 0) {
                resultsHTML += `
                    <div style="overflow-x:auto;border-radius:8px;border:1px solid #e2e8f0;">
                        <table style="width:100%;border-collapse:collapse;">
                            <thead>
                                <tr style="background:#f8fafc;">
                                    <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Fichier</th>
                                    <th style="padding:10px 14px;text-align:left;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Étudiant</th>
                                    <th style="padding:10px 14px;text-align:center;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Note</th>
                                    <th style="padding:10px 14px;text-align:center;font-size:12px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Statut</th>
                                </tr>
                            </thead>
                            <tbody>
                `;
                data.results.forEach((result, i) => {
                    const sc = typeof result.score === 'number';
                    const scoreColor = sc && result.score >= 10 ? '#10b981' : '#ef4444';
                    const bg = i % 2 === 0 ? '#fff' : '#fafafa';
                    resultsHTML += `
                        <tr style="background:${bg};">
                            <td style="padding:10px 14px;font-size:13px;color:#475569;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${result.filename}</td>
                            <td style="padding:10px 14px;font-size:13px;font-weight:600;color:#0f172a;">${result.student_name || '—'}</td>
                            <td style="padding:10px 14px;text-align:center;">
                                ${sc ? `<span style="font-weight:700;font-size:15px;color:${scoreColor};">${result.score}/20</span>` : '<span style="color:#94a3b8;font-size:13px;">—</span>'}
                            </td>
                            <td style="padding:10px 14px;text-align:center;">
                                ${result.error
                                    ? `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">Erreur</span>`
                                    : `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">✓ Corrigée</span>`}
                            </td>
                        </tr>
                    `;
                });
                resultsHTML += `</tbody></table></div>`;
            }

            if (errors > 0 && data.error_details && data.error_details.length > 0) {
                resultsHTML += `
                    <div style="margin-top:16px;padding:14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
                        <p style="margin:0 0 8px;font-weight:600;font-size:13px;color:#991b1b;">
                            <i class="fas fa-triangle-exclamation"></i> ${errors} erreur(s) rencontrée(s)
                        </p>
                        <ul style="margin:0;padding-left:20px;font-size:12px;color:#7f1d1d;line-height:1.8;">
                            ${data.error_details.map(e => `<li>${e}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }

            resultsHTML += `</div>`;

            const resultsCard    = document.getElementById('correction-results');
            const resultsContent = document.getElementById('correction-results-content');
            if (resultsContent) {
                resultsContent.innerHTML = resultsHTML;
                resultsCard.style.display = 'block';
                resultsCard.scrollIntoView({ behavior: 'smooth' });
            }

            document.getElementById('batch-correction-form').reset();
            clearBatchFiles();
        } else {
            // message d'erreur serveur
            const errMsg = (data && (data.error || data.message)) ? (data.error || data.message) : `Erreur serveur (${response.status})`;
            showAlert('Impossible de corriger les copies : ' + errMsg, 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// RÉCLAMATIONS
// ============================================================================
async function loadSecurityReport() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    window._currentView = loadSecurityReport;
    showLoader(true);
    try {
        const res  = await authenticatedFetch('/api/admin/security_report');
        const data = await res.json();
        if (data.error) { showAlert(data.error, 'error'); return; }

        const evtRows = (data.event_summary || []).map(e => {
            const icons = {
                no_face_detected:       'fa-eye-slash',
                window_blur:            'fa-window-restore',
                tab_switch:             'fa-exchange-alt',
                copy_attempt:           'fa-copy',
                paste_attempt:          'fa-paste',
                right_click:            'fa-mouse-pointer',
                multiple_faces:         'fa-users',
                face_reference_captured:'fa-camera',
                screen_share_stopped:   'fa-desktop',
                student_message:        'fa-comment'
            };
            const riskColors = {
                no_face_detected: '#f59e0b',
                tab_switch: '#ef4444',
                window_blur: '#f97316',
                copy_attempt: '#ef4444',
                paste_attempt: '#ef4444',
                multiple_faces: '#dc2626'
            };
            const ic = icons[e.event] || 'fa-circle';
            const cl = riskColors[e.event] || '#94a3b8';
            return `<tr>
                <td style="padding:10px 14px;font-size:13px;"><i class="fas ${ic}" style="color:${cl};margin-right:8px;"></i>${e.event}</td>
                <td style="padding:10px 14px;font-size:13px;font-weight:700;">${e.count}</td>
            </tr>`;
        }).join('');

        const riskRows = (data.high_risk || []).map(a => {
            const statusColor = a.status === 'banned' ? '#ef4444' : '#f59e0b';
            return `<tr>
                <td style="padding:10px 14px;font-size:13px;">${a.student_name}</td>
                <td style="padding:10px 14px;font-size:12px;color:#64748b;">${a.exam_title}</td>
                <td style="padding:10px 14px;text-align:center;">
                    <span style="font-weight:800;color:${a.risk_score >= 90 ? '#ef4444' : '#f59e0b'};font-size:14px;">${a.risk_score}</span>
                </td>
                <td style="padding:10px 14px;font-size:12px;text-align:center;">${a.warnings_count}</td>
                <td style="padding:10px 14px;font-size:12px;text-align:center;">${a.tab_switches}</td>
                <td style="padding:10px 14px;font-size:12px;text-align:center;">${a.no_face_count}</td>
                <td style="padding:10px 14px;">
                    <span style="font-size:11px;font-weight:700;color:${statusColor};background:${statusColor}18;padding:3px 8px;border-radius:99px;">
                        ${a.status === 'banned' ? 'Banni' : a.status}
                    </span>
                    ${a.ban_reason ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px;">${a.ban_reason}</div>` : ''}
                </td>
            </tr>`;
        }).join('');

        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-shield-alt"></i> Rapport de sécurité</h2>
                <p>Incidents et comportements suspects lors des examens en ligne</p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:24px;">
                <div class="stat-card" style="text-align:center;border-left:4px solid #ef4444;">
                    <div style="font-size:28px;font-weight:800;color:#ef4444;">${data.banned_count || 0}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-ban"></i> Étudiants bannis</div>
                </div>
                <div class="stat-card" style="text-align:center;border-left:4px solid #f59e0b;">
                    <div style="font-size:28px;font-weight:800;color:#f59e0b;">${data.high_risk?.length || 0}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-exclamation-triangle"></i> À haut risque (≥70)</div>
                </div>
                <div class="stat-card" style="text-align:center;border-left:4px solid #6366f1;">
                    <div style="font-size:28px;font-weight:800;color:#6366f1;">${data.event_summary?.reduce((a,e)=>a+e.count,0)||0}</div>
                    <div style="font-size:12px;color:#64748b;margin-top:4px;"><i class="fas fa-list"></i> Incidents totaux</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px;flex-wrap:wrap;">
                <div class="card">
                    <div class="card-header"><h3 style="margin:0;"><i class="fas fa-chart-bar"></i> Types d'incidents</h3></div>
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:8px 14px;text-align:left;font-size:12px;color:#64748b;">Événement</th>
                            <th style="padding:8px 14px;text-align:left;font-size:12px;color:#64748b;">Nb</th>
                        </tr></thead>
                        <tbody>${evtRows || '<tr><td colspan="2" style="padding:16px;text-align:center;color:#94a3b8;">Aucun incident</td></tr>'}</tbody>
                    </table>
                </div>
                <div class="card">
                    <div class="card-header"><h3 style="margin:0;"><i class="fas fa-user-shield"></i> Tentatives à haut risque (score ≥ 70)</h3></div>
                    ${data.high_risk?.length ? `
                    <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:8px 14px;text-align:left;font-size:12px;color:#64748b;">Étudiant</th>
                            <th style="padding:8px 14px;text-align:left;font-size:12px;color:#64748b;">Examen</th>
                            <th style="padding:8px 14px;text-align:center;font-size:12px;color:#64748b;">Score</th>
                            <th style="padding:8px 14px;text-align:center;font-size:12px;color:#64748b;">Avert.</th>
                            <th style="padding:8px 14px;text-align:center;font-size:12px;color:#64748b;">Onglets</th>
                            <th style="padding:8px 14px;text-align:center;font-size:12px;color:#64748b;">Sans visage</th>
                            <th style="padding:8px 14px;text-align:left;font-size:12px;color:#64748b;">Statut</th>
                        </tr></thead>
                        <tbody>${riskRows}</tbody>
                    </table>
                    </div>` : '<p style="padding:20px;text-align:center;color:#94a3b8;">Aucune tentative à haut risque</p>'}
                </div>
            </div>

            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 18px;margin-top:16px;font-size:13px;color:#0369a1;line-height:1.7;">
                <strong><i class="fas fa-info-circle"></i> Interprétation du score de risque :</strong><br>
                Le score est calculé à partir du nombre d'avertissements, de changements d'onglet, de détections sans visage et d'autres incidents.
                <strong>0–30 : Normal · 30–70 : Attention · 70–100 : Risque élevé</strong>
            </div>
        `;
    } catch(e) { showAlert(humanError(e), 'error'); }
    finally { showLoader(false); }
}

async function loadReclamations() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/reclamations');
        if (!response.ok) {
            throw new Error(await response.text());
        }
        const reclamations = await response.json();
        let reclamationsHTML = reclamations.map(r => {
            const statusClass = { 'pending': 'warning', 'resolved': 'success', 'rejected': 'danger' }[r.status] || 'secondary';
            const statusLabel = { 
                'pending': '<i class="fas fa-clock"></i> En attente', 
                'resolved': '<i class="fas fa-check-circle"></i> Acceptée', 
                'rejected': '<i class="fas fa-times-circle"></i> Rejetée' 
            }[r.status];
            const hasIAProposal = r.ia_proposed_status && r.status === 'pending';

            return `
                <div class="reclamation-item ${r.status}">
                    <div class="reclamation-header">
                        <div>
                            <strong><i class="fas fa-user"></i> ${r.student_name}</strong> - ${r.subject_title}
                            <br><small><i class="fas fa-calendar"></i> ${new Date(r.created_at).toLocaleDateString('fr-FR')}</small>
                            ${hasIAProposal ? `<br><span style="color:#f59e0b; font-weight:bold;"><i class="fas fa-lightbulb"></i> Proposition IA disponible</span>` : ''}
                        </div>
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                    </div>
                    <p><strong><i class="fas fa-comment"></i> Raison:</strong> ${r.reason}</p>
                    ${r.response ? `<p><strong><i class="fas fa-reply"></i> Réponse:</strong> ${r.response}</p>` : ''}
                    ${r.ia_proposed_reason ? `<p><strong><i class="fas fa-robot"></i> Proposition IA:</strong> ${r.ia_proposed_reason}</p>` : ''}
                    ${currentUser.role !== 'student' && r.status === 'pending' ?
                        `<button class="btn btn-sm btn-primary" onclick="showRespondReclamationModal(${r.id})">
                            <i class="fas fa-reply"></i> Répondre
                        </button>
                         <button class="btn btn-sm btn-info" onclick="processReclamationIA(${r.id})">
                            <i class="fas fa-brain"></i> Traiter IA
                        </button>` : ''}
                </div            `;
        }).join('');
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-exclamation-triangle"></i> Réclamations</h2>
                <p>${reclamations.length} réclamation(s)</p>
            </div>
            <div class="card">${reclamationsHTML || '<p><i class="fas fa-inbox"></i> Aucune réclamation</p>'}</div>
        `;
    } catch (error) {
        showAlert('Impossible de charger les réclamations. Veuillez réessayer.', 'error');
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-exclamation-triangle"></i> Réclamations</h2>
            </div>
            <div class="alert alert-error">
                <i class="fas fa-exclamation-circle"></i>
                <div>Erreur de chargement des données. Veuillez vérifier la base de données ou réessayer.</div>
            </div>
        `;
    } finally {
        showLoader(false);
    }
}

function loadMyReclamations() {
    loadReclamations();
}

async function loadMyTranscripts() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    window._currentView = loadMyTranscripts;
    showLoader(true);
    try {
        const res = await authenticatedFetch('/api/student/transcripts');
        const transcripts = res.ok ? await res.json() : [];
        const content = document.getElementById('main-content');

        const fmtDate = iso => iso
            ? new Date(iso).toLocaleDateString('fr-FR', {day:'2-digit', month:'long', year:'numeric'})
            : '—';

        const gpaColor = gpa => gpa >= 16 ? '#7c3aed' : gpa >= 14 ? '#2563eb' : gpa >= 10 ? '#10b981' : '#ef4444';
        const mention  = gpa => gpa >= 16 ? 'Très bien' : gpa >= 14 ? 'Bien' : gpa >= 12 ? 'Assez bien' : gpa >= 10 ? 'Passable' : 'Ajourné';

        const rows = transcripts.map(t => {
            const color = gpaColor(t.gpa);
            const cred  = t.obtained_credits !== null ? `${t.obtained_credits}/${t.total_credits}` : '—';
            return `
            <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px 22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:16px;flex:1;min-width:220px;">
                    <div style="width:52px;height:52px;border-radius:12px;background:${color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-graduation-cap" style="color:${color};font-size:20px;"></i>
                    </div>
                    <div>
                        <div style="font-weight:700;color:#0f172a;font-size:15px;">${t.formation_name}</div>
                        <div style="font-size:13px;color:#64748b;margin-top:2px;">Semestre ${t.semester_number || ''} — ${t.semester_name}</div>
                        <div style="font-size:11px;color:#94a3b8;margin-top:3px;">Généré le ${fmtDate(t.generated_at)}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
                    <div style="text-align:center;">
                        <div style="font-size:28px;font-weight:800;color:${color};line-height:1;">${t.gpa ? Number(t.gpa).toFixed(2) : '—'}</div>
                        <div style="font-size:10px;color:#94a3b8;">/20 — Moy. générale</div>
                    </div>
                    <div style="text-align:center;">
                        <div style="font-size:16px;font-weight:700;color:${color};">${cred}</div>
                        <div style="font-size:10px;color:#94a3b8;">Crédits</div>
                    </div>
                    <div style="text-align:center;">
                        <span style="background:${color}18;color:${color};font-size:11px;font-weight:700;padding:4px 10px;border-radius:99px;">${mention(t.gpa)}</span>
                    </div>
                    <button onclick="downloadTranscriptPDF(${t.id}, '${(t.formation_name||'').replace(/'/g,"\\'")} S${t.semester_number||''}')"
                        style="background:#3b82f6;color:white;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;">
                        <i class="fas fa-file-pdf"></i> Télécharger PDF
                    </button>
                </div>
            </div>`;
        }).join('');

        content.innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-file-alt"></i> Mes relevés de notes</h2>
                <p>Relevés officiels générés par vos professeurs ou l'administration</p>
            </div>

            ${transcripts.length === 0 ? `
            <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:48px;text-align:center;">
                <i class="fas fa-file-alt" style="font-size:52px;color:#cbd5e1;margin-bottom:16px;display:block;"></i>
                <p style="color:#64748b;margin:0;font-size:15px;">Aucun relevé disponible pour le moment.</p>
                <p style="color:#94a3b8;margin:8px 0 0;font-size:13px;">
                    Les relevés sont générés par vos professeurs ou l'administration après la fin d'un semestre.
                </p>
            </div>` : `
            <div style="margin-bottom:8px;font-size:13px;color:#64748b;">${transcripts.length} relevé(s) disponible(s)</div>
            ${rows}`}

            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px 18px;margin-top:20px;display:flex;align-items:flex-start;gap:12px;">
                <i class="fas fa-info-circle" style="color:#d97706;margin-top:2px;flex-shrink:0;"></i>
                <div style="font-size:13px;color:#92400e;line-height:1.6;">
                    <strong>Vous ne trouvez pas un relevé ?</strong><br>
                    Les relevés sont générés manuellement par l'administration ou vos professeurs.
                    Si un semestre est terminé et que vous n'avez pas reçu votre relevé, contactez votre administration.
                </div>
            </div>
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function downloadTranscriptPDF(transcriptId, label) {
    try {
        showLoader(true);
        const res = await fetch(`/api/transcripts/${transcriptId}/pdf`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) { showAlert('Impossible de générer le PDF.', 'error'); return; }
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `releve_${(label||transcriptId).replace(/\s+/g,'_')}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) { showAlert('Erreur lors du téléchargement.', 'error'); }
    finally { showLoader(false); }
}

function confirmDeleteTranscript(transcriptId, studentName, semesterName) {
    // Modale de confirmation avant suppression d'un relevé
    const existing = document.getElementById('del-transcript-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'del-transcript-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    modal.innerHTML = `
        <div style="background:var(--surface,#fff);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <span style="background:#fee2e2;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-exclamation-triangle" style="color:#dc2626;font-size:18px;"></i>
                </span>
                <h3 style="margin:0;font-size:1.1rem;color:var(--text,#1e293b);">Supprimer le relevé</h3>
            </div>
            <p style="color:var(--text-secondary,#475569);margin:0 0 8px;">Vous êtes sur le point de supprimer définitivement le relevé de :</p>
            <div style="background:var(--background,#f8fafc);border-radius:8px;padding:12px 16px;margin-bottom:20px;">
                <strong>${studentName}</strong><br>
                <small style="color:#64748b;">${semesterName}</small>
            </div>
            <p style="color:#dc2626;font-size:0.88em;margin:0 0 22px;">
                <i class="fas fa-info-circle"></i> Cette action est irréversible. L'étudiant n'aura plus accès à ce relevé.
            </p>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button onclick="document.getElementById('del-transcript-modal').remove()"
                    style="padding:9px 20px;border:1px solid var(--border,#e2e8f0);background:transparent;border-radius:8px;cursor:pointer;color:var(--text,#1e293b);">
                    Annuler
                </button>
                <button onclick="deleteTranscript(${transcriptId})"
                    style="padding:9px 20px;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
                    <i class="fas fa-trash"></i> Supprimer
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    // Fermer en cliquant le voile
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function deleteTranscript(transcriptId) {
    const modal = document.getElementById('del-transcript-modal');
    if (modal) modal.remove();
    try {
        showLoader(true);
        const res = await authenticatedFetch(`/api/transcripts/${transcriptId}`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok && data.success) {
            showAlert(data.message || 'Relevé supprimé.', 'success');
            // Recharger la vue courante
            if (typeof loadAllTranscripts === 'function') await loadAllTranscripts();
        } else {
            showAlert(data.error || 'Erreur lors de la suppression.', 'error');
        }
    } catch(e) {
        showAlert('Erreur réseau lors de la suppression.', 'error');
    } finally {
        showLoader(false);
    }
}

async function loadExamSchedule() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    window._currentView = loadExamSchedule;
    showLoader(true);
    try {
        const res = await authenticatedFetch('/api/online_exams');
        const exams = res.ok ? await res.json() : [];

        const now = new Date();
        const upcoming = exams
            .filter(e => e.status === 'scheduled' || e.status === 'active')
            .sort((a, b) => new Date(a.scheduled_start || 0) - new Date(b.scheduled_start || 0));
        const past = exams
            .filter(e => e.status === 'closed')
            .sort((a, b) => new Date(b.scheduled_start || 0) - new Date(a.scheduled_start || 0))
            .slice(0, 10);

        const fmtDate = iso => {
            if (!iso) return '—';
            const d = new Date(iso);
            return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) + ' à ' +
                   d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
        };
        const fmtDuration = mins => mins >= 60 ? `${Math.floor(mins/60)}h${mins%60?String(mins%60).padStart(2,'0'):''}` : `${mins} min`;

        const renderCard = (exam, isPast) => {
            const statusColors = { active: '#10b981', scheduled: '#3b82f6', closed: '#94a3b8' };
            const statusLabels = { active: 'En cours', scheduled: 'À venir', closed: 'Terminé' };
            const color = statusColors[exam.status] || '#64748b';
            const label = statusLabels[exam.status] || exam.status;
            const start = exam.scheduled_start ? new Date(exam.scheduled_start) : null;
            const diffMs = start ? start - now : null;
            const diffH = diffMs ? Math.floor(diffMs / 3600000) : null;
            const diffMin = diffMs ? Math.floor((diffMs % 3600000) / 60000) : null;
            const countdown = !isPast && diffMs > 0
                ? (diffH > 0 ? `Dans ${diffH}h${diffMin > 0 ? diffMin + 'min' : ''}` : diffMin > 0 ? `Dans ${diffMin} min` : 'Imminente')
                : '';

            return `
            <div style="background:var(--surface,#fff);border-radius:12px;border:1px solid var(--border,#e2e8f0);border-left:4px solid ${color};padding:18px 20px;display:flex;align-items:flex-start;gap:16px;">
                <div style="background:${color}1a;width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-${isPast ? 'history' : exam.status==='active' ? 'play-circle' : 'clock'}" style="color:${color};font-size:18px;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                        <strong style="font-size:15px;color:var(--text,#0f172a);">${exam.title}</strong>
                        <span style="background:${color}1a;color:${color};padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;">${label}</span>
                        ${countdown ? `<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;"><i class="fas fa-hourglass-half"></i> ${countdown}</span>` : ''}
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-secondary,#64748b);">
                        ${start ? `<span><i class="fas fa-calendar-day"></i> ${fmtDate(exam.scheduled_start)}</span>` : ''}
                        ${exam.duration_minutes ? `<span><i class="fas fa-stopwatch"></i> ${fmtDuration(exam.duration_minutes)}</span>` : ''}
                        ${exam.auto_correct ? `<span style="color:#10b981;"><i class="fas fa-robot"></i> Correction IA</span>` : ''}
                    </div>
                    ${exam.status === 'active' ? `
                    <div style="margin-top:10px;">
                        <button onclick="loadOnlineExams()" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;background:#10b981;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                            <i class="fas fa-play"></i> Rejoindre l'examen
                        </button>
                    </div>` : ''}
                </div>
            </div>`;
        };

        let html = `
        <div style="margin-bottom:24px;">
            <h2 style="font-size:20px;font-weight:700;color:var(--text,#0f172a);margin:0 0 4px;display:flex;align-items:center;gap:10px;">
                <i class="fas fa-calendar-alt" style="color:#3b82f6;"></i> Planning des examens
            </h2>
            <p style="color:var(--text-secondary,#64748b);margin:0;font-size:13px;">Vue chronologique de vos examens en ligne</p>
        </div>`;

        if (upcoming.length === 0 && past.length === 0) {
            html += `<div style="text-align:center;padding:64px 24px;background:var(--surface,#fff);border-radius:16px;border:1px solid var(--border,#e2e8f0);">
                <i class="fas fa-calendar-times" style="font-size:48px;color:#cbd5e1;display:block;margin-bottom:16px;"></i>
                <h3 style="color:#475569;margin:0 0 8px;">Aucun examen planifié</h3>
                <p style="color:#94a3b8;margin:0;font-size:14px;">Vos examens apparaîtront ici dès qu'un professeur les programmera.</p>
            </div>`;
        } else {
            if (upcoming.length > 0) {
                html += `<div style="margin-bottom:28px;">
                    <h3 style="font-size:14px;font-weight:700;color:var(--text-secondary,#64748b);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;display:flex;align-items:center;gap:8px;">
                        <span style="background:#3b82f6;width:3px;height:16px;border-radius:2px;display:inline-block;"></span>
                        Examens à venir & en cours (${upcoming.length})
                    </h3>
                    <div style="display:flex;flex-direction:column;gap:10px;">${upcoming.map(e => renderCard(e, false)).join('')}</div>
                </div>`;
            }
            if (past.length > 0) {
                html += `<div>
                    <h3 style="font-size:14px;font-weight:700;color:var(--text-secondary,#64748b);text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;display:flex;align-items:center;gap:8px;">
                        <span style="background:#94a3b8;width:3px;height:16px;border-radius:2px;display:inline-block;"></span>
                        Examens passés (${past.length})
                    </h3>
                    <div style="display:flex;flex-direction:column;gap:10px;">${past.map(e => renderCard(e, true)).join('')}</div>
                </div>`;
            }
        }

        document.getElementById('main-content').innerHTML = html;
    } catch(e) {
        showAlert('Erreur lors du chargement du planning.', 'error');
    } finally {
        showLoader(false);
    }
}

function loadStudentHelp() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    window._currentView = loadStudentHelp;
    const faq = [
        {
            q: 'Pourquoi est-ce que je vois des avertissements pendant l\'examen ?',
            a: `Le système de surveillance détecte automatiquement certains comportements :<br>
                <ul style="margin:8px 0 0 16px;line-height:1.9;">
                    <li><strong>Changement de fenêtre / onglet</strong> — chaque fois que vous quittez la page de composition, même brièvement, cela est enregistré.</li>
                    <li><strong>Visage absent de la caméra</strong> — si votre visage n'est pas visible dans la caméra (tête baissée, éloignement, mauvais éclairage).</li>
                    <li><strong>Plusieurs visages détectés</strong> — si une autre personne passe dans le champ de la caméra.</li>
                    <li><strong>Tentative de copier/coller</strong> — si cette option est désactivée pour l'examen.</li>
                    <li><strong>Clic droit</strong> — si cette option est désactivée pour l'examen.</li>
                    <li><strong>Outils développeur (F12)</strong> — leur ouverture entraîne un bannissement immédiat si activée.</li>
                </ul>`
        },
        {
            q: 'Que se passe-t-il si je suis banni ?',
            a: 'Si vous dépassez le seuil d\'avertissements configuré par votre professeur, vous êtes exclu de l\'examen. Votre copie est automatiquement soumise avec les réponses déjà enregistrées. Vous pouvez contacter votre administration si vous estimez que le bannissement est injustifié.'
        },
        {
            q: 'Mon examen s\'est soumis automatiquement, est-ce normal ?',
            a: 'Oui. Quand le temps imparti est écoulé, l\'examen se soumet automatiquement avec tout ce que vous avez rédigé. Vérifiez l\'heure de fin indiquée dans la carte de l\'examen.'
        },
        {
            q: 'Pourquoi le bouton "Composer" est grisé ?',
            a: 'Plusieurs raisons possibles : (1) l\'examen n\'a pas encore été activé par votre professeur, (2) la période est terminée, (3) vous avez déjà composé cet examen.'
        },
        {
            q: 'Comment fonctionne la correction automatique par IA ?',
            a: 'Certains examens sont configurés pour être corrigés automatiquement par l\'intelligence artificielle (badge vert "IA auto"). La correction a lieu dès que vous soumettez. Votre professeur peut ensuite réviser la note. Pour les autres examens, la correction est effectuée manuellement par votre professeur.'
        },
        {
            q: 'Comment contester une note ?',
            a: 'Vous avez 7 jours après la correction pour soumettre une réclamation. Cliquez sur "Réclamer" dans votre tableau de bord (section "Mes notes") ou depuis la page "Voir ma note". Votre professeur recevra la réclamation et pourra réviser la correction avec l\'aide de l\'IA.'
        },
        {
            q: 'Je n\'arrive pas à télécharger mon relevé de notes.',
            a: 'Les relevés sont générés par l\'administration ou vos professeurs après la fin d\'un semestre. Si votre semestre est terminé et qu\'aucun relevé n\'apparaît dans "Mes relevés", contactez votre administration. Si le fichier ne se télécharge pas, vérifiez que votre navigateur autorise les téléchargements.'
        },
        {
            q: 'La caméra ne fonctionne pas, que faire ?',
            a: 'Vérifiez que vous avez accordé la permission d\'accès à la caméra dans votre navigateur (icône cadenas dans la barre d\'adresse). Rechargez la page et réessayez. Si le problème persiste, essayez avec Chrome ou Firefox. Sur mobile, assurez-vous d\'utiliser un navigateur récent.'
        }
    ];

    const faqHtml = faq.map((item, i) => `
        <div style="border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;overflow:hidden;">
            <button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'; this.querySelector('.faq-chevron').classList.toggle('open')"
                style="width:100%;background:#f8fafc;border:none;padding:14px 18px;text-align:left;cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:600;color:#0f172a;">
                <span><i class="fas fa-question-circle" style="color:#6366f1;margin-right:8px;"></i>${item.q}</span>
                <i class="fas fa-chevron-down faq-chevron" style="color:#94a3b8;font-size:12px;transition:transform 0.2s;flex-shrink:0;margin-left:10px;"></i>
            </button>
            <div style="display:none;padding:14px 18px;font-size:13px;color:#475569;line-height:1.7;border-top:1px solid #f1f5f9;">
                ${item.a}
            </div>
        </div>`).join('');

    document.getElementById('main-content').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-question-circle"></i> Centre d'aide</h2>
            <p>Réponses aux questions fréquentes sur l'utilisation de la plateforme</p>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:28px;">
            <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border-radius:12px;padding:18px;display:flex;align-items:center;gap:14px;">
                <i class="fas fa-shield-alt" style="font-size:28px;opacity:.85;"></i>
                <div>
                    <div style="font-size:13px;opacity:.8;">Intégrité académique</div>
                    <div style="font-weight:700;font-size:15px;">Surveillance active</div>
                </div>
            </div>
            <div style="background:linear-gradient(135deg,#10b981,#059669);color:white;border-radius:12px;padding:18px;display:flex;align-items:center;gap:14px;">
                <i class="fas fa-robot" style="font-size:28px;opacity:.85;"></i>
                <div>
                    <div style="font-size:13px;opacity:.8;">Correction</div>
                    <div style="font-weight:700;font-size:15px;">IA + Professeur</div>
                </div>
            </div>
            <div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border-radius:12px;padding:18px;display:flex;align-items:center;gap:14px;">
                <i class="fas fa-exclamation-triangle" style="font-size:28px;opacity:.85;"></i>
                <div>
                    <div style="font-size:13px;opacity:.8;">Réclamation</div>
                    <div style="font-weight:700;font-size:15px;">7 jours après correction</div>
                </div>
            </div>
        </div>

        <div class="card" style="padding:20px;">
            <h3 style="margin:0 0 18px;font-size:16px;color:#0f172a;"><i class="fas fa-list" style="color:#6366f1;margin-right:8px;"></i>Questions fréquentes</h3>
            ${faqHtml}
        </div>

        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-top:16px;display:flex;align-items:flex-start;gap:12px;">
            <i class="fas fa-envelope" style="color:#10b981;margin-top:2px;flex-shrink:0;"></i>
            <div style="font-size:13px;color:#166534;line-height:1.6;">
                <strong>Vous ne trouvez pas la réponse à votre question ?</strong><br>
                Contactez votre administration ou votre professeur directement. En cas de problème technique urgent pendant un examen, signalez-le au surveillant présent.
            </div>
        </div>
    `;

    // Add chevron rotation style if not already present
    if (!document.getElementById('faq-chevron-style')) {
        const s = document.createElement('style');
        s.id = 'faq-chevron-style';
        s.textContent = '.faq-chevron.open { transform: rotate(180deg); }';
        document.head.appendChild(s);
    }
}

function showCreateReclamationModal(paperId) {
    const modalContent = `
        <h2><i class="fas fa-exclamation-triangle"></i> Créer une Réclamation</h2>
        <form id="create-reclamation-form">
            <div class="form-group">
                <label><i class="fas fa-comment"></i> Raison *</label>
                <textarea id="reclamation-reason" rows="5" required></textarea>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-warning">
                    <i class="fas fa-paper-plane"></i> Soumettre
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent);
    document.getElementById('create-reclamation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/reclamations', {
                method: 'POST',
                body: JSON.stringify({
                    paper_id: paperId,
                    reason: document.getElementById('reclamation-reason').value
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert('Votre réclamation a été soumise avec succès. Vous serez notifié de la réponse.', 'success');
                closeModal();
                loadDashboard();
            } else {
                showAlert(data.error || 'Impossible d\'envoyer la réclamation. Vérifiez que tous les champs sont remplis.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

// ============================================================================
// AFFECTATIONS EC
// ============================================================================
async function loadECAssignments() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const [ecsRes, usersRes] = await Promise.all([
            authenticatedFetch('/api/ecs'),
            authenticatedFetch('/api/admin/users')
        ]);
        const ecs        = await ecsRes.json();
        const allUsers   = await usersRes.json();
        const professors = allUsers.filter(u => u.role === 'professor');

        const profOptions = '<option value="">— Sélectionner un professeur —</option>'
            + professors.map(p => `<option value="${p.id}">${p.full_name}</option>`).join('');

        const assignedCount = ecs.filter(e => e.professor_id).length;

        const rows = ecs.length === 0
            ? `<tr><td colspan="5" style="padding:40px;text-align:center;color:#94a3b8;">
                   <i class="fas fa-inbox" style="font-size:32px;display:block;margin-bottom:10px;"></i>
                   Aucun EC disponible. Créez d'abord des formations et des UEs.
               </td></tr>`
            : ecs.map(ec => {
                const assigned = ec.professor_name
                    ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#15803d;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;">
                           <i class="fas fa-circle-check" style="font-size:9px;"></i> ${ec.professor_name}
                       </span>`
                    : `<span style="display:inline-flex;align-items:center;gap:5px;background:#f1f5f9;color:#94a3b8;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;">
                           <i class="fas fa-circle-minus" style="font-size:9px;"></i> Non assigné
                       </span>`;
                return `
                    <tr style="transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                        <td style="padding:13px 16px;border-bottom:1px solid #f1f5f9;">
                            <span style="display:inline-block;background:#ede9fe;color:#6d28d9;padding:3px 9px;border-radius:6px;font-size:12px;font-weight:700;">${ec.code}</span>
                        </td>
                        <td style="padding:13px 16px;border-bottom:1px solid #f1f5f9;">
                            <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;">${ec.name}</p>
                        </td>
                        <td style="padding:13px 16px;border-bottom:1px solid #f1f5f9;">
                            <span style="font-size:12px;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:4px;">${ec.ue_code}</span>
                        </td>
                        <td style="padding:13px 16px;border-bottom:1px solid #f1f5f9;">${assigned}</td>
                        <td style="padding:13px 16px;border-bottom:1px solid #f1f5f9;">
                            <div style="display:flex;align-items:center;gap:8px;">
                                <select id="ec-professor-${ec.id}" class="ec-professor-select" data-ec-id="${ec.id}"
                                    style="font-size:13px;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;background:#fff;color:#334155;transition:border-color .2s;min-width:180px;"
                                    onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                                    ${profOptions}
                                </select>
                                <button onclick="assignECToProfessor(${ec.id})"
                                    style="display:inline-flex;align-items:center;gap:5px;padding:7px 12px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;"
                                    onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                                    <i class="fas fa-link"></i> Assigner
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

        document.getElementById('main-content').innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
                <div>
                    <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-link" style="color:#3b82f6;"></i> Affectations EC aux Professeurs
                    </h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Assignez les Éléments Constitutifs aux professeurs responsables</p>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-layer-group" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${ecs.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">ECs au total</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-circle-check" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${assignedCount}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">ECs assignés</p>
                    </div>
                </div>
            </div>

            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-list" style="color:#64748b;font-size:13px;"></i>
                    <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">Liste des ECs</h3>
                    <span style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;margin-left:4px;">${ecs.length}</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Code EC</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Intitulé</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">UE</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Professeur actuel</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Nouvelle affectation</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function assignECToProfessor(ecId) {
    const select = document.getElementById(`ec-professor-${ecId}`);
    const professorId = select.value;
    if (!professorId) {
        showAlert('Veuillez sélectionner un professeur', 'warning');
        return;
    }
    showLoader(true);
    try {
        let response = await authenticatedFetch(`/api/admin/ecs/${ecId}/assign`, {
            method: 'POST',
            body: JSON.stringify({ professor_id: professorId })
        });
        if (response.ok) {
            showAlert("L'EC a été assigné au professeur avec succès.", 'success');
            loadECAssignments();
        } else {
            showAlert('Impossible d\'effectuer l\'affectation. Veuillez réessayer.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// INSCRIPTIONS UE
// ============================================================================
async function loadStudentEnrollments() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const [formationsRes, studentsRes] = await Promise.all([
            authenticatedFetch('/api/formations'),
            authenticatedFetch('/api/students/list')
        ]);
        const formations = await formationsRes.json();
        const students   = await studentsRes.json();

        let ues = [];
        for (const formation of formations) {
            try {
                const semRes  = await authenticatedFetch(`/api/formations/${formation.id}/semesters`);
                const semesters = await semRes.json();
                for (const semester of semesters) {
                    try {
                        const ueRes  = await authenticatedFetch(`/api/semesters/${semester.id}/ues`);
                        const ueData = await ueRes.json();
                        ues = ues.concat(ueData);
                    } catch (e) {}
                }
            } catch (e) {}
        }

        const ueOptions = '<option value="">— Sélectionner une UE —</option>'
            + ues.map(u => `<option value="${u.id}">${u.code} — ${u.name}</option>`).join('');

        const rows = students.length === 0
            ? `<tr><td colspan="4" style="padding:40px;text-align:center;color:#94a3b8;">
                   <i class="fas fa-inbox" style="font-size:32px;display:block;margin-bottom:10px;"></i>
                   Aucun étudiant enregistré. Créez d'abord des comptes étudiants.
               </td></tr>`
            : students.map(student => {
                const initials = student.full_name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
                return `
                    <tr style="transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                        <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                            <div style="display:flex;align-items:center;gap:9px;">
                                <div style="width:32px;height:32px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                                <span style="font-size:13px;font-weight:600;color:#0f172a;">${student.full_name}</span>
                            </div>
                        </td>
                        <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                            <div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;">
                                <i class="fas fa-envelope" style="font-size:11px;color:#94a3b8;"></i>
                                ${student.email}
                            </div>
                        </td>
                        <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                            <select id="student-ue-${student.id}" class="student-ue-select"
                                style="font-size:13px;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:7px;background:#fff;color:#334155;width:100%;min-width:200px;transition:border-color .2s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#e2e8f0'">
                                ${ueOptions}
                            </select>
                        </td>
                        <td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;">
                            <button onclick="enrollStudentToUE(${student.id})"
                                style="display:inline-flex;align-items:center;gap:5px;padding:7px 13px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .15s;"
                                onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                                <i class="fas fa-circle-plus"></i> Inscrire
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

        document.getElementById('main-content').innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
                <div>
                    <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-user-graduate" style="color:#3b82f6;"></i> Inscriptions UE des Étudiants
                    </h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Inscrivez les étudiants aux Unités d'Enseignement</p>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-users" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${students.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">Étudiants</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-layer-group" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${ues.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">UEs disponibles</p>
                    </div>
                </div>
            </div>

            ${ues.length === 0 ? `
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:flex-start;gap:12px;">
                <i class="fas fa-triangle-exclamation" style="color:#f59e0b;font-size:18px;flex-shrink:0;margin-top:1px;"></i>
                <div>
                    <p style="margin:0;font-weight:600;font-size:13px;color:#92400e;">Aucune UE disponible</p>
                    <p style="margin:4px 0 0;font-size:12px;color:#78350f;">Créez d'abord des formations, des semestres et des UEs dans l'onglet <strong>Maquette Pédagogique</strong> avant d'inscrire des étudiants.</p>
                </div>
            </div>` : ''}

            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-list" style="color:#64748b;font-size:13px;"></i>
                    <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">Liste des étudiants</h3>
                    <span style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;margin-left:4px;">${students.length}</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Étudiant</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Email</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Choisir une UE</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Action</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function enrollStudentToUE(studentId) {
    console.log('🔍 DEBUG enrollStudentToUE appelée avec studentId:', studentId);
    
    // Validation robuste du select
    const select = document.getElementById(`student-ue-${studentId}`);
    console.log('🔍 DEBUG select element:', select);
    
    if (!select) {
        console.error('❌ Élément select introuvable pour student-ue-' + studentId);
        showAlert('Erreur technique : impossible de lire la sélection UE. Veuillez actualiser la page.', 'error');
        return;
    }

    const ueId = select.value;
    console.log('🔍 DEBUG ueId value:', ueId, 'type:', typeof ueId);
    
    if (!ueId || ueId === '' || ueId === 'null' || ueId === 'undefined') {
        console.warn('⚠️ Aucune UE sélectionnée');
        showAlert('Veuillez sélectionner une UE', 'warning');
        return;
    }

    // Validation que ueId est un nombre valide
    const ueIdNum = parseInt(ueId, 10);
    if (isNaN(ueIdNum) || ueIdNum <= 0) {
        console.error('❌ ueId invalide:', ueId);
        showAlert('UE sélectionnée invalide', 'error');
        return;
    }

    console.log('✅ Validation OK - Envoi requête avec:', {
        studentId: studentId,
        ueId: ueIdNum
    });

    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/admin/students/${studentId}/enroll`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ue_id: ueIdNum })
        });

        console.log('🔍 DEBUG response status:', response.status);
        
        let data = {};
        try { 
            data = await response.json(); 
            console.log('🔍 DEBUG response data:', data);
        } catch (e) { 
            console.error('❌ Erreur parsing JSON:', e);
        }

        if (response.ok && data.success) {
            showAlert('L\'étudiant a été inscrit à l\'UE avec succès.', 'success');
            loadStudentEnrollments();
        } else {
            const msg = (data && (data.error || data.message)) 
                ? (data.error || data.message) 
                : `Erreur (${response.status}) lors de l'inscription`;
            console.error('❌ Erreur inscription:', msg);
            showAlert(msg, 'error');
        }
    } catch (error) {
        console.error('❌ Exception lors de l\'inscription:', error);
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}
// ============================================================================
// GESTION DE LA MAQUETTE PÉDAGOGIQUE COMPLÈTE
// ============================================================================

async function loadMaquette() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/formations');
        const formations = await response.json();
        
        let html = `
            <div class="page-header">
                <h2><i class="fas fa-layer-group"></i> Maquette Pédagogique - Gestion Complète</h2>
                <p>Gérez les formations, semestres, UEs et ECs</p>
                <div class="alert alert-info" style="margin-top: 10px;">
                    <strong><i class="fas fa-info-circle"></i> Important:</strong> Pour lier des sujets à des ECs, créez d'abord :
                    <ol style="margin: 10px 0 0 20px;">
                        <li>Une Formation</li>
                        <li>Un Semestre (bouton  Semestre)</li>
                        <li>Une UE (bouton UE)</li>
                        <li>Un EC (bouton EC)</li>
                    </ol>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-university"></i> Formations</h3>
                </div>
                <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                    <button class="btn btn-primary" onclick="showCreateFormationModal()">
                        <i class="fas fa-plus"></i> Nouvelle Formation
                    </button>
                    <button class="btn btn-success" onclick="showImportMaquetteModal()">
                        <i class="fas fa-file-csv"></i> ${t('section.import_csv')} Bulk
                    </button>
                </div>
        `;
        
        if (formations.length === 0) {
            html += `<p class="empty-message"><i class="fas fa-inbox"></i> Aucune formation créée</p>`;
        } else {
            html += `<div class="formations-list">`;
            
            for (const formation of formations) {
                // Récupérer les semestres de cette formation
                const semestersResponse = await authenticatedFetch(`/api/formations/${formation.id}/semesters`);
                const semesters = await semestersResponse.json();
                
                html += `
                    <div class="formation-card">
                        <div class="formation-header">
                            <div>
                                <h4>
                                    <i class="fas fa-graduation-cap"></i> 
                                    ${formation.code} - ${formation.name}
                                </h4>
                                <p style="color: #64748b; margin: 5px 0;">
                                    ${formation.level || 'N/A'} | ${formation.department || 'N/A'}
                                </p>
                                <small style="color: #94a3b8;">
                                    <i class="fas fa-book"></i> ${formation.semesters_count || 0} semestre(s)
                                </small>
                            </div>
                            <div class="formation-actions">
                                <button class="btn btn-sm btn-primary" onclick="showEditFormationModal(${formation.id})">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-success" onclick="showCreateSemesterModal(${formation.id})">
                                    <i class="fas fa-plus"></i> Semestre
                                </button>
                                <button class="btn btn-sm btn-danger" onclick="deleteFormation(${formation.id})">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                        
                        <div class="semesters-container">
                `;
                
                if (semesters.length > 0) {
                    for (const semester of semesters) {
                        // Récupérer les UEs de ce semestre
                        const uesResponse = await authenticatedFetch(`/api/semesters/${semester.id}/ues`);
                        const ues = await uesResponse.json();
                        
                        html += `
                            <div class="semester-card">
                                <div class="semester-header">
                                    <div>
                                        <strong><i class="fas fa-calendar-alt"></i> Semestre ${semester.number}</strong>
                                        ${semester.name ? `- ${semester.name}` : ''}
                                        <span style="color: #64748b; margin-left: 10px;">
                                            <i class="fas fa-star"></i> ${semester.total_credits} crédits
                                        </span>
                                    </div>
                                    <div>
                                        <button class="btn btn-sm btn-primary" onclick="showEditSemesterModal(${semester.id})">
                                            <i class="fas fa-edit"></i>
                                        </button>
                                        <button class="btn btn-sm btn-success" onclick="showCreateUEModal(${semester.id})">
                                            <i class="fas fa-plus"></i> UE
                                        </button>
                                        <button class="btn btn-sm btn-danger" onclick="deleteSemester(${semester.id})">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </div>
                                </div>
                                
                                <div class="ues-container">
                        `;
                        
                        if (ues.length > 0) {
                            for (const ue of ues) {
                                // Récupérer les ECs de cette UE
                                const ecsResponse = await authenticatedFetch(`/api/ues/${ue.id}/ecs`);
                                const ecs = await ecsResponse.json();
                                
                                html += `
                                    <div class="ue-card">
                                        <div class="ue-header">
                                            <div>
                                                <strong><i class="fas fa-book-open"></i> ${ue.code}</strong> - ${ue.name}
                                                <span style="color: #64748b; margin-left: 10px;">
                                                    <i class="fas fa-award"></i> ${ue.credits} crédits
                                                </span>
                                            </div>
                                            <div>
                                                <button class="btn btn-sm btn-primary" onclick="showEditUEModal(${ue.id})">
                                                    <i class="fas fa-edit"></i>
                                                </button>
                                                <button class="btn btn-sm btn-success" onclick="showCreateECModal(${ue.id})">
                                                    <i class="fas fa-plus"></i> EC
                                                </button>
                                                <button class="btn btn-sm btn-danger" onclick="deleteUE(${ue.id})">
                                                    <i class="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                        
                                        <div class="ecs-list">
                                `;
                                
                                if (ecs.length > 0) {
                                    ecs.forEach(ec => {
                                        html += `
                                            <div class="ec-item">
                                                <div>
                                                    <strong>${ec.code}</strong> - ${ec.name}
                                                    <br>
                                                    <small style="color: #64748b;">
                                                        CM: ${ec.cm}h | TD: ${ec.td}h | TP: ${ec.tp}h | Coef: ${ec.coefficient}
                                                    </small>
                                                </div>
                                                <div>
                                                    <button class="btn btn-sm btn-primary" onclick="showEditECModal(${ec.id})">
                                                        <i class="fas fa-edit"></i>
                                                    </button>
                                                    <button class="btn btn-sm btn-danger" onclick="deleteEC(${ec.id})">
                                                        <i class="fas fa-trash"></i>
                                                    </button>
                                                </div>
                                            </div>
                                        `;
                                    });
                                } else {
                                    html += `<p class="empty-message"><i class="fas fa-inbox"></i> Aucun EC</p>`;
                                }
                                
                                html += `
                                        </div>
                                    </div>
                                `;
                            }
                        } else {
                            html += `<p class="empty-message"><i class="fas fa-inbox"></i> Aucune UE</p>`;
                        }
                        
                        html += `
                                </div>
                            </div>
                        `;
                    }
                } else {
                    html += `<p class="empty-message"><i class="fas fa-inbox"></i> Aucun semestre</p>`;
                }
                
                html += `
                        </div>
                    </div>
                `;
            }
            
            html += `</div>`;
        }
        
        document.getElementById('main-content').innerHTML = html;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// MODALS POUR FORMATIONS
// ============================================================================

function showCreateFormationModal() {
    const modalContent = `
        <h2><i class="fas fa-plus"></i> Créer une Formation</h2>
        <form id="create-formation-form">
            <div class="form-group">
                <label><i class="fas fa-code"></i> Code *</label>
                <input type="text" id="formation-code" required placeholder="Ex: M2-TELCO">
            </div>
            <div class="form-group">
                <label><i class="fas fa-graduation-cap"></i> Nom *</label>
                <input type="text" id="formation-name" required placeholder="Ex: Master 2 Télécommunications">
            </div>
            <div class="form-group">
                <label><i class="fas fa-layer-group"></i> Niveau</label>
                <input type="text" id="formation-level" placeholder="Ex: Master 2, Licence 3">
            </div>
            <div class="form-group">
                <label><i class="fas fa-building"></i> Département</label>
                <input type="text" id="formation-department" placeholder="Ex: Génie Électrique">
            </div>
            <div class="form-group">
                <label><i class="fas fa-align-left"></i> Description</label>
                <textarea id="formation-description" rows="3"></textarea>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent);
    
    document.getElementById('create-formation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/admin/formations', {
                method: 'POST',
                body: JSON.stringify({
                    code: document.getElementById('formation-code').value,
                    name: document.getElementById('formation-name').value,
                    level: document.getElementById('formation-level').value,
                    department: document.getElementById('formation-department').value,
                    description: document.getElementById('formation-description').value
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert('La formation a été créée avec succès.', 'success');
                closeModal();
                loadMaquette();
            } else {
                showAlert(data.error || 'Impossible de créer la formation. Le code est peut-être déjà utilisé.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

async function showEditFormationModal(formationId) {
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/formations`);
        const formations = await response.json();
        const formation = formations.find(f => f.id === formationId);

        if (!formation) {
            showAlert('Formation introuvable. Elle a peut-être été supprimée. Veuillez actualiser la page.', 'error');
            showLoader(false);
            return;
        }

        const modalContent = `
            <h2><i class="fas fa-edit"></i> Modifier la Formation</h2>
            <form id="edit-formation-form">
                <div class="form-group">
                    <label><i class="fas fa-code"></i> Code *</label>
                    <input type="text" id="edit-formation-code" required value="${formation.code}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-graduation-cap"></i> Nom *</label>
                    <input type="text" id="edit-formation-name" required value="${formation.name}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-layer-group"></i> Niveau</label>
                    <input type="text" id="edit-formation-level" value="${formation.level || ''}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-building"></i> Département</label>
                    <input type="text" id="edit-formation-department" value="${formation.department || ''}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-align-left"></i> Description</label>
                    <textarea id="edit-formation-description" rows="3">${formation.description || ''}</textarea>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-formation-active" ${formation.is_active ? 'checked' : ''}>
                        Formation active
                    </label>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Modifier
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;
        showModal(modalContent);
        showLoader(false);

        document.getElementById('edit-formation-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);
            try {
                const response = await authenticatedFetch(`/api/admin/formations/${formationId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        code: document.getElementById('edit-formation-code').value,
                        name: document.getElementById('edit-formation-name').value,
                        level: document.getElementById('edit-formation-level').value,
                        department: document.getElementById('edit-formation-department').value,
                        description: document.getElementById('edit-formation-description').value,
                        is_active: document.getElementById('edit-formation-active').checked
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showAlert('La formation a été modifiée avec succès.', 'success');
                    closeModal();
                    loadMaquette();
                } else {
                    showAlert(data.error || 'Impossible de modifier la formation. Le code est peut-être déjà utilisé.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });
    } catch (error) {
        showAlert(humanError(error), 'error');
        showLoader(false);
    }
}

async function deleteFormation(formationId) {
    if (!confirm('Supprimer cette formation et tous ses semestres/UEs/ECs?')) return;
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/admin/formations/${formationId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showAlert('La formation a été supprimée avec succès.', 'success');
            loadMaquette();
        } else {
            showAlert(data.error || 'Impossible de supprimer la formation. Des semestres ou UEs lui sont peut-être encore liés.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// MODALS POUR SEMESTRES
// ============================================================================

function showCreateSemesterModal(formationId) {
    const modalContent = `
        <h2><i class="fas fa-plus"></i> Créer un Semestre</h2>
        <form id="create-semester-form">
            <div class="form-group">
                <label><i class="fas fa-sort-numeric-up"></i> Numéro *</label>
                <input type="number" id="semester-number" required min="1" max="12" placeholder="Ex: 1">
            </div>
            <div class="form-group">
                <label><i class="fas fa-heading"></i> Nom</label>
                <input type="text" id="semester-name" placeholder="Ex: Semestre 1">
            </div>
            <div class="form-group">
                <label><i class="fas fa-star"></i> Crédits totaux</label>
                <input type="number" id="semester-credits" value="30" min="1">
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent);
    
    document.getElementById('create-semester-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/admin/semesters', {
                method: 'POST',
                body: JSON.stringify({
                    formation_id: formationId,
                    number: parseInt(document.getElementById('semester-number').value),
                    name: document.getElementById('semester-name').value,
                    total_credits: parseInt(document.getElementById('semester-credits').value)
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert('Le semestre a été créé avec succès.', 'success');
                closeModal();
                loadMaquette();
            } else {
                showAlert(data.error || 'Impossible de créer le semestre. Vérifiez que le numéro n\'existe pas déjà dans cette formation.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

async function showEditSemesterModal(semesterId) {
    showLoader(true);
    try {
        // Récupérer les infos du semestre
        const response = await authenticatedFetch('/api/formations');
        const formations = await response.json();
        let semester = null;
        
        for (const formation of formations) {
            const semResponse = await authenticatedFetch(`/api/formations/${formation.id}/semesters`);
            const semesters = await semResponse.json();
            semester = semesters.find(s => s.id === semesterId);
            if (semester) break;
        }
        
        if (!semester) {
            showAlert('Semestre introuvable. Il a peut-être été supprimé. Veuillez actualiser la page.', 'error');
            return;
        }
        
        const modalContent = `
            <h2><i class="fas fa-edit"></i> Modifier le Semestre</h2>
            <form id="edit-semester-form">
                <div class="form-group">
                    <label><i class="fas fa-sort-numeric-up"></i> Numéro *</label>
                    <input type="number" id="edit-semester-number" required value="${semester.number}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-heading"></i> Nom</label>
                    <input type="text" id="edit-semester-name" value="${semester.name || ''}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-star"></i> Crédits totaux</label>
                    <input type="number" id="edit-semester-credits" value="${semester.total_credits}">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-semester-active" ${semester.is_active ? 'checked' : ''}>
                        Semestre actif
                    </label>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Modifier
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;
        showModal(modalContent);
        showLoader(false);
        
        document.getElementById('edit-semester-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);
            try {
                const response = await authenticatedFetch(`/api/admin/semesters/${semesterId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        number: parseInt(document.getElementById('edit-semester-number').value),
                        name: document.getElementById('edit-semester-name').value,
                        total_credits: parseInt(document.getElementById('edit-semester-credits').value),
                        is_active: document.getElementById('edit-semester-active').checked
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showAlert('Le semestre a été modifié avec succès.', 'success');
                    closeModal();
                    loadMaquette();
                } else {
                    showAlert(data.error || 'Impossible de modifier le semestre.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });
    } catch (error) {
        showAlert(humanError(error), 'error');
        showLoader(false);
    }
}

async function deleteSemester(semesterId) {
    if (!confirm('Supprimer ce semestre et toutes ses UEs/ECs?')) return;
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/admin/semesters/${semesterId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showAlert('Le semestre et ses UEs/ECs associés ont été supprimés.', 'success');
            loadMaquette();
        } else {
            showAlert(data.error || 'Impossible de supprimer ce semestre. Des ECs ou copies lui sont peut-être encore liés.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// MODALS POUR UEs
// ============================================================================

function showCreateUEModal(semesterId) {
    const modalContent = `
        <h2><i class="fas fa-plus"></i> Créer une UE</h2>
        <form id="create-ue-form">
            <div class="form-group">
                <label><i class="fas fa-code"></i> Code *</label>
                <input type="text" id="ue-code" required placeholder="Ex: UE11">
            </div>
            <div class="form-group">
                <label><i class="fas fa-book-open"></i> Nom *</label>
                <input type="text" id="ue-name" required placeholder="Ex: Systèmes de Communication">
            </div>
            <div class="form-group">
                <label><i class="fas fa-award"></i> Crédits</label>
                <input type="number" id="ue-credits" value="6" min="1">
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent);
    
    document.getElementById('create-ue-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/admin/ues', {
                method: 'POST',
                body: JSON.stringify({
                    semester_id: semesterId,
                    code: document.getElementById('ue-code').value,
                    name: document.getElementById('ue-name').value,
                    credits: parseInt(document.getElementById('ue-credits').value)
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert("L'UE a été créée avec succès.", 'success');
                closeModal();
                loadMaquette();
            } else {
                showAlert(data.error || 'Impossible de créer l\'UE. Le code est peut-être déjà utilisé dans cette formation.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

async function showEditUEModal(ueId) {
    showLoader(true);
    try {
        // Récupérer l'UE
        const response = await authenticatedFetch('/api/ues');
        const ues = await response.json();
        const ue = ues.find(e => e.id === ueId);
        
        if (!ue) {
            showAlert('UE introuvable. Elle a peut-être été supprimée. Veuillez actualiser la page.', 'error');
            return;
        }
        
        const modalContent = `
            <h2><i class="fas fa-edit"></i> Modifier l'UE</h2>
            <form id="edit-ue-form">
                <div class="form-group">
                    <label><i class="fas fa-code"></i> Code *</label>
                    <input type="text" id="edit-ue-code" required value="${ue.code}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-book"></i> Nom *</label>
                    <input type="text" id="edit-ue-name" required value="${ue.name}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-award"></i> Crédits</label>
                    <input type="number" id="edit-ue-credits" value="${ue.credits}">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-ue-active" ${ue.is_active ? 'checked' : ''}>
                        UE active
                    </label>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Modifier
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;
        showModal(modalContent, '700px');
        showLoader(false);
        
        document.getElementById('edit-ue-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);
            try {
                const response = await authenticatedFetch(`/api/admin/ues/${ueId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        code: document.getElementById('edit-ue-code').value,
                        name: document.getElementById('edit-ue-name').value,
                        credits: parseInt(document.getElementById('edit-ue-credits').value),
                        is_active: document.getElementById('edit-ue-active').checked
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showAlert("L'UE a été modifiée avec succès.", 'success');
                    closeModal();
                    loadMaquette();
                } else {
                    showAlert(data.error || 'Impossible de modifier l\'UE. Le code est peut-être déjà utilisé.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });
    } catch (error) {
        showAlert(humanError(error), 'error');
        showLoader(false);
    }
}

async function deleteUE(ueId) {
    if (!confirm('Supprimer cette UE et tous ses ECs?')) return;
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/admin/ues/${ueId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        if (data.success) {
            showAlert("L'UE et ses ECs associés ont été supprimés.", 'success');
            loadMaquette();
        } else {
            showAlert(data.error || 'Impossible de supprimer cette UE. Des copies ou examens lui sont peut-être liés.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// MODALS POUR ECs
// ============================================================================

function showCreateECModal(ueId) {
    const modalContent = `
        <h2><i class="fas fa-plus"></i> Créer un EC</h2>
        <form id="create-ec-form">
            <div class="form-group">
                <label><i class="fas fa-code"></i> Code *</label>
                <input type="text" id="ec-code" required placeholder="Ex: EC111">
            </div>
            <div class="form-group">
                <label><i class="fas fa-book"></i> Nom *</label>
                <input type="text" id="ec-name" required placeholder="Ex: Théorie de l'Information">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label><i class="fas fa-chalkboard-teacher"></i> CM (h)</label>
                    <input type="number" id="ec-cm" value="0" min="0">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-users"></i> TD (h)</label>
                    <input type="number" id="ec-td" value="0" min="0">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-flask"></i> TP (h)</label>
                    <input type="number" id="ec-tp" value="0" min="0">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label><i class="fas fa-home"></i> TPE (h)</label>
                    <input type="number" id="ec-tpe" value="0" min="0">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-clock"></i> VHT (h)</label>
                    <input type="number" id="ec-vht" value="0" min="0">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-balance-scale"></i> Coefficient</label>
                    <input type="number" id="ec-coefficient" value="1" min="1">
                </div>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    showModal(modalContent, '700px');
    
    document.getElementById('create-ec-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        try {
            const response = await authenticatedFetch('/api/admin/ecs', {
                method: 'POST',
                body: JSON.stringify({
                    ue_id: ueId,
                    code: document.getElementById('ec-code').value,
                    name: document.getElementById('ec-name').value,
                    cm: parseInt(document.getElementById('ec-cm').value),
                    td: parseInt(document.getElementById('ec-td').value),
                    tp: parseInt(document.getElementById('ec-tp').value),
                    tpe: parseInt(document.getElementById('ec-tpe').value),
                    vht: parseInt(document.getElementById('ec-vht').value),
                    coefficient: parseInt(document.getElementById('ec-coefficient').value)
                })
            });
            const data = await response.json();
            if (data.success) {
                showAlert("L'EC a été créé avec succès.", 'success');
                closeModal();
                loadMaquette();
            } else {
                showAlert(data.error || 'Impossible de créer l\'EC. Le code est peut-être déjà utilisé dans cette UE.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

async function showEditECModal(ecId) {
    showLoader(true);
    try {
        // Récupérer l'EC
        const response = await authenticatedFetch('/api/ecs');
        const ecs = await response.json();
        const ec = ecs.find(e => e.id === ecId);
        
        if (!ec) {
            showAlert('EC introuvable. Il a peut-être été supprimé. Veuillez actualiser la page.', 'error');
            return;
        }
        
        const modalContent = `
            <h2><i class="fas fa-edit"></i> Modifier l'EC</h2>
            <form id="edit-ec-form">
                <div class="form-group">
                    <label><i class="fas fa-code"></i> Code *</label>
                    <input type="text" id="edit-ec-code" required value="${ec.code}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-book"></i> Nom *</label>
                    <input type="text" id="edit-ec-name" required value="${ec.name}">
                </div>
                <div class="form-group">
                    <label><i class="fas fa-award"></i> Crédits</label>
                    <input type="number" id="edit-ec-credits" value="${ec.credits}">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" id="edit-ec-active" ${ec.is_active ? 'checked' : ''}>
                        EC actif
                    </label>
                </div>
                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Modifier
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;
        showModal(modalContent, '700px');
        showLoader(false);
        
        document.getElementById('edit-ec-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);
            try {
                const response = await authenticatedFetch(`/api/admin/ecs/${ecId}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        code: document.getElementById('edit-ec-code').value,
                        name: document.getElementById('edit-ec-name').value,
                        cm: parseInt(document.getElementById('edit-ec-cm').value),
                        td: parseInt(document.getElementById('edit-ec-td').value),
                        tp: parseInt(document.getElementById('edit-ec-tp').value),
                        tpe: parseInt(document.getElementById('edit-ec-tpe').value),
                        vht: parseInt(document.getElementById('edit-ec-vht').value),
                        coefficient: parseInt(document.getElementById('edit-ec-coefficient').value),
                        is_active: document.getElementById('edit-ec-active').checked
                    })
                });
                const data = await response.json();
                if (data.success) {
                    showAlert("L'EC a été modifié avec succès.", 'success');
                    closeModal();
                    loadMaquette();
                } else {
                    showAlert(data.error || 'Impossible de modifier l\'EC. Le code est peut-être déjà utilisé.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });
    } catch (error) {
        showAlert(humanError(error), 'error');
        showLoader(false);
    }
}

// ============================================================================
// EXPORT PDF
// ============================================================================
async function exportPaperPDF(paperId) {
    showLoader(true);
    try {
        const response = await fetch(`/api/papers/${paperId}/export`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
       
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `copie_${paperId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showAlert('La copie corrigée a été téléchargée en PDF avec succès.', 'success');
        } else {
            showAlert('Impossible de générer le PDF. Veuillez réessayer.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// IMPORT CSV - UTILISATEURS
// ============================================================================

function showImportUsersModal() {
    const modalContent = `
        <h2>Import Bulk Utilisateurs</h2>
        <p>Importez plusieurs utilisateurs à la fois via un fichier CSV</p>
        
        <div class="alert alert-info">
            <strong>Instructions :</strong>
            <ol style="margin: 10px 0 0 20px;">
                <li>Téléchargez le template CSV</li>
                <li>Remplissez-le avec les données (full_name, email, password, role)</li>
                <li>Rôles possibles : <code>student</code>, <code>professor</code>, <code>admin</code></li>
                <li>Uploadez le fichier</li>
            </ol>
        </div>
        
        <div style="display: flex; gap: 12px; margin: 20px 0;">
            <button class="btn btn-info" onclick="downloadUsersTemplate()">
                <i class="fa fa-download"></i> Télécharger Template CSV
            </button>
        </div>
        
        <form id="import-users-form">
            <div class="form-group">
                <label>Fichier CSV *</label>
                <input type="file" id="users-csv-file" accept=".csv" required>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-success">
                    <i class="fa fa-upload"></i> Importer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button>
            </div>
        </form>
        
        <div id="import-results" style="display: none; margin-top: 20px;"></div>
    `;
    
    showModal(modalContent, '700px');
    
    document.getElementById('import-users-form').addEventListener('submit', handleImportUsers);
}

async function downloadUsersTemplate() {
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/admin/users/csv-template');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `template_utilisateurs_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showAlert('Le fichier template a été téléchargé avec succès.', 'success');
        } else {
            showAlert('Impossible de télécharger le fichier. Veuillez réessayer.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function handleImportUsers(e) {
    e.preventDefault();
    showLoader(true);
    
    const fileInput = document.getElementById('users-csv-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Veuillez sélectionner un fichier', 'error');
        showLoader(false);
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/admin/users/import-csv', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
             let resultsHTML = `
                 <div class="alert alert-success">
                     <strong>✅ ${data.created} utilisateur(s) créé(s)</strong>
                     ${data.emails_sent > 0 ? `<br>📧 ${data.emails_sent} email(s) de notification envoyé(s)` : ''}
                     ${data.emails_sent < data.created ? '<br>⚠️ Certains emails n\'ont pas pu être envoyés (timeout SMTP)' : ''}
                 </div>
            `;
            
            if (data.users && data.users.length > 0) {
                resultsHTML += '<h4>Utilisateurs créés :</h4><ul>';
                data.users.forEach(u => {
                    resultsHTML += `<li><strong>${u.full_name}</strong> (${u.email}) - ${u.role}</li>`;
                });
                resultsHTML += '</ul>';
            }
            
            if (data.errors > 0) {
                resultsHTML += `
                    <div class="alert alert-warning mt-2">
                        <strong>⚠️ ${data.errors} erreur(s)</strong>
                        <ul style="margin: 10px 0 0 20px;">
                            ${data.error_details.map(err => `<li>${err}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            
            document.getElementById('import-results').innerHTML = resultsHTML;
            document.getElementById('import-results').style.display = 'block';
            
            showAlert(`Import CSV terminé : ${data.created} utilisateur(s) créé(s), ${data.errors} erreur(s).`, 'success');

            // Recharger la liste après 2 secondes
            setTimeout(() => {
                closeModal();
                loadUsers();
            }, 2000);
        } else {
            showAlert(data.error || 'Impossible d\'importer le fichier CSV. Vérifiez le format et les colonnes requises.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// IMPORT CSV - MAQUETTE
// ============================================================================

function showImportMaquetteModal() {
    const modalContent = `
        <h2>Import Bulk Maquette</h2>
        <p>Importez formations, semestres, UEs et ECs via CSV</p>
        
        <div class="alert alert-info">
            <strong>Instructions: </strong>
            <ol style="margin: 10px 0 0 20px;">
                <li>Téléchargez le template CSV</li>
                <li>Remplissez ligne par ligne : d'abord formations, puis semestres, puis UEs, puis ECs</li>
                <li>Respectez l'ordre hiérarchique</li>
                <li>Uploadez le fichier</li>
            </ol>
        </div>
        
        <div style="display: flex; gap: 12px; margin: 20px 0;">
            <button class="btn btn-info" onclick="downloadMaquetteTemplate()">
                <i class="fa fa-download"></i> Télécharger Template CSV
            </button>
        </div>
        
        <form id="import-maquette-form">
            <div class="form-group">
                <label>Fichier CSV *</label>
                <input type="file" id="maquette-csv-file" accept=".csv" required>
            </div>
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-success">
                    <i class="fa fa-upload"></i> Importer
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">Annuler</button>
            </div>
        </form>
        
        <div id="maquette-import-results" style="display: none; margin-top: 20px;"></div>
    `;
    
    showModal(modalContent, '700px');
    
    document.getElementById('import-maquette-form').addEventListener('submit', handleImportMaquette);
}

async function downloadMaquetteTemplate() {
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/admin/maquette/csv-template');
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `template_maquette_${new Date().toISOString().split('T')[0]}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showAlert('Le fichier template a été téléchargé avec succès.', 'success');
        } else {
            showAlert('Impossible de télécharger le fichier. Veuillez réessayer.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function handleImportMaquette(e) {
    e.preventDefault();
    showLoader(true);
    
    const fileInput = document.getElementById('maquette-csv-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Veuillez sélectionner un fichier', 'error');
        showLoader(false);
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/api/admin/maquette/import-csv', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` },
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            let resultsHTML = `
                <div class="alert alert-success">
                    <strong>✅ Import réussi !</strong><br>
                    • Formations: ${data.created.formations || 0}<br>
                    • Semestres: ${data.created.semesters || 0}<br>
                    • UEs: ${data.created.ues || 0}<br>
                    • ECs: ${data.created.ecs || 0}
                </div>
            `;
            
            if (data.errors && data.errors.length > 0) {
                resultsHTML += `
                    <div class="alert alert-warning mt-2">
                        <strong>⚠️ ${data.errors.length} erreur(s)</strong>
                        <ul style="margin: 10px 0 0 20px;">
                            ${data.errors.map(err => `<li>${err}</li>`).join('')}
                        </ul>
                    </div>
                `;
            }
            
            document.getElementById('maquette-import-results').innerHTML = resultsHTML;
            document.getElementById('maquette-import-results').style.display = 'block';
            
            showAlert('La maquette pédagogique a été importée avec succès.', 'success');

            // Recharger la maquette après 2 secondes
            setTimeout(() => {
                closeModal();
                loadMaquette();
            }, 2000);
        } else {
            showAlert(data.error || 'Impossible d\'importer la maquette. Vérifiez le format du fichier CSV et les colonnes requises.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }

  }
// ============================================================================
// FONCTIONS MANQUANTES : GESTION DES RÉCLAMATIONS (PROFESSEUR)
// ============================================================================

async function showRespondReclamationModal(reclamationId) {
    showLoader(true);
    
    try {
        // Récupérer les détails de la réclamation
        const response = await authenticatedFetch('/api/reclamations');
        const reclamations = await response.json();
        const reclamation = reclamations.find(r => r.id === reclamationId);

        if (!reclamation) {
            showAlert('Réclamation introuvable. Veuillez actualiser la liste.', 'error');
            showLoader(false);
            return;
        }

        // Récupérer les détails selon le type : copie papier ou examen en ligne
        let currentScore = 0;
        let feedbackHtml = 'Aucun feedback disponible';
        let viewDetailBtn = '';

        if (reclamation.paper_id) {
            const paperResponse = await authenticatedFetch(`/api/papers/detail/${reclamation.paper_id}`);
            const paper = await paperResponse.json();
            currentScore = paper.score || 0;
            feedbackHtml = paper.feedback || feedbackHtml;
            viewDetailBtn = `<button class="btn btn-sm btn-info" onclick="viewPaperDetail(${paper.id})">
                                <i class="fas fa-eye"></i> Voir la copie complète
                             </button>`;
        } else if (reclamation.attempt_id) {
            // Score et feedback déjà inclus dans l'objet réclamation (attempt_score / attempt_feedback)
            currentScore = reclamation.attempt_score != null ? reclamation.attempt_score : 0;
            feedbackHtml = reclamation.attempt_feedback || feedbackHtml;
            viewDetailBtn = `<span style="font-size:12px;color:#64748b;">
                <i class="fas fa-laptop-code"></i> Examen en ligne — ${reclamation.exam_title || reclamation.subject_title || ''}
            </span>`;
        }

        const modalContent = `
            <h2><i class="fas fa-reply"></i> Répondre à la Réclamation</h2>

            <div class="alert alert-info" style="margin-bottom: 20px;">
                <h4><i class="fas fa-info-circle"></i> Détails de la Réclamation</h4>
                <p><strong>Étudiant:</strong> ${reclamation.student_name}</p>
                <p><strong>Sujet:</strong> ${reclamation.subject_title || (reclamation.attempt_id ? 'Examen en ligne' : '—')}</p>
                <p><strong>Date:</strong> ${new Date(reclamation.created_at).toLocaleString('fr-FR')}</p>
                <p><strong>Raison:</strong></p>
                <div style="background: white; padding: 10px; border-radius: 4px; margin-top: 8px;">
                    ${reclamation.reason}
                </div>
            </div>

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-file-alt"></i> Copie ${reclamation.attempt_id ? 'Examen en Ligne' : 'Corrigée'}</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong>Note actuelle:</strong> <span style="font-size: 24px; color: ${currentScore >= 10 ? '#10b981' : '#ef4444'}; font-weight: bold;">${currentScore}/20</span></p>

                    <div style="margin-top: 15px;">
                        <strong><i class="fas fa-comment"></i> Feedback initial:</strong>
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; margin-top: 8px; max-height: 200px; overflow-y: auto; white-space: pre-wrap;">
${feedbackHtml}
                        </div>
                    </div>

                    <div style="margin-top: 15px;">${viewDetailBtn}</div>
                </div>
            </div>

            ${reclamation.ia_proposed_status ? `
                <div class="alert alert-warning" style="margin-bottom: 20px;">
                    <h4><i class="fas fa-robot"></i> Proposition de l'IA</h4>
                    <p><strong>Statut suggéré:</strong> ${reclamation.ia_proposed_status === 'resolved' ? '✅ Accepter' : '❌ Rejeter'}</p>
                    <p><strong>Raison:</strong></p>
                    <div style="background: white; padding: 10px; border-radius: 4px; margin-top: 8px;">
                        ${reclamation.ia_proposed_reason}
                    </div>
                    ${reclamation.ia_proposed_score ? `<p><strong>Note proposée:</strong> ${reclamation.ia_proposed_score}/20</p>` : ''}
                </div>
            ` : ''}

            <form id="respond-reclamation-form">
                <div class="form-group">
                    <label><i class="fas fa-tasks"></i> Décision *</label>
                    <select id="reclamation-status" required>
                        <option value="">-- Choisir --</option>
                        <option value="resolved">✅ Accepter la réclamation</option>
                        <option value="rejected">❌ Rejeter la réclamation</option>
                    </select>
                </div>

                <div class="form-group" id="new-score-group" style="display: none;">
                    <label><i class="fas fa-star"></i> Nouvelle Note (sur 20)</label>
                    <input type="number" id="reclamation-new-score" min="0" max="20" step="0.5" value="${currentScore}">
                    <small class="form-help">Note actuelle: ${currentScore}/20</small>
                </div>

                <div class="form-group">
                    <label><i class="fas fa-comment"></i> Réponse au professeur/étudiant *</label>
                    <textarea id="reclamation-response" rows="5" required placeholder="Expliquez votre décision..."></textarea>
                </div>

                <div class="d-flex gap-2 mt-2">
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-paper-plane"></i> Envoyer la Réponse
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                </div>
            </form>
        `;

        showModal(modalContent, '900px');
        showLoader(false);

        // Afficher/masquer le champ nouvelle note selon la décision
        document.getElementById('reclamation-status').addEventListener('change', function() {
            const newScoreGroup = document.getElementById('new-score-group');
            if (this.value === 'resolved') {
                newScoreGroup.style.display = 'block';
            } else {
                newScoreGroup.style.display = 'none';
            }
        });

        // Gestionnaire de soumission
        document.getElementById('respond-reclamation-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            showLoader(true);

            try {
                const status = document.getElementById('reclamation-status').value;
                const response = document.getElementById('reclamation-response').value;
                const newScore = status === 'resolved' ? parseFloat(document.getElementById('reclamation-new-score').value) : null;

                const requestData = {
                    status: status,
                    response: response
                };

                if (newScore !== null) {
                    requestData.new_score = newScore;
                }

                const updateResponse = await authenticatedFetch(`/api/reclamations/${reclamationId}`, {
                    method: 'PUT',
                    body: JSON.stringify(requestData)
                });

                const data = await updateResponse.json();

                if (data.success) {
                    showAlert("Votre réponse a été envoyée. L'étudiant sera notifié de votre décision.", 'success');
                    closeModal();
                    loadReclamations();
                } else {
                    showAlert(data.error || 'Impossible d\'envoyer la réponse à la réclamation.', 'error');
                }
            } catch (error) {
                showAlert(humanError(error), 'error');
            } finally {
                showLoader(false);
            }
        });

    } catch (error) {
        showAlert('Impossible de charger les détails. Veuillez réessayer.', 'error');
        showLoader(false);
    }
}

async function processReclamationIA(reclamationId) {
    if (!confirm('Voulez-vous que l\'IA analyse cette réclamation et propose une décision ?')) {
        return;
    }

    showLoader(true);

    try {
        // Appeler l'endpoint IA
        const response = await authenticatedFetch(`/api/reclamations/${reclamationId}/process_ia`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            showAlert('Analyse IA terminée! Consultez la proposition.', 'success');
            
            // Afficher le résultat dans un modal
            const modalContent = `
                <h2><i class="fas fa-robot"></i> Proposition de l'IA</h2>
                
                <div class="alert alert-info">
                    <h4><i class="fas fa-lightbulb"></i> Analyse Complétée</h4>
                    <p>L'IA a analysé la réclamation et la copie de l'étudiant.</p>
                </div>

                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-tasks"></i> Décision Suggérée</h4>
                    </div>
                    <div style="padding: 15px;">
                        <p style="font-size: 20px; font-weight: bold; color: ${data.ia_proposed_status === 'resolved' ? '#10b981' : '#ef4444'};">
                            ${data.ia_proposed_status === 'resolved' ? '✅ Accepter la réclamation' : '❌ Rejeter la réclamation'}
                        </p>
                    </div>
                </div>

                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-comment"></i> Justification</h4>
                    </div>
                    <div style="padding: 15px;">
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; white-space: pre-wrap;">
${data.ia_decision || data.ia_proposed_reason || 'Aucune justification fournie'}
                        </div>
                    </div>
                </div>

                ${data.ia_proposed_score ? `
                    <div class="card" style="margin-bottom: 20px;">
                        <div class="card-header">
                            <h4><i class="fas fa-star"></i> Note Proposée</h4>
                        </div>
                        <div style="padding: 15px;">
                            <p style="font-size: 24px; font-weight: bold; color: #3b82f6;">
                                ${data.ia_proposed_score}/20
                            </p>
                            <small style="color: #64748b;">Note actuelle: ${data.current_score}/20</small>
                        </div>
                    </div>
                ` : ''}

                <div class="alert alert-warning">
                    <i class="fas fa-exclamation-triangle"></i> 
                    <strong>Important:</strong> Cette proposition est une aide à la décision. 
                    Vous devez l'examiner et valider manuellement via le bouton "Répondre".
                </div>

                <div style="display: flex; gap: 12px; margin-top: 20px;">
                    <button class="btn btn-primary" onclick="closeModal(); showRespondReclamationModal(${reclamationId})">
                        <i class="fas fa-reply"></i> Répondre Maintenant
                    </button>
                    <button class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Fermer
                    </button>
                </div>
            `;

            showModal(modalContent, '800px');

            // Recharger les réclamations pour voir la mise à jour
            loadReclamations();
        } else {
            showAlert(data.error || 'Impossible d\'analyser cette réclamation avec l\'IA.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// FONCTION MANQUANTE : VOIR DÉTAIL D'UNE COPIE
// ============================================================================

async function viewPaperDetail(paperId) {
    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/papers/detail/${paperId}`);
        
        if (!response.ok) {
            throw new Error('Erreur lors du chargement de la copie');
        }

        const paper = await response.json();

        const scoreClass = paper.score >= 10 ? 'success' : 'danger';

        const modalContent = `
            <h2><i class="fas fa-file-alt"></i> Détails de la Copie</h2>

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-info-circle"></i> Informations Générales</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong><i class="fas fa-user"></i> Étudiant:</strong> ${paper.student_name}</p>
                    <p><strong><i class="fas fa-book"></i> Sujet:</strong> ${paper.subject_title}</p>
                    <p><strong><i class="fas fa-star"></i> Note:</strong> 
                        <span style="font-size: 24px; color: ${paper.score >= 10 ? '#10b981' : '#ef4444'}; font-weight: bold;">
                            ${paper.score}/20
                        </span>
                    </p>
                    <p><strong><i class="fas fa-calendar"></i> Date de correction:</strong> ${new Date(paper.corrected_at).toLocaleString('fr-FR')}</p>
                </div>
            </div>

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-file-alt"></i> Contenu de la Copie</h4>
                </div>
                <div style="padding: 15px;">
                    <div style="max-height: 300px; overflow-y: auto; padding: 12px; background: #f8fafc; border-radius: 6px; white-space: pre-wrap; font-family: monospace; font-size: 13px;">
${paper.content}
                    </div>
                </div>
            </div>

            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-comment"></i> Feedback de Correction</h4>
                </div>
                <div style="padding: 15px;">
                    <div style="max-height: 300px; overflow-y: auto; padding: 12px; background: #f1f5f9; border-radius: 6px; white-space: pre-wrap; font-family: monospace; font-size: 13px;">
${paper.grade || paper.feedback || 'Aucun feedback disponible'}
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 12px; margin-top: 20px;">
                <button class="btn btn-primary" onclick="exportPaperPDF(${paper.id})">
                    <i class="fas fa-file-pdf"></i> Télécharger PDF
                </button>
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;

        showModal(modalContent, '900px');

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// EXAMENS EN LIGNE - GESTION (PROFESSEUR)
// ============================================================================

async function loadOnlineExams() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    if (window._onlineExamsTimer) { clearTimeout(window._onlineExamsTimer); window._onlineExamsTimer = null; }
    window._currentView = loadOnlineExams;
    showLoader(true);

    try {
        const response = await authenticatedFetch('/api/online_exams');
        const exams = await response.json();

        const isProfOrAdmin = currentUser.role === 'professor' || currentUser.role === 'admin';
        const stats = {
            total: exams.length,
            active: exams.filter(e => e.status === 'active').length,
            scheduled: exams.filter(e => e.status === 'scheduled').length,
            closed: exams.filter(e => e.status === 'closed').length,
        };

        let html = `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;margin-bottom:28px;">
                <div>
                    <h2 style="font-size:24px;font-weight:700;color:#0f172a;margin:0;display:flex;align-items:center;gap:12px;">
                        <span style="background:#3b82f6;width:44px;height:44px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <i class="fas fa-laptop-code" style="color:white;font-size:18px;"></i>
                        </span>
                        Examens en Ligne
                    </h2>
                    <p style="color:#64748b;margin:6px 0 0 56px;font-size:13px;">
                        Créez et gérez des examens avec surveillance anti-triche
                    </p>
                </div>
                ${isProfOrAdmin ? `
                <button class="btn btn-primary" onclick="showCreateOnlineExamModal()"
                    style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;">
                    <i class="fas fa-plus"></i> Créer un Examen
                </button>` : `
                <button onclick="showStudentExamHistory()"
                    style="display:inline-flex;align-items:center;gap:8px;padding:9px 18px;background:#ede9fe;color:#6366f1;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                    <i class="fas fa-history"></i> Mon historique
                </button>`}
            </div>
        `;

        // Stats row (prof/admin only)
        if (isProfOrAdmin && exams.length > 0) {
            const statItems = [
                { label: 'Total', value: stats.total, icon: 'fa-list', color: '#3b82f6', bg: 'rgba(59,130,246,.1)' },
                { label: 'En cours', value: stats.active, icon: 'fa-play-circle', color: '#10b981', bg: 'rgba(16,185,129,.1)' },
                { label: 'Planifiés', value: stats.scheduled, icon: 'fa-calendar-alt', color: '#f59e0b', bg: 'rgba(245,158,11,.1)' },
                { label: 'Terminés', value: stats.closed, icon: 'fa-check-circle', color: '#ef4444', bg: 'rgba(239,68,68,.1)' },
            ];
            html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:14px;margin-bottom:28px;">`;
            statItems.forEach(s => {
                html += `
                <div style="background:white;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;">
                    <div style="background:${s.bg};width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas ${s.icon}" style="color:${s.color};font-size:16px;"></i>
                    </div>
                    <div>
                        <div style="font-size:22px;font-weight:700;color:#0f172a;line-height:1.1;">${s.value}</div>
                        <div style="font-size:11px;color:#64748b;font-weight:500;margin-top:2px;">${s.label}</div>
                    </div>
                </div>`;
            });
            html += `</div>`;
        }

        if (exams.length === 0) {
            html += `
                <div style="text-align:center;padding:64px 24px;background:white;border-radius:16px;box-shadow:0 1px 4px rgba(0,0,0,.06);border:1px solid #f1f5f9;">
                    <i class="fas fa-laptop-code" style="font-size:52px;color:#cbd5e1;display:block;margin-bottom:16px;"></i>
                    <h3 style="color:#475569;font-size:18px;font-weight:600;margin:0 0 8px;">Aucun examen disponible</h3>
                    ${isProfOrAdmin ? `
                    <p style="color:#94a3b8;font-size:14px;margin:0 0 24px;">Créez votre premier examen en ligne avec surveillance intégrée.</p>
                    <button class="btn btn-primary" onclick="showCreateOnlineExamModal()">
                        <i class="fas fa-plus"></i> Créer un Examen
                    </button>` : `<p style="color:#94a3b8;font-size:14px;margin:0;">Aucun examen disponible pour le moment.</p>`}
                </div>
            `;
        } else {
            const statusConfig = {
                'draft':     { label: 'Brouillon', color: '#64748b', bg: '#f1f5f9', bar: '#cbd5e1', icon: 'fa-edit' },
                'scheduled': { label: 'Planifié',  color: '#d97706', bg: '#fffbeb', bar: '#fcd34d', icon: 'fa-calendar-alt' },
                'active':    { label: 'En cours',  color: '#059669', bg: '#ecfdf5', bar: '#34d399', icon: 'fa-play-circle' },
                'closed':    { label: 'Terminé',   color: '#dc2626', bg: '#fff1f2', bar: '#fca5a5', icon: 'fa-check-circle' },
            };
            const fmtOpts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dakar' };

            html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px;">`;

            exams.forEach(exam => {
                const now = new Date();
                const startTime = new Date(exam.start_time);
                const endTime = new Date(exam.end_time);
                const isAvailableNow = now >= startTime && now <= endTime;
                // Statut effectif côté client : si active mais end_time passé → closed
                const effectiveStatus = (exam.status === 'active' && now > endTime) ? 'closed' : exam.status;
                const sc = statusConfig[effectiveStatus] || statusConfig['draft'];
                const canCompose = isAvailableNow && (exam.status === 'active' || exam.status === 'scheduled');
                const safeTitle = (exam.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

                const startStr = startTime.toLocaleString('fr-FR', fmtOpts);
                const endStr = endTime.toLocaleString('fr-FR', fmtOpts);
                const dH = Math.floor(exam.duration_minutes / 60);
                const dM = exam.duration_minutes % 60;
                const durationStr = dH > 0 ? (dM > 0 ? `${dH}h${String(dM).padStart(2,'0')}` : `${dH}h`) : `${dM} min`;

                // Security chips
                const chipStyle = (bg, color) => `background:${bg};color:${color};padding:3px 9px;border-radius:99px;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;`;
                let secChips = `<span style="${chipStyle('#fff7ed','#c2410c')}" title="Seuil changements de fenêtre"><i class="fas fa-exchange-alt"></i> ${exam.max_tab_switches} chgt${exam.max_tab_switches !== 1 ? 's' : ''}</span>`;
                const maxNF = exam.max_no_face_count != null ? exam.max_no_face_count : 10;
                if (maxNF >= 0) secChips += `<span style="${chipStyle('#fef2f2','#ef4444')}" title="Seuil visage absent"><i class="fas fa-eye-slash"></i> ${maxNF} visage${maxNF !== 1 ? 's' : ''}</span>`;
                if (exam.ban_on_devtools) secChips += `<span style="${chipStyle('#fdf4ff','#7c3aed')}" title="Bannissement si outils dev"><i class="fas fa-terminal"></i> Dev ban</span>`;
                if (!exam.enable_copy_paste) secChips += `<span style="${chipStyle('#f1f5f9','#64748b')}" title="Copier/Coller interdit"><i class="fas fa-ban"></i> C/C</span>`;
                if (!exam.enable_right_click) secChips += `<span style="${chipStyle('#f1f5f9','#64748b')}" title="Clic droit interdit"><i class="fas fa-ban"></i> Clic droit</span>`;
                if (exam.auto_correct) secChips += `<span style="${chipStyle('#f0fdf4','#15803d')}" title="Correction automatique par IA activée"><i class="fas fa-robot"></i> IA auto</span>`;
                if (isProfOrAdmin && exam.attempts_count > 0) {
                    secChips += `<span style="${chipStyle('rgba(99,102,241,.1)','#6366f1')}"><i class="fas fa-users"></i> ${exam.attempts_count}</span>`;
                }

                // Action buttons
                let actionsHTML = '';
                if (currentUser.role === 'student') {
                    const att = exam.my_attempt;
                    if (att) {
                        if (att.status === 'in_progress' && canCompose) {
                            // Examen en cours — permettre de reprendre
                            actionsHTML = `<button class="btn btn-sm" onclick="startOnlineExam(${exam.id})" style="flex:1;background:#f59e0b;color:white;border:none;"><i class="fas fa-redo"></i> Reprendre</button>`;
                        } else if (att.corrected_at) {
                            // Corrigé — afficher la note
                            const scoreVal = att.score !== null ? att.score.toFixed(2) : '—';
                            const scoreColor = att.score >= 10 ? '#10b981' : '#ef4444';
                            actionsHTML = `
                                <span style="font-size:13px;font-weight:700;color:${scoreColor};display:flex;align-items:center;gap:5px;">
                                    <i class="fas fa-star"></i> ${scoreVal}/20
                                </span>
                                <button class="btn btn-sm btn-primary" onclick="viewMyExamResult(${att.id})" style="flex:1;">
                                    <i class="fas fa-eye"></i> Voir ma note
                                </button>`;
                        } else if (att.status === 'banned') {
                            actionsHTML = `<span style="color:#ef4444;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-ban"></i> Exclu de l'examen</span>`;
                        } else if (att.submitted_at) {
                            // Soumis, correction en attente
                            actionsHTML = `<span style="color:#f59e0b;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-hourglass-half"></i> Correction en cours…</span>`;
                        } else {
                            // Tentative existante non soumise mais examen fermé — bouton grisé
                            actionsHTML = `<button class="btn btn-sm" disabled style="flex:1;background:#f1f5f9;color:#94a3b8;cursor:not-allowed;border:1px solid #e2e8f0;opacity:0.8;"><i class="fas fa-check-circle"></i> Déjà composé</button>`;
                        }
                    } else if (canCompose) {
                        // Aucune tentative — l'étudiant peut composer
                        actionsHTML = `<button class="btn btn-success btn-sm" onclick="startOnlineExam(${exam.id})" style="flex:1;"><i class="fas fa-play"></i> Composer</button>`;
                    } else if (now < startTime) {
                        actionsHTML = `<button class="btn btn-sm" style="flex:1;background:#fffbeb;color:#d97706;border:1px solid #fcd34d;cursor:pointer;" onclick="showExamNotStartedInfo('${exam.start_time}','${safeTitle}')"><i class="fas fa-clock"></i> Pas encore ouvert</button>`;
                    } else {
                        actionsHTML = `<span style="color:#94a3b8;font-size:13px;display:flex;align-items:center;gap:6px;"><i class="fas fa-check"></i> Terminé</span>`;
                    }
                } else {
                    actionsHTML += `<button class="btn btn-sm" onclick="viewOnlineExamDetails(${exam.id})" title="Détails" style="background:#f1f5f9;color:#475569;flex:1;"><i class="fas fa-eye"></i> Détails</button>`;
                    if (exam.status === 'closed' && exam.attempts_count > 0) {
                        actionsHTML += `<button class="btn btn-sm btn-primary" onclick="viewExamSubmissions(${exam.id})" title="Voir les copies" style="flex:1;"><i class="fas fa-file-alt"></i> Copies</button>`;
                    }
                    // Gestion des surveillants : disponible dès la création (draft/scheduled/active), pas après clôture
                    if (isProfOrAdmin && exam.status !== 'closed') {
                        actionsHTML += `<button class="btn btn-sm" onclick="showManageProctorsModal(${exam.id})" title="Gérer les surveillants affectés à cet examen" style="background:rgba(245,158,11,.1);color:#d97706;flex:1;"><i class="fas fa-user-shield"></i> Surveillants</button>`;
                    }
                    if (exam.status === 'active') {
                        actionsHTML += `<button class="btn btn-sm" onclick="openProctoringDashboard(${exam.id})" title="Surveiller en temps réel" style="background:rgba(124,58,237,.1);color:#7c3aed;flex:1;"><i class="fas fa-shield-alt"></i> Surveiller</button>`;
                        actionsHTML += `<button class="btn btn-sm" onclick="extendExam(${exam.id})" title="Rallonger la durée" style="background:rgba(16,185,129,.1);color:#059669;flex:1;"><i class="fas fa-clock"></i> Rallonger</button>`;
                        actionsHTML += `<button class="btn btn-sm btn-danger" onclick="closeExam(${exam.id})" title="Clôturer" style="flex:1;"><i class="fas fa-stop-circle"></i> Clôturer</button>`;
                    }
                    if (exam.status === 'scheduled' || exam.status === 'draft') {
                        actionsHTML += `<button class="btn btn-sm btn-success" onclick="activateExam(${exam.id})" title="Activer" style="flex:1;"><i class="fas fa-play-circle"></i> Activer</button>`;
                        actionsHTML += `<button class="btn btn-sm" onclick="extendExam(${exam.id})" title="Rallonger la durée" style="background:rgba(16,185,129,.1);color:#059669;flex:1;"><i class="fas fa-clock"></i> Rallonger</button>`;
                    }
                    actionsHTML += `<button class="btn btn-sm" onclick="deleteOnlineExam(${exam.id}, '${safeTitle}', ${exam.attempts_count || 0})" title="Supprimer" style="background:rgba(239,68,68,.1);color:#ef4444;padding:8px 12px;flex-shrink:0;"><i class="fas fa-trash"></i></button>`;
                }

                html += `
                <div style="background:white;border-radius:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);border:1px solid #f1f5f9;overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .2s,transform .2s;"
                     onmouseenter="this.style.boxShadow='0 8px 24px rgba(0,0,0,.1)';this.style.transform='translateY(-2px)'"
                     onmouseleave="this.style.boxShadow='0 1px 4px rgba(0,0,0,.07)';this.style.transform='translateY(0)'">
                    <div style="height:4px;background:${sc.bar};"></div>
                    <div style="padding:18px 20px;flex:1;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;">
                            <h3 style="font-size:15px;font-weight:700;color:#0f172a;margin:0;line-height:1.35;flex:1;">${exam.title}</h3>
                            <span style="background:${sc.bg};color:${sc.color};padding:4px 10px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap;flex-shrink:0;display:inline-flex;align-items:center;gap:4px;">
                                <i class="fas ${sc.icon}"></i> ${sc.label}
                            </span>
                        </div>
                        <div style="display:flex;align-items:center;gap:7px;color:#64748b;font-size:13px;margin-bottom:${isProfOrAdmin ? '6px' : '12px'};">
                            <i class="fas fa-book" style="color:#3b82f6;width:13px;"></i>
                            <span>${exam.subject_title || 'Sans sujet'}</span>
                        </div>
                        ${isProfOrAdmin ? `
                        <div style="display:flex;align-items:center;gap:7px;color:#94a3b8;font-size:12px;margin-bottom:12px;">
                            <i class="fas fa-user" style="width:13px;"></i>
                            <span>${exam.creator_name || ''}</span>
                        </div>` : ''}
                        <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;margin-bottom:12px;border:1px solid #f1f5f9;">
                            <div style="display:flex;align-items:center;gap:8px;color:#475569;font-size:12px;margin-bottom:5px;">
                                <i class="fas fa-play" style="color:#10b981;font-size:9px;"></i>
                                <span style="flex:1;">${startStr}</span>
                                <span style="font-weight:700;color:#0f172a;display:flex;align-items:center;gap:4px;"><i class="fas fa-clock" style="color:#3b82f6;font-size:11px;"></i> ${durationStr}</span>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;color:#475569;font-size:12px;">
                                <i class="fas fa-stop" style="color:#ef4444;font-size:9px;"></i>
                                <span>${endStr}</span>
                            </div>
                        </div>
                        <div style="display:flex;flex-wrap:wrap;gap:5px;">${secChips}</div>
                    </div>
                    <div style="padding:12px 16px;border-top:1px solid #f1f5f9;background:#fafafa;display:flex;gap:7px;flex-wrap:wrap;align-items:center;">
                        ${actionsHTML}
                    </div>
                </div>`;
            });

            html += `</div>`;
        }

        document.getElementById('main-content').innerHTML = html;

        // Auto-refresh exactement au prochain changement d'état (start_time ou end_time)
        const nowMs = Date.now();
        const nextMs = exams
            .flatMap(e => [new Date(e.start_time).getTime(), new Date(e.end_time).getTime()])
            .filter(t => t > nowMs)
            .sort((a, b) => a - b)[0];
        if (nextMs) {
            window._onlineExamsTimer = setTimeout(() => {
                if (window._currentView === loadOnlineExams) loadOnlineExams();
            }, Math.max(5000, nextMs - nowMs + 1500));
        }

    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function deleteOnlineExam(examId, examTitle, attemptsCount) {
    const title = examTitle || `Examen #${examId}`;
    const hasAttempts = attemptsCount > 0;
    const attemptWarning = hasAttempts ? `
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin:0 0 16px;text-align:left;">
            <div style="font-weight:600;color:#b91c1c;margin-bottom:4px;font-size:13px;">
                <i class="fas fa-exclamation-triangle"></i> Attention : données étudiants
            </div>
            <div style="color:#7f1d1d;font-size:12px;line-height:1.5;">
                ${attemptsCount} étudiant(s) ont déjà composé cet examen.<br>
                <strong>Toutes leurs copies, réponses et logs seront définitivement supprimés.</strong>
            </div>
        </div>` : '';
    showModal(`
        <div style="text-align:center;padding:8px 0 4px;">
            <div style="width:64px;height:64px;background:rgba(239,68,68,.1);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
                <i class="fas fa-trash-alt" style="font-size:26px;color:#ef4444;"></i>
            </div>
            <h3 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 10px;">Supprimer l'examen ?</h3>
            <p style="color:#64748b;font-size:14px;margin:0 0 8px;">Vous êtes sur le point de supprimer :</p>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin:0 0 16px;font-weight:600;color:#0f172a;font-size:15px;">${title}</div>
            ${attemptWarning}
            <p style="color:#ef4444;font-size:13px;margin:0 0 28px;display:flex;align-items:center;justify-content:center;gap:6px;">
                <i class="fas fa-exclamation-triangle"></i>
                Cette action est définitive et irréversible.
            </p>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button class="btn btn-secondary" onclick="closeModal()" style="min-width:120px;">
                    <i class="fas fa-times"></i> Annuler
                </button>
                <button class="btn btn-danger" id="confirm-delete-exam-btn" onclick="confirmDeleteOnlineExam(${examId})" style="min-width:140px;">
                    <i class="fas fa-trash-alt"></i> ${hasAttempts ? 'Tout supprimer' : 'Supprimer'}
                </button>
            </div>
        </div>
    `, '460px');
}

async function confirmDeleteOnlineExam(examId) {
    const btn = document.getElementById('confirm-delete-exam-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...'; }

    try {
        const response = await authenticatedFetch(`/api/online_exams/${examId}`, { method: 'DELETE' });
        const data = await response.json();
        closeModal();
        if (data.success) {
            showAlert("L'examen a été supprimé avec succès.", 'success');
            loadOnlineExams();
        } else {
            showAlert(data.error || "Impossible de supprimer l'examen. Veuillez réessayer.", 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash-alt"></i> Supprimer'; }
        }
    } catch (error) {
        // authenticatedFetch a déjà affiché l'alerte pour les erreurs 400/403/404/500
        // On ferme juste le modal sans double-alerte
        closeModal();
    }
}

async function showCreateOnlineExamModal() {
    showLoader(true);
   
    try {
        // Récupérer les sujets
        const subjectsResponse = await authenticatedFetch('/api/subjects');
        const subjects = await subjectsResponse.json();
       
        let subjectsOptions = '<option value="">-- Sélectionner un sujet --</option>';
        subjects.forEach(s => {
            subjectsOptions += `<option value="${s.id}">${s.title}</option>`;
        });
       
        const modalContent = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                <div style="background:#3b82f6;width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-plus" style="color:white;font-size:16px;"></i>
                </div>
                <div>
                    <h2 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;">Créer un Examen en Ligne</h2>
                    <p style="margin:2px 0 0;font-size:13px;color:#64748b;">Configurez les paramètres de votre examen</p>
                </div>
            </div>
            <form id="create-online-exam-form">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
                    <div class="form-group" style="grid-column:1/-1;">
                        <label><i class="fas fa-book"></i> Sujet Associé *</label>
                        <select id="exam-subject" required>${subjectsOptions}</select>
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label><i class="fas fa-heading"></i> Titre de l'Examen *</label>
                        <input type="text" id="exam-title" required placeholder="Ex: Examen Final Blockchain">
                    </div>
                    <div class="form-group">
                        <label><i class="fas fa-calendar-plus"></i> Début *</label>
                        <input type="datetime-local" id="exam-start" required>
                    </div>
                    <div class="form-group">
                        <label><i class="fas fa-calendar-minus"></i> Fin *</label>
                        <input type="datetime-local" id="exam-end" required>
                        <small class="form-help">Durée calculée automatiquement</small>
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label><i class="fas fa-align-left"></i> Instructions</label>
                        <textarea id="exam-instructions" rows="3" placeholder="Consignes pour les étudiants..."></textarea>
                    </div>
                </div>

                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
                        <i class="fas fa-shield-alt" style="color:#7c3aed;font-size:15px;"></i>
                        <span style="font-weight:700;color:#0f172a;font-size:14px;">Paramètres de Sécurité</span>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px;">
                        <div class="form-group">
                            <label style="font-size:13px;"><i class="fas fa-exchange-alt" style="color:#f59e0b;"></i> Seuil — changements de fenêtre</label>
                            <input type="number" id="exam-max-switches" min="0" max="20" value="2">
                            <small class="form-help">Bannissement après ce nombre (0 = aucun toléré)</small>
                        </div>
                        <div class="form-group">
                            <label style="font-size:13px;"><i class="fas fa-eye-slash" style="color:#ef4444;"></i> Seuil — visage absent (caméra)</label>
                            <input type="number" id="exam-max-no-face" min="-1" max="100" value="10">
                            <small class="form-help">Bannissement après N détections sans visage (-1 = désactivé)</small>
                        </div>
                    </div>

                    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px;">
                        <input type="checkbox" id="exam-ban-devtools" checked style="width:auto;margin-top:2px;flex-shrink:0;">
                        <div>
                            <label for="exam-ban-devtools" style="font-size:13px;font-weight:600;color:#dc2626;cursor:pointer;margin:0;display:block;">
                                <i class="fas fa-terminal"></i> Bannir immédiatement si outils développeur ouverts
                            </label>
                            <small style="color:#64748b;">Exclusion instantanée en cas de tentative d'accès aux outils développeur (F12, Ctrl+Shift+I…)</small>
                        </div>
                    </div>

                    <div style="display:flex;gap:20px;flex-wrap:wrap;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#475569;">
                            <input type="checkbox" id="exam-copy-paste" style="width:auto;">
                            <span>Autoriser Copier/Coller</span>
                        </label>
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#475569;">
                            <input type="checkbox" id="exam-right-click" style="width:auto;">
                            <span>Autoriser Clic Droit</span>
                        </label>
                    </div>
                </div>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 18px;margin-bottom:20px;">
                    <div style="display:flex;align-items:flex-start;gap:10px;">
                        <input type="checkbox" id="exam-auto-correct" style="width:auto;margin-top:3px;flex-shrink:0;">
                        <div>
                            <label for="exam-auto-correct" style="font-size:13px;font-weight:600;color:#15803d;cursor:pointer;margin:0;display:block;">
                                <i class="fas fa-robot"></i> Activer la correction automatique par IA
                            </label>
                            <small style="color:#64748b;line-height:1.5;display:block;margin-top:3px;">
                                Dès qu'un étudiant soumet sa copie, l'IA la corrige automatiquement.<br>
                                <strong>Désactivé par défaut</strong> — le professeur peut toujours réviser ou corriger manuellement après.
                            </small>
                        </div>
                    </div>
                </div>

                <div style="display:flex;gap:10px;justify-content:flex-end;">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">
                        <i class="fas fa-times"></i> Annuler
                    </button>
                    <button type="submit" class="btn btn-primary">
                        <i class="fas fa-check"></i> Créer l'Examen
                    </button>
                </div>
            </form>
        `;
       
        showModal(modalContent, '800px');
        showLoader(false);
       
        document.getElementById('create-online-exam-form').addEventListener('submit', handleCreateOnlineExam);
    } catch (error) {
        showAlert(humanError(error), 'error');
        showLoader(false);
    }
}

// FIX ENVOI : Force UTC dans handleCreateOnlineExam
async function handleCreateOnlineExam(e) {
    e.preventDefault();
    showLoader(true);
   
    try {
        // La valeur du datetime-local est saisie en heure Dakar (UTC+0).
        // On envoie la chaîne brute + "Z" pour forcer UTC sans aucune
        // conversion par le navigateur (évite le décalage du fuseau local).
        const rawStart = document.getElementById('exam-start').value; // ex: "2026-03-30T18:05"
        const rawEnd   = document.getElementById('exam-end').value;
        if (!rawStart || !rawEnd) {
            showAlert('Veuillez renseigner les dates de début et de fin.', 'warning');
            showLoader(false);
            return;
        }
        const startTime = rawStart + ':00Z'; // "2026-03-30T18:05:00Z" = UTC
        const endTime   = rawEnd   + ':00Z';

        // Validation (comparaison de chaînes ISO, possible car même format)
        if (startTime >= endTime) {
            showAlert('La date de fin doit être après la date de début', 'warning');
            showLoader(false);
            return;
        }
       
        const response = await authenticatedFetch('/api/online_exams', {
            method: 'POST',
            body: JSON.stringify({
                subject_id: parseInt(document.getElementById('exam-subject').value),
                title: document.getElementById('exam-title').value,
                instructions: document.getElementById('exam-instructions').value,
                // SUPPRIMÉ : duration_minutes (auto backend)
                start_time: startTime,  // UTC
                end_time: endTime,      // UTC
                max_tab_switches: parseInt(document.getElementById('exam-max-switches').value),
                max_no_face_count: parseInt(document.getElementById('exam-max-no-face').value),
                ban_on_devtools: document.getElementById('exam-ban-devtools').checked,
                enable_copy_paste: document.getElementById('exam-copy-paste').checked,
                enable_right_click: document.getElementById('exam-right-click').checked,
                auto_correct: document.getElementById('exam-auto-correct').checked
            })
        });
       
        const data = await response.json();
       
        if (data.success) {
            showAlert(`L'examen a été créé avec succès. Durée : ${data.exam.duration_minutes} min. Activez-le pour le rendre accessible aux étudiants.`, 'success');
            closeModal();
            loadOnlineExams();
        } else {
            showAlert(data.error || 'Impossible de créer l\'examen. Vérifiez les dates et réessayez.', 'error');
        }
    } catch (error) {
        // authenticatedFetch gère déjà
    } finally {
        showLoader(false);
    }
}

async function closeExam(examId) {
    if (!confirm('Fermer cet examen? Les étudiants ne pourront plus composer.')) {
        return;
    }
    
    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/online_exams/${examId}/close`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert("L'examen a été clôturé. Les étudiants ne peuvent plus soumettre.", 'success');
            loadOnlineExams();
        } else {
            showAlert(data.error || 'Impossible de clôturer l\'examen. Il est peut-être déjà terminé ou non démarré.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function viewMyExamResult(attemptId) {
    try {
        showLoader(true);
        const res = await authenticatedFetch(`/api/exam_attempts/${attemptId}/result`);
        const data = await res.json();
        if (data.error) { showAlert(data.error, 'error'); return; }
        const scoreColor = data.score >= 10 ? '#10b981' : '#ef4444';
        const scoreBg    = data.score >= 10 ? '#ecfdf5' : '#fff1f2';
        const feedbackHtml = (data.feedback || 'Aucun feedback disponible.')
            .replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        const correctedDate = data.corrected_at
            ? new Date(data.corrected_at).toLocaleString('fr-FR', {timeZone:'Africa/Dakar'}) : '—';

        const modal = document.createElement('div');
        modal.id = 'exam-result-modal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
        modal.innerHTML = `
        <div style="background:#fff;border-radius:16px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);">
            <div style="padding:22px 26px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
                <h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;">
                    <i class="fas fa-file-alt" style="color:#3b82f6;"></i> Résultat de mon examen
                </h2>
                <button onclick="document.getElementById('exam-result-modal').remove()"
                    style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer;">&times;</button>
            </div>
            <div style="padding:22px 26px;">
                <h3 style="margin:0 0 18px;font-size:15px;color:#334155;">${data.exam_title || 'Examen'}</h3>
                <div style="display:flex;gap:14px;margin-bottom:20px;flex-wrap:wrap;">
                    <div style="background:${scoreBg};border-radius:12px;padding:18px 24px;text-align:center;flex:1;min-width:130px;">
                        <div style="font-size:40px;font-weight:800;color:${scoreColor};line-height:1;">
                            ${data.score !== null ? data.score.toFixed(2) : '—'}
                        </div>
                        <div style="font-size:12px;color:#64748b;margin-top:3px;">/ 20</div>
                        <div style="font-size:12px;color:${scoreColor};font-weight:700;margin-top:5px;">
                            ${data.score >= 10 ? '✓ Admis' : '✗ Ajourné'}
                        </div>
                    </div>
                    <div style="background:#f8fafc;border-radius:12px;padding:14px 18px;flex:2;min-width:180px;">
                        <div style="font-size:11px;color:#94a3b8;margin-bottom:3px;"><i class="fas fa-calendar"></i> Corrigé le</div>
                        <div style="font-size:13px;color:#334155;font-weight:600;">${correctedDate}</div>
                        <div style="font-size:11px;color:#94a3b8;margin-top:10px;margin-bottom:3px;"><i class="fas fa-robot"></i> Correction</div>
                        <div style="font-size:13px;color:#334155;">Automatique par IA</div>
                    </div>
                </div>
                <div style="background:#f8fafc;border-radius:12px;padding:18px;border:1px solid #e2e8f0;margin-bottom:18px;">
                    <h4 style="margin:0 0 12px;font-size:14px;color:#0f172a;display:flex;align-items:center;gap:8px;">
                        <i class="fas fa-comment-alt" style="color:#3b82f6;"></i> Feedback détaillé
                    </h4>
                    <div style="font-size:13px;color:#334155;line-height:1.8;">${feedbackHtml}</div>
                </div>
                <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div style="font-size:13px;color:#92400e;">
                        <i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>
                        <strong>Vous contestez cette note ?</strong> Vous avez 7 jours pour faire une réclamation.
                    </div>
                    <button onclick="showReclamationModalForAttempt(${attemptId}, '${(data.exam_title||'').replace(/'/g,"\\'")}'); document.getElementById('exam-result-modal').remove();"
                        style="background:#d97706;color:white;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
                        <i class="fas fa-exclamation-circle"></i> Faire une réclamation
                    </button>
                </div>
            </div>
        </div>`;
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    } catch(e) { showAlert('Erreur lors du chargement du résultat.', 'error'); }
    finally { showLoader(false); }
}

function showReclamationModalForAttempt(attemptId, examTitle) {
    const modal = document.createElement('div');
    modal.id = 'reclamation-attempt-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:520px;width:100%;box-shadow:0 24px 60px rgba(0,0,0,.25);">
        <div style="padding:22px 26px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;">
            <h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a;">
                <i class="fas fa-exclamation-triangle" style="color:#d97706;margin-right:8px;"></i>Réclamation
            </h2>
            <button onclick="document.getElementById('reclamation-attempt-modal').remove()"
                style="background:none;border:none;font-size:22px;color:#94a3b8;cursor:pointer;">&times;</button>
        </div>
        <div style="padding:22px 26px;">
            <p style="margin:0 0 14px;font-size:13px;color:#64748b;">
                Examen : <strong>${examTitle}</strong>
            </p>
            <div style="margin-bottom:16px;">
                <label style="font-size:13px;font-weight:600;color:#334155;display:block;margin-bottom:6px;">
                    <i class="fas fa-comment"></i> Motif de la réclamation *
                </label>
                <textarea id="attempt-reclamation-reason" rows="5"
                    placeholder="Expliquez précisément pourquoi vous contestez cette correction…"
                    style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
            </div>
            <div style="display:flex;gap:10px;">
                <button onclick="submitReclamationForAttempt(${attemptId})"
                    style="background:#d97706;color:white;border:none;border-radius:8px;padding:10px 20px;font-size:13px;font-weight:600;cursor:pointer;flex:1;">
                    <i class="fas fa-paper-plane"></i> Soumettre
                </button>
                <button onclick="document.getElementById('reclamation-attempt-modal').remove()"
                    style="background:#f1f5f9;color:#475569;border:none;border-radius:8px;padding:10px 20px;font-size:13px;cursor:pointer;">
                    Annuler
                </button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function submitReclamationForAttempt(attemptId) {
    const reason = document.getElementById('attempt-reclamation-reason')?.value?.trim();
    if (!reason) { showAlert('Veuillez saisir le motif de votre réclamation.', 'error'); return; }
    try {
        showLoader(true);
        const res = await authenticatedFetch('/api/reclamations', {
            method: 'POST',
            body: JSON.stringify({ attempt_id: attemptId, reason })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById('reclamation-attempt-modal')?.remove();
            showAlert('✅ Réclamation soumise avec succès. Vous serez notifié de la réponse.', 'success');
        } else {
            showAlert(data.error || 'Erreur lors de la soumission.', 'error');
        }
    } catch(e) {
        if (!e.alreadyHandled) showAlert(e.serverMessage || e.message || 'Erreur réseau. Vérifiez votre connexion et réessayez.', 'error');
    } finally { showLoader(false); }
}

async function viewOnlineExamDetails(examId) {
    showLoader(true);
    
    try {
        const response = await authenticatedFetch('/api/online_exams');
        const exams = await response.json();
        const exam = exams.find(e => e.id === examId);
        
        if (!exam) {
            showAlert('Examen introuvable. Veuillez actualiser la liste.', 'error');
            showLoader(false);
            return;
        }
        
        const statusClass = {
            'draft': 'secondary',
            'scheduled': 'warning',
            'active': 'success',
            'closed': 'danger'
        }[exam.status] || 'secondary';
        
        const statusLabel = {
            'draft': 'Brouillon',
            'scheduled': 'Planifié',
            'active': 'En cours',
            'closed': 'Terminé'
        }[exam.status] || exam.status;
        
        const scDetail = {
            'draft':     { color: '#64748b', bg: '#f1f5f9', icon: 'fa-edit' },
            'scheduled': { color: '#d97706', bg: '#fffbeb', icon: 'fa-calendar-alt' },
            'active':    { color: '#059669', bg: '#ecfdf5', icon: 'fa-play-circle' },
            'closed':    { color: '#dc2626', bg: '#fff1f2', icon: 'fa-check-circle' },
        }[exam.status] || { color: '#64748b', bg: '#f1f5f9', icon: 'fa-circle' };

        const fmtFull = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dakar' };
        const dH = Math.floor(exam.duration_minutes / 60);
        const dM = exam.duration_minutes % 60;
        const durationStr = dH > 0 ? (dM > 0 ? `${dH}h ${dM}min` : `${dH}h`) : `${dM} min`;
        const safeTitle = (exam.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        const modalContent = `
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:22px;">
                <div style="background:#3b82f6;width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-laptop-code" style="color:white;font-size:17px;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${exam.title}</h2>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
                        <span style="background:${scDetail.bg};color:${scDetail.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
                            <i class="fas ${scDetail.icon}"></i> ${statusLabel}
                        </span>
                        <span style="color:#64748b;font-size:12px;">${exam.subject_title || ''}</span>
                    </div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
                <div style="background:#f8fafc;border:1px solid #f1f5f9;border-radius:10px;padding:14px;">
                    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Début</div>
                    <div style="font-size:13px;font-weight:600;color:#0f172a;">${fmtDakar(exam.start_time)}</div>
                </div>
                <div style="background:#f8fafc;border:1px solid #f1f5f9;border-radius:10px;padding:14px;">
                    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Fin</div>
                    <div style="font-size:13px;font-weight:600;color:#0f172a;">${fmtDakar(exam.end_time)}</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;">
                <div style="background:#eff6ff;border-radius:10px;padding:12px;text-align:center;">
                    <i class="fas fa-clock" style="color:#3b82f6;font-size:18px;display:block;margin-bottom:4px;"></i>
                    <div style="font-size:18px;font-weight:700;color:#0f172a;">${durationStr}</div>
                    <div style="font-size:11px;color:#64748b;">Durée</div>
                </div>
                <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center;">
                    <i class="fas fa-exchange-alt" style="color:#10b981;font-size:18px;display:block;margin-bottom:4px;"></i>
                    <div style="font-size:18px;font-weight:700;color:#0f172a;">${exam.max_tab_switches}</div>
                    <div style="font-size:11px;color:#64748b;">Chgts fenêtre</div>
                </div>
                <div style="background:${exam.attempts_count > 0 ? 'rgba(99,102,241,.08)' : '#f8fafc'};border-radius:10px;padding:12px;text-align:center;">
                    <i class="fas fa-users" style="color:#6366f1;font-size:18px;display:block;margin-bottom:4px;"></i>
                    <div style="font-size:18px;font-weight:700;color:#0f172a;">${exam.attempts_count || 0}</div>
                    <div style="font-size:11px;color:#64748b;">Tentatives</div>
                </div>
            </div>

            <!-- Seuils de bannissement -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;">
                <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-shield-alt" style="color:#7c3aed;"></i> Seuils de bannissement
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
                    <div style="background:white;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-exchange-alt" style="color:#f59e0b;font-size:16px;flex-shrink:0;"></i>
                        <div>
                            <div style="font-size:16px;font-weight:700;color:#0f172a;">${exam.max_tab_switches}</div>
                            <div style="font-size:11px;color:#64748b;">Changements fenêtre max</div>
                        </div>
                    </div>
                    <div style="background:white;border:1px solid ${(exam.max_no_face_count != null && exam.max_no_face_count >= 0) ? '#fca5a5' : '#e2e8f0'};border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-eye-slash" style="color:#ef4444;font-size:16px;flex-shrink:0;"></i>
                        <div>
                            <div style="font-size:16px;font-weight:700;color:#0f172a;">${(exam.max_no_face_count != null && exam.max_no_face_count >= 0) ? exam.max_no_face_count : '∞'}</div>
                            <div style="font-size:11px;color:#64748b;">Visage absent max${exam.max_no_face_count === -1 ? ' (désactivé)' : ''}</div>
                        </div>
                    </div>
                    <div style="background:white;border:1px solid ${exam.ban_on_devtools ? '#e9d5ff' : '#e2e8f0'};border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-terminal" style="color:${exam.ban_on_devtools ? '#7c3aed' : '#94a3b8'};font-size:16px;flex-shrink:0;"></i>
                        <div>
                            <div style="font-size:13px;font-weight:700;color:${exam.ban_on_devtools ? '#7c3aed' : '#94a3b8'};">${exam.ban_on_devtools ? 'Ban immédiat' : 'Non actif'}</div>
                            <div style="font-size:11px;color:#64748b;">Outils développeur</div>
                        </div>
                    </div>
                </div>
            </div>

            <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
                <span style="background:${exam.enable_copy_paste ? '#f0fdf4' : '#fef2f2'};color:${exam.enable_copy_paste ? '#059669' : '#ef4444'};padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
                    <i class="fas ${exam.enable_copy_paste ? 'fa-check' : 'fa-ban'}"></i> Copier/Coller ${exam.enable_copy_paste ? 'autorisé' : 'interdit'}
                </span>
                <span style="background:${exam.enable_right_click ? '#f0fdf4' : '#fef2f2'};color:${exam.enable_right_click ? '#059669' : '#ef4444'};padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
                    <i class="fas ${exam.enable_right_click ? 'fa-check' : 'fa-ban'}"></i> Clic droit ${exam.enable_right_click ? 'autorisé' : 'interdit'}
                </span>
                <span style="background:#f8fafc;color:#475569;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:5px;">
                    <i class="fas fa-user"></i> ${exam.creator_name || ''}
                </span>
            </div>

            ${exam.instructions ? `
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:14px;">
                <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <i class="fas fa-file-alt"></i> Instructions
                </div>
                <div style="font-size:13px;color:#0f172a;white-space:pre-wrap;line-height:1.6;">${exam.instructions}</div>
            </div>` : ''}

            <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;padding-top:4px;">
                ${exam.status === 'active' ? `
                    <button class="btn" onclick="closeModal(); openProctoringDashboard(${exam.id})" style="background:#7c3aed;color:white;">
                        <i class="fas fa-shield-alt"></i> Surveiller
                    </button>
                    <button class="btn btn-danger" onclick="closeModal(); closeExam(${exam.id})">
                        <i class="fas fa-stop-circle"></i> Clôturer
                    </button>
                ` : ''}
                ${(exam.status === 'scheduled' || exam.status === 'draft') ? `
                    <button class="btn btn-success" onclick="closeModal(); activateExam(${exam.id})">
                        <i class="fas fa-play-circle"></i> Activer
                    </button>
                    <button class="btn" onclick="closeModal(); extendExam(${exam.id})" style="background:rgba(16,185,129,.1);color:#059669;border:1px solid #a7f3d0;">
                        <i class="fas fa-clock"></i> Rallonger
                    </button>
                ` : ''}
                ${exam.status === 'active' ? `
                    <button class="btn" onclick="closeModal(); extendExam(${exam.id})" style="background:rgba(16,185,129,.1);color:#059669;border:1px solid #a7f3d0;">
                        <i class="fas fa-clock"></i> Rallonger
                    </button>
                ` : ''}
                <button class="btn" onclick="closeModal(); deleteOnlineExam(${exam.id}, '${safeTitle}', ${exam.attempts_count || 0})" style="background:rgba(239,68,68,.1);color:#ef4444;">
                    <i class="fas fa-trash-alt"></i> Supprimer
                </button>
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;
        
        showModal(modalContent, '800px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ✅ NOUVEAU : Fonction pour activer un examen (appelée par bouton "Activer")
async function activateExam(examId) {
    if (!confirm('Activer cet examen ? Il deviendra accessible aux étudiants immédiatement.')) {
        return;
    }
    
    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/online_exams/${examId}/activate`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert('Examen activé avec succès !', 'success');
            loadOnlineExams();  // Recharger la liste
        } else {
            showAlert(data.error || 'Impossible d\'activer l\'examen. Veuillez réessayer.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function extendExam(examId) {
    const modalContent = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
            <div style="background:#059669;width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                <i class="fas fa-clock" style="color:white;font-size:18px;"></i>
            </div>
            <div>
                <h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">Rallonger la durée</h2>
                <p style="margin:2px 0 0;font-size:13px;color:#64748b;">Ajouter du temps supplémentaire à l'examen</p>
            </div>
        </div>
        <div class="form-group" style="margin-bottom:20px;">
            <label style="font-weight:600;color:#334155;display:block;margin-bottom:8px;">
                <i class="fas fa-plus-circle" style="color:#059669;"></i> Minutes à ajouter
            </label>
            <input type="number" id="extend-minutes" min="1" max="300" value="15"
                style="font-size:20px;padding:12px 16px;border:2px solid #e2e8f0;border-radius:8px;width:100%;text-align:center;font-weight:700;color:#059669;"
                onfocus="this.style.borderColor='#059669'" onblur="this.style.borderColor='#e2e8f0'">
            <small style="color:#64748b;margin-top:6px;display:block;">Entre 1 et 300 minutes</small>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button class="btn btn-secondary" onclick="closeModal()">
                <i class="fas fa-times"></i> Annuler
            </button>
            <button class="btn" onclick="_confirmExtendExam(${examId})" style="background:#059669;color:white;">
                <i class="fas fa-check"></i> Confirmer
            </button>
        </div>
    `;
    showModal(modalContent, '420px');
}

async function _confirmExtendExam(examId) {
    const minutes = parseInt(document.getElementById('extend-minutes')?.value || '0');
    if (!minutes || minutes < 1 || minutes > 300) {
        showAlert('Veuillez entrer un nombre de minutes valide (1–300).', 'warning');
        return;
    }
    closeModal();
    showLoader(true);
    try {
        const response = await authenticatedFetch(`/api/online_exams/${examId}/extend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extra_minutes: minutes })
        });
        const data = await response.json();
        if (data.success) {
            showAlert(data.message || `Durée prolongée de ${minutes} minutes.`, 'success');
            loadOnlineExams();
        } else {
            showAlert(data.error || 'Impossible de rallonger l\'examen.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// COMPOSITION D'EXAMEN EN LIGNE (ÉTUDIANT)
// ============================================================================

let currentExamAttempt = null;
let examAutoSaveInterval = null;
let visibilityChangeCount = 0;

function showExamNotStartedInfo(startTimeStr, title) {
    const startTime = new Date(startTimeStr);
    const fmtOpts = { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dakar' };
    const startFormatted = startTime.toLocaleString('fr-FR', fmtOpts);

    // Calcul du temps restant avant le début
    const now = new Date();
    const diffMs = startTime - now;
    const diffH = Math.floor(diffMs / 3600000);
    const diffM = Math.floor((diffMs % 3600000) / 60000);
    let countdownStr = '';
    if (diffH > 0) countdownStr = `dans ${diffH}h${diffM > 0 ? String(diffM).padStart(2,'0') + 'min' : ''}`;
    else if (diffM > 0) countdownStr = `dans ${diffM} minute${diffM > 1 ? 's' : ''}`;
    else countdownStr = 'très prochainement';

    const modalContent = `
        <div style="text-align:center;padding:8px 0 16px;">
            <div style="width:72px;height:72px;background:#fffbeb;border-radius:50%;
                        display:flex;align-items:center;justify-content:center;
                        margin:0 auto 18px;font-size:32px;color:#d97706;border:2px solid #fcd34d;">
                <i class="fas fa-clock"></i>
            </div>
            <h2 style="margin:0 0 8px;font-size:18px;color:#1e293b;">Examen pas encore ouvert</h2>
            <p style="color:#64748b;font-size:13px;margin-bottom:20px;">${title}</p>

            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin-bottom:20px;">
                <div style="color:#92400e;font-size:14px;margin-bottom:8px;">
                    <i class="fas fa-calendar-alt" style="margin-right:6px;"></i>
                    <strong>Début de l'examen :</strong>
                </div>
                <div style="color:#d97706;font-size:16px;font-weight:700;">${startFormatted}</div>
                <div style="color:#92400e;font-size:13px;margin-top:8px;opacity:.8;">
                    <i class="fas fa-hourglass-half" style="margin-right:4px;"></i> ${countdownStr}
                </div>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin-bottom:20px;">
                Revenez à l'heure indiquée pour pouvoir composer cet examen.
            </p>
            <button class="btn btn-primary" onclick="closeModal()">
                <i class="fas fa-check"></i> Compris
            </button>
        </div>
    `;
    showModal(modalContent, '480px');
}

function stripBaremeFromContent(content) {
    if (!content) return content;
    // Pattern 1 : ligne de séparateurs suivie de "barème" sur la ligne suivante
    let m = content.search(/\n[═=─]{5,}[^\n]*\n[^\n]*[Bb]ar[eè]me/);
    if (m > 0) return content.substring(0, m).trimEnd();
    // Pattern 2 : "Barème de Notation" comme entête de section
    m = content.search(/\n\s*[Bb]ar[eè]me\s+de\s+[Nn]otation/i);
    if (m > 0) return content.substring(0, m).trimEnd();
    // Pattern 3 : "BARÈME" seul sur sa ligne (tout en majuscules)
    m = content.search(/\nBAR[ÈE]ME\s*\n/);
    if (m > 0) return content.substring(0, m).trimEnd();
    return content;
}

async function startOnlineExam(examId) {
    // Afficher la modal de consentement caméra/micro avant de démarrer
    showProctoringConsentModal(examId);
}

async function _doStartOnlineExam(examId, preExamSignature = null, preExamSignatureMeta = null) {
    showLoader(true);

    try {
        // Utiliser fetch directement pour contrôler finement chaque code d'erreur
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const payload = {};
        if (preExamSignature)     payload.pre_exam_signature      = preExamSignature;
        if (preExamSignatureMeta) payload.pre_exam_signature_meta = preExamSignatureMeta;
        const body = Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined;
        const response = await fetch(`/api/online_exams/${examId}/start`, { method: 'POST', headers, body });
        const data = await response.json().catch(() => ({}));

        showLoader(false);

        if (response.status === 400) {
            // Examen non actif ou pas encore commencé → alerte claire
            const errMsg = data.error || "L'examen n'est pas disponible.";
            const startsAt = data.starts_at ? new Date(data.starts_at) : null;

            let html = `<div style="text-align:center;padding:8px 0 16px;">
                <div style="width:72px;height:72px;background:rgba(245,158,11,.12);border-radius:50%;
                            display:flex;align-items:center;justify-content:center;
                            margin:0 auto 18px;font-size:32px;color:#f59e0b;">
                    <i class="fas fa-clock"></i>
                </div>
                <h2 style="margin:0 0 12px;font-size:19px;color:#1e293b;">Examen non disponible</h2>
                <p style="color:#64748b;font-size:14px;line-height:1.6;margin-bottom:0;">${errMsg}</p>`;

            if (startsAt) {
                const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric',
                               hour:'2-digit', minute:'2-digit', timeZone:'UTC' };
                html += `<div style="margin-top:16px;background:#fef3c7;border:1px solid #fcd34d;
                                     border-radius:10px;padding:14px;font-size:13px;color:#92400e;">
                    <i class="fas fa-calendar-alt" style="margin-right:6px;"></i>
                    Début prévu : <strong>${startsAt.toLocaleDateString('fr-FR', opts)} (UTC)</strong>
                </div>`;
            }

            html += `<button onclick="closeModal()" class="btn btn-primary"
                        style="margin-top:20px;width:100%;padding:12px;">
                    <i class="fas fa-check"></i> Compris
                </button></div>`;

            showModal(html);
            return;
        }

        if (response.status === 403) {
            if (data.banned) {
                showModal('', `<div style="text-align:center;padding:12px 0 16px;">
                    <div style="font-size:48px;color:#ef4444;margin-bottom:16px;"><i class="fas fa-ban"></i></div>
                    <h2 style="color:#ef4444;margin:0 0 12px;">Accès refusé</h2>
                    <p style="color:#64748b;">Vous avez été exclu de cet examen pour non-respect des règles de surveillance.</p>
                    <button onclick="closeModal()" class="btn btn-primary" style="margin-top:16px;width:100%;">Fermer</button>
                </div>`);
            } else {
                showAlert(data.error || 'Accès non autorisé.', 'error');
            }
            return;
        }

        if (!response.ok) {
            showAlert(data.error || "Impossible de démarrer l'examen. Vérifiez que l'examen est actif et dans les délais autorisés.", 'error');
            return;
        }

        if (data.success) {
            currentExamAttempt = data.attempt;
            window.location.href = `/proctor/exam/${data.attempt.id}`;
        } else {
            showAlert(data.error || "Impossible de démarrer l'examen.", 'error');
        }

    } catch (error) {
        showLoader(false);
        showAlert("Erreur de connexion. Vérifiez votre réseau et réessayez.", 'error');
    }
}

function openProctoringDashboard(examId) {
    // Ouvrir le dashboard de surveillance dans un nouvel onglet
    window.open(`/proctor/monitor/${examId}`, `proctor-${examId}`,
        'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no');
}

function showProctoringConsentModal(examId) {
    const modalContent = `
        <div style="padding: 4px 0 8px;">
            <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">
                <div style="width:52px;height:52px;background:rgba(37,99,235,.1);border-radius:50%;
                            display:flex;align-items:center;justify-content:center;
                            font-size:24px;color:#2563eb;flex-shrink:0;">
                    <i class="fas fa-shield-alt"></i>
                </div>
                <div>
                    <h2 style="margin:0 0 4px;font-size:18px;color:#1e293b;">Examen Surveillé — Attestation d'honneur</h2>
                    <p style="margin:0;color:#64748b;font-size:13px;">Lisez les conditions et signez avant de démarrer</p>
                </div>
            </div>

            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;
                        padding:14px 16px;margin-bottom:18px;">
                <div style="display:flex;flex-direction:column;gap:9px;">
                    <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
                        <i class="fas fa-video" style="color:#2563eb;width:16px;text-align:center;flex-shrink:0;"></i>
                        <span>Caméra et microphone activés pendant toute la durée</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
                        <i class="fas fa-user-check" style="color:#10b981;width:16px;text-align:center;flex-shrink:0;"></i>
                        <span>Visage visible en permanence (détection faciale IA)</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
                        <i class="fas fa-expand" style="color:#f59e0b;width:16px;text-align:center;flex-shrink:0;"></i>
                        <span>Plein écran obligatoire — tout changement d'onglet est enregistré</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;font-size:13px;">
                        <i class="fas fa-ban" style="color:#ef4444;width:16px;text-align:center;flex-shrink:0;"></i>
                        <span>Toute fraude entraîne un bannissement immédiat et définitif</span>
                    </div>
                </div>
            </div>

            <!-- Attestation d'honneur -->
            <div style="background:#fff8ed;border:1px solid #f59e0b;border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#92400e;">
                    <i class="fas fa-file-signature" style="margin-right:6px;"></i>Attestation sur l'honneur
                </p>
                <p style="margin:0;font-size:12px;color:#78350f;line-height:1.6;">
                    Je soussigné(e) <strong>${currentUser ? currentUser.full_name : ''}</strong>,
                    certifie que je composerai cet examen seul(e), sans aide extérieure, sans document non autorisé,
                    et sans aucun outil d'intelligence artificielle. Je reconnais que tout manquement à ces règles
                    constitue une fraude académique passible de sanctions.
                </p>
            </div>

            <!-- Zone de signature -->
            <div style="margin-bottom:16px;">
                <label style="font-size:12px;font-weight:700;color:#334155;display:block;margin-bottom:8px;">
                    <i class="fas fa-pen-nib" style="color:#6366f1;margin-right:5px;"></i>
                    Signez ci-dessous pour confirmer votre engagement <span style="color:#ef4444;">*</span>
                </label>
                <canvas id="pre-sig-canvas" width="480" height="120"
                    style="border:2px solid #e2e8f0;border-radius:8px;display:block;cursor:crosshair;
                           background:#fafafa;touch-action:none;width:100%;max-width:100%;"></canvas>
                <div style="display:flex;justify-content:flex-end;margin-top:6px;">
                    <button onclick="_clearPreSig()"
                        style="background:none;border:none;color:#94a3b8;font-size:12px;cursor:pointer;padding:0;">
                        <i class="fas fa-eraser"></i> Effacer
                    </button>
                </div>
            </div>

            <div style="display:flex;gap:10px;">
                <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;">
                    <i class="fas fa-times"></i> Annuler
                </button>
                <button class="btn btn-primary" id="pre-sig-start-btn" onclick="_validateAndStartExam(${examId})" style="flex:2;">
                    <i class="fas fa-pen-nib"></i> Signer et démarrer l'examen
                </button>
            </div>
        </div>
    `;
    showModal(modalContent, '580px');

    // Initialiser le pad de signature pré-examen après rendu du DOM
    requestAnimationFrame(() => _initPreSigPad());
}

function _drawPreSigWatermark(ctx, w, h) {
    // Filigrane diagonal central
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.font = `bold ${Math.max(14, Math.floor(h / 4))}px Arial`;
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-18 * Math.PI / 180);
    ctx.fillText('CEI — ATTESTATION', 0, 0);
    ctx.restore();

    // Nom étudiant en haut à gauche (watermark léger)
    const name = currentUser ? currentUser.full_name.toUpperCase() : '';
    const dateStr = new Date().toLocaleDateString('fr-FR');
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.font = '9px monospace';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(name, 8, 5);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(dateStr, w - 8, h - 5);
    ctx.restore();

    // Ligne de base en pointillés
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    const y = h * 0.72;
    ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(w - 10, y); ctx.stroke();
    ctx.restore();
}

function _initPreSigPad() {
    const canvas = document.getElementById('pre-sig-canvas');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.round(rect.width) || 480;
    canvas.height = 130;
    const ctx = canvas.getContext('2d');

    // Dessiner le filigrane non-effaçable
    _drawPreSigWatermark(ctx, canvas.width, canvas.height);

    // Initialiser le tracker de sécurité
    canvas._sigMeta = { strokes: 0, pathLength: 0, startTime: null, endTime: null };

    let drawing = false, lastX = 0, lastY = 0;

    function pos(e) {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return [
            (src.clientX - r.left) * (canvas.width / r.width),
            (src.clientY - r.top)  * (canvas.height / r.height)
        ];
    }
    function start(e) {
        e.preventDefault();
        drawing = true;
        [lastX, lastY] = pos(e);
        if (!canvas._sigMeta.startTime) canvas._sigMeta.startTime = Date.now();
        canvas._sigMeta.strokes++;
    }
    function draw(e) {
        e.preventDefault();
        if (!drawing) return;
        const [x, y] = pos(e);
        ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y);
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke();
        const dx = x - lastX, dy = y - lastY;
        canvas._sigMeta.pathLength += Math.sqrt(dx * dx + dy * dy);
        canvas._sigMeta.endTime = Date.now();
        [lastX, lastY] = [x, y];
    }
    function stop() { drawing = false; }

    canvas.addEventListener('mousedown',  start); canvas.addEventListener('mousemove',  draw); canvas.addEventListener('mouseup',    stop);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove',  draw); canvas.addEventListener('touchend',   stop);
    canvas.addEventListener('mouseleave', stop);
}

function _clearPreSig() {
    const canvas = document.getElementById('pre-sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Re-dessiner le filigrane après effacement
    _drawPreSigWatermark(ctx, canvas.width, canvas.height);
    canvas._sigMeta = { strokes: 0, pathLength: 0, startTime: null, endTime: null };
    canvas.style.border = '2px solid #e2e8f0';
    canvas.style.background = '#fafafa';
}

function _validateAndStartExam(examId) {
    const canvas = document.getElementById('pre-sig-canvas');
    if (!canvas) return;

    const meta     = canvas._sigMeta || {};
    const strokes  = meta.strokes    || 0;
    const pathLen  = Math.round(meta.pathLength || 0);
    const duration = (meta.startTime && meta.endTime) ? (meta.endTime - meta.startTime) : 0;

    // ── Verrou 1 : signature vide ──────────────────────────
    if (strokes === 0) {
        canvas.style.border = '2px solid #ef4444';
        canvas.style.background = '#fef2f2';
        showAlert('Vous devez signer l\'attestation avant de démarrer l\'examen.', 'error');
        return;
    }
    // ── Verrou 2 : trop peu de traits (clic unique = suspect) ──
    if (strokes < 2) {
        showAlert('Signature insuffisante — tracez une signature complète avec plusieurs traits.', 'error');
        return;
    }
    // ── Verrou 3 : longueur de tracé insuffisante ──────────
    if (pathLen < 100) {
        showAlert('Signature trop courte — veuillez tracer votre signature complète.', 'error');
        return;
    }
    // ── Verrou 4 : durée trop courte (signature automatisée) ─
    if (duration < 800) {
        showAlert('Signature réalisée trop rapidement — veuillez signer normalement.', 'error');
        return;
    }

    const signatureData = canvas.toDataURL('image/png');
    const signatureMeta = {
        strokes,
        path_length: pathLen,
        duration_ms: duration,
        signed_at: new Date().toISOString()
    };

    canvas.style.border = '2px solid #10b981';
    closeModal();
    _doStartOnlineExam(examId, signatureData, signatureMeta);
}

async function showExamCompositionInterface(examId, attempt) {
    // Récupérer les détails complets de l'examen (avec contenu du sujet)
    const examResponse = await authenticatedFetch(`/api/online_exams/${examId}/details`);
    const exam = await examResponse.json();

    if (!exam || exam.error) {
        showAlert('Examen introuvable. Veuillez actualiser la liste.', 'error');
        return;
    }
    
    // Calculer le temps restant
    const startTime = new Date(attempt.started_at);
    const endTime = new Date(startTime.getTime() + exam.duration_minutes * 60000);
    const now = new Date();
    const remainingMs = endTime - now;
    const remainingMinutes = Math.floor(remainingMs / 60000);
    
    if (remainingMinutes <= 0) {
        showAlert('Le temps est écoulé pour cet examen', 'warning');
        await autoSubmitExam(attempt.id);
        return;
    }
    
    const html = `
        <div class="exam-composition-container" style="max-width: 1000px; margin: 0 auto;">
            <div class="exam-header" style="background: #3b82f6; color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
                <h2 style="margin: 0 0 12px 0;"><i class="fas fa-edit"></i> ${exam.title}</h2>
                <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 16px;">
                    <div>
                        <strong>Étudiant:</strong> ${currentUser.full_name}
                    </div>
                    <div id="exam-timer" style="font-size: 20px; font-weight: bold;">
                        <i class="fas fa-clock"></i> <span id="timer-display">${remainingMinutes}:00</span>
                    </div>
                    <div id="warnings-display" style="color: #fef3c7;">
                        <i class="fas fa-exclamation-triangle"></i> Avertissements: <span id="warnings-count">0</span>/${exam.max_tab_switches}
                    </div>
                </div>
            </div>
            
            ${exam.instructions ? `
                <div class="alert alert-info" style="margin-bottom: 24px;">
                    <i class="fas fa-info-circle"></i>
                    <div>
                        <strong>Instructions:</strong><br>
                        ${exam.instructions}
                    </div>
                </div>
            ` : ''}
            
            <div class="alert alert-warning" style="margin-bottom: 24px;">
                <i class="fas fa-shield-alt"></i>
                <div>
                    <strong>Règles de Surveillance:</strong>
                    <ul style="margin: 8px 0 0 20px;">
                        <li>Ne changez PAS de fenêtre ou d'onglet (max ${exam.max_tab_switches} fois)</li>
                        <li>Restez en mode plein écran</li>
                        ${!exam.enable_copy_paste ? '<li>Le copier/coller est désactivé</li>' : ''}
                        ${!exam.enable_right_click ? '<li>Le clic droit est désactivé</li>' : ''}
                        <li>Toute tentative de tricherie entraînera un bannissement immédiat</li>
                    </ul>
                </div>
            </div>
            
            ${exam.subject_content && exam.subject_content.content ? `
            <div class="card" style="margin-bottom: 24px; border-left: 4px solid #3b82f6;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
                    <h3 style="margin:0;"><i class="fas fa-file-alt" style="color:#3b82f6;"></i> Sujet de l'Examen</h3>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <span style="background:#eff6ff;color:#3b82f6;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:600;">
                            <i class="fas fa-graduation-cap"></i> ${exam.subject_content.title}
                        </span>
                        <button onclick="document.getElementById('subject-content-body').style.display = document.getElementById('subject-content-body').style.display === 'none' ? 'block' : 'none'" style="background:none;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;color:#64748b;">
                            <i class="fas fa-compress-alt"></i> Réduire/Agrandir
                        </button>
                    </div>
                </div>
                <div id="subject-content-body" style="padding:16px;background:#f8fafc;border-radius:8px;font-size:14px;line-height:1.8;white-space:pre-wrap;font-family:monospace;border:1px solid #e2e8f0;max-height:500px;overflow-y:auto;">${stripBaremeFromContent(exam.subject_content.content)}</div>
            </div>
            ` : ''}

            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-pen"></i> Votre Copie</h3>
                </div>

                <div class="form-group">
                    <label><i class="fas fa-user"></i> Nom et Prénom (pré-rempli)</label>
                    <input type="text" value="${currentUser.full_name}" disabled style="background: #f1f5f9;">
                </div>

                <div class="form-group">
                    <label><i class="fas fa-edit"></i> Vos Réponses *</label>
                    <textarea id="exam-answers" rows="20" placeholder="Rédigez vos réponses ici en indiquant clairement le numéro de chaque question..." style="font-family: monospace; font-size: 14px;">${(() => { try { const d = JSON.parse(attempt.answers || '{}'); return d.content || d.reponse || d.answer || d.text || ''; } catch(e) { return attempt.answers || ''; } })()}</textarea>
                    <small class="form-help">
                        <i class="fas fa-save"></i> Sauvegarde automatique toutes les 30 secondes
                    </small>
                </div>

                <div style="display: flex; gap: 12px; justify-content: space-between; margin-top: 24px;">
                    <button class="btn btn-success" onclick="submitExamNow()">
                        <i class="fas fa-paper-plane"></i> Soumettre l'Examen
                    </button>
                    <button class="btn btn-secondary" onclick="saveExamDraft()">
                        <i class="fas fa-save"></i> Sauvegarder Brouillon
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('main-content').innerHTML = html;

    // Ajouter la prévisualisation caméra flottante
    const camBox = document.createElement('div');
    camBox.id = 'camera-preview-container';
    camBox.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#0f172a;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.5);border:2px solid #334155;';
    camBox.innerHTML = `
        <video id="exam-camera-preview" autoplay muted playsinline style="width:160px;height:120px;display:block;transform:scaleX(-1);object-fit:cover;"></video>
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);padding:3px 6px;display:flex;align-items:center;gap:5px;">
            <span id="cam-status-dot" style="width:7px;height:7px;border-radius:50%;background:#64748b;flex-shrink:0;"></span>
            <span id="cam-status-text" style="color:#94a3b8;font-size:10px;font-weight:500;">Initialisation...</span>
        </div>`;
    document.body.appendChild(camBox);

    // Initialiser la surveillance anti-triche
    initExamSurveillance(exam, attempt);
    
    // Timer
    startExamTimer(endTime, attempt.id);
    
    // Auto-save
    examAutoSaveInterval = setInterval(() => saveExamAnswers(attempt.id), 30000);
}

function initExamSurveillance(exam, attempt) {
    // Plein écran
    document.documentElement.requestFullscreen().catch(err => {
        console.warn('Plein écran non supporté:', err);
    });
    
    // Désactiver clic droit
    if (!exam.enable_right_click) {
        document.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            logExamActivity(attempt.id, 'right_click_attempt');
        });
    }
    
    // Désactiver copier/coller
    if (!exam.enable_copy_paste) {
        const textarea = document.getElementById('exam-answers');
        textarea.addEventListener('copy', function(e) {
            e.preventDefault();
            logExamActivity(attempt.id, 'copy_attempt');
            showAlert('Le copier est désactivé', 'warning');
        });
        textarea.addEventListener('paste', function(e) {
            e.preventDefault();
            logExamActivity(attempt.id, 'paste_attempt');
            showAlert('Le coller est désactivé', 'warning');
        });
    }
    
    // Détecter changement de fenêtre/onglet
    document.addEventListener('visibilitychange', async function() {
        if (document.hidden) {
            visibilityChangeCount++;
            
            const response = await logExamActivity(attempt.id, 'tab_switch', {
                count: visibilityChangeCount
            });
            
            if (response && response.banned) {
                alert('VOUS AVEZ ÉTÉ BANNI DE CET EXAMEN POUR TRICHERIE');
                window.location.reload();
            } else if (response) {
                document.getElementById('warnings-count').textContent = response.warnings_count;
                
                if (response.warnings_count >= exam.max_tab_switches - 1) {
                    showAlert(`ATTENTION: Dernier avertissement! Prochain changement = bannissement`, 'error');
                } else {
                    showAlert(`Avertissement ${response.warnings_count}/${exam.max_tab_switches}: Restez sur cette page!`, 'warning');
                }
            }
        }
    });
    
    // Détecter sortie plein écran
    document.addEventListener('fullscreenchange', function() {
        if (!document.fullscreenElement) {
            showAlert('Veuillez rester en mode plein écran', 'warning');
            document.documentElement.requestFullscreen();
        }
    });
    
    // Bloquer F12 (console développeur)
    document.addEventListener('keydown', function(e) {
        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I')) {
            e.preventDefault();
            logExamActivity(attempt.id, 'devtools_attempt');
        }
    });

    // Surveillance faciale (si caméra disponible)
    _startFaceDetection(attempt);
}

async function _startFaceDetection(attempt) {
    const dotEl  = document.getElementById('cam-status-dot');
    const textEl = document.getElementById('cam-status-text');

    function _setStatus(color, label) {
        if (dotEl)  dotEl.style.background  = color;
        if (textEl) textEl.style.color = color, textEl.textContent = label;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const videoEl = document.getElementById('exam-camera-preview');
        if (!videoEl) { stream.getTracks().forEach(t => t.stop()); return; }
        videoEl.srcObject = stream;
        window._examCameraStream = stream;

        _setStatus('#f59e0b', 'Chargement modèle...');

        await FaceDetector.start(videoEl, attempt.id, (type, faceCount) => {
            if (type === 'no_face') {
                _setStatus('#ef4444', 'Visage absent');
                showAlert('Visage non détecté — Restez devant la caméra', 'warning');
            } else if (type === 'multiple_faces') {
                _setStatus('#f97316', `${faceCount} visages!`);
                showAlert(`Plusieurs visages détectés (${faceCount}) — Un seul candidat autorisé`, 'error');
            }
        });

        _setStatus('#22c55e', 'Surveillance active');

    } catch (err) {
        console.warn('[FaceDetector] Caméra indisponible:', err);
        _setStatus('#ef4444', 'Caméra indisponible');
    }
}

function _stopFaceDetection() {
    if (typeof FaceDetector !== 'undefined' && FaceDetector.isRunning()) {
        FaceDetector.stop();
    }
    if (window._examCameraStream) {
        window._examCameraStream.getTracks().forEach(t => t.stop());
        window._examCameraStream = null;
    }
    const camBox = document.getElementById('camera-preview-container');
    if (camBox) camBox.remove();
}

function startExamTimer(endTime, attemptId) {
    const timerDisplay = document.getElementById('timer-display');
    
    const updateTimer = () => {
        const now = new Date();
        const remainingMs = endTime - now;
        
        if (remainingMs <= 0) {
            timerDisplay.textContent = '00:00';
            timerDisplay.style.color = '#ef4444';
            clearInterval(timerInterval);
            clearInterval(examAutoSaveInterval);
            alert('TEMPS ÉCOULÉ! Votre examen va être soumis automatiquement.');
            autoSubmitExam(attemptId);
        } else {
            const minutes = Math.floor(remainingMs / 60000);
            const seconds = Math.floor((remainingMs % 60000) / 1000);
            timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            // Changer couleur si < 5 min
            if (minutes < 5) {
                timerDisplay.style.color = '#ef4444';
            }
        }
    };
    
    updateTimer();
    const timerInterval = setInterval(updateTimer, 1000);
}

async function saveExamAnswers(attemptId, showMessage = false) {
    try {
        const answers = document.getElementById('exam-answers').value;
        
        const response = await authenticatedFetch(`/api/exam_attempts/${attemptId}/save`, {
            method: 'POST',
            body: JSON.stringify({
                answers: JSON.stringify({ content: answers })
            })
        });
        
        const data = await response.json();
        
        if (data.success && showMessage) {
            showAlert('Réponses sauvegardées', 'success');
        }
    } catch (error) {
        console.error('Erreur sauvegarde:', error);
    }
}

async function saveExamDraft() {
    if (!currentExamAttempt) return;
    await saveExamAnswers(currentExamAttempt.id, true);
}

async function logExamActivity(attemptId, eventType, eventData = {}) {
    try {
        const response = await authenticatedFetch(`/api/exam_attempts/${attemptId}/log_activity`, {
            method: 'POST',
            body: JSON.stringify({
                event_type: eventType,
                event_data: JSON.stringify(eventData)
            })
        });
        
        return await response.json();
    } catch (error) {
        console.error('Erreur log activity:', error);
        return null;
    }
}

function submitExamNow() {
    if (!currentExamAttempt) return;
    _showSignatureModal();
}

function _showSignatureModal() {
    const overlay = document.createElement('div');
    overlay.id = 'signature-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:16px;padding:28px;width:420px;max-width:95vw;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
            <h3 style="margin:0 0 6px;font-size:18px;color:#0f172a;"><i class="fas fa-pen-nib" style="color:#6366f1;margin-right:8px;"></i>Signature électronique</h3>
            <p style="margin:0 0 16px;font-size:13px;color:#64748b;">Signez dans le cadre ci-dessous pour confirmer que vous avez composé cet examen seul et sans aide non autorisée.</p>
            <canvas id="sig-canvas" width="360" height="140" style="border:2px solid #e2e8f0;border-radius:10px;display:block;cursor:crosshair;background:#f8fafc;touch-action:none;"></canvas>
            <div style="display:flex;gap:8px;margin-top:14px;">
                <button onclick="_clearSignature()" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;cursor:pointer;font-size:13px;"><i class="fas fa-eraser"></i> Effacer</button>
                <button onclick="_cancelSignature()" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;color:#64748b;cursor:pointer;font-size:13px;"><i class="fas fa-times"></i> Annuler</button>
                <button onclick="_confirmSignatureAndSubmit()" style="flex:2;padding:10px;border:none;border-radius:8px;background:#6366f1;color:white;cursor:pointer;font-size:13px;font-weight:600;"><i class="fas fa-paper-plane"></i> Soumettre</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    _initSignaturePad();
}

function _initSignaturePad() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let lastX = 0, lastY = 0;

    function getPos(e) {
        const r = canvas.getBoundingClientRect();
        const src = e.touches ? e.touches[0] : e;
        return [(src.clientX - r.left) * (canvas.width / r.width),
                (src.clientY - r.top)  * (canvas.height / r.height)];
    }
    function start(e) { e.preventDefault(); drawing = true; [lastX, lastY] = getPos(e); }
    function draw(e)  {
        e.preventDefault();
        if (!drawing) return;
        const [x, y] = getPos(e);
        ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y);
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.stroke();
        [lastX, lastY] = [x, y];
    }
    function stop() { drawing = false; }

    canvas.addEventListener('mousedown',  start); canvas.addEventListener('mousemove',  draw); canvas.addEventListener('mouseup',   stop);
    canvas.addEventListener('touchstart', start); canvas.addEventListener('touchmove',  draw); canvas.addEventListener('touchend',  stop);
}

function _clearSignature() {
    const canvas = document.getElementById('sig-canvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

function _cancelSignature() {
    const el = document.getElementById('signature-overlay');
    if (el) el.remove();
}

async function _confirmSignatureAndSubmit() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;

    // Check if canvas has any drawing
    const ctx = canvas.getContext('2d');
    const pixel = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const hasDrawing = pixel.some(v => v !== 0);
    if (!hasDrawing) {
        alert('Veuillez signer avant de soumettre.');
        return;
    }

    const signatureData = canvas.toDataURL('image/png');
    _cancelSignature();

    showLoader(true);
    try {
        const answers = document.getElementById('exam-answers')?.value || '';
        const response = await authenticatedFetch(`/api/exam_attempts/${currentExamAttempt.id}/submit`, {
            method: 'POST',
            body: JSON.stringify({
                answers: JSON.stringify({ content: answers }),
                signature_data: signatureData
            })
        });
        const data = await response.json();
        if (data.success) {
            clearInterval(examAutoSaveInterval);
            _stopFaceDetection();
            const msg = data.auto_correct
                ? 'Votre copie a été soumise. La correction par IA est en cours — votre note sera disponible dans quelques instants.'
                : 'Votre examen a été soumis avec succès. Votre note sera disponible après correction par votre professeur.';
            showAlert(msg, 'success');
            setTimeout(() => { loadOnlineExams(); }, 2000);
        } else {
            showAlert(data.error || 'Impossible de soumettre l\'examen.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function autoSubmitExam(attemptId) {
    clearInterval(examAutoSaveInterval);
    _stopFaceDetection();
    showLoader(true);
    try {
        const answers = document.getElementById('exam-answers')?.value || '';
        await authenticatedFetch(`/api/exam_attempts/${attemptId}/submit`, {
            method: 'POST',
            body: JSON.stringify({ answers: JSON.stringify({ content: answers }) })
        });
        showAlert('Temps écoulé — votre examen a été soumis automatiquement.', 'info');
        setTimeout(() => { loadOnlineExams(); }, 3000);
    } catch(error) {
        if (!error.alreadyHandled) showAlert(error.serverMessage || error.message || 'Erreur lors de la soumission automatique.', 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// RELEVÉS DE NOTES
// ============================================================================

async function loadTranscripts() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    
    try {
        if (currentUser.role === 'student') {
            await loadStudentTranscripts();
        } else {
            await loadAllTranscripts();
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function loadStudentTranscripts() {
    let transcripts = [];
    let fetchError = null;
    try {
        const response = await authenticatedFetch('/api/student/transcripts');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        transcripts = await response.json();
    } catch (err) {
        fetchError = err;
    }

    let html = `
        <div class="page-header">
            <h2><i class="fas fa-file-alt"></i> Mes Relevés de Notes</h2>
            <p>Consultez et téléchargez vos relevés de notes officiels</p>
        </div>
    `;

    if (fetchError) {
        html += `
            <div class="alert alert-danger" style="display:flex;gap:16px;align-items:flex-start;">
                <i class="fas fa-exclamation-circle" style="font-size:28px;margin-top:2px;flex-shrink:0;"></i>
                <div>
                    <strong>Impossible de charger vos relevés</strong>
                    <p style="margin:8px 0 12px;">Une erreur de connexion est survenue. Vérifiez votre connexion internet et réessayez.</p>
                    <button class="btn btn-primary btn-sm" onclick="loadStudentTranscripts()">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                </div>
            </div>
        `;
    } else if (transcripts.length === 0) {
        html += `
            <div class="alert alert-info" style="display:flex;gap:16px;align-items:flex-start;margin-bottom:24px;">
                <i class="fas fa-info-circle" style="font-size:28px;margin-top:2px;flex-shrink:0;"></i>
                <div>
                    <strong>Pas encore de relevé disponible</strong>
                    <p style="margin:8px 0 4px;">Votre relevé de notes est généré par votre professeur ou l'administration une fois vos examens corrigés et validés.</p>
                    <p style="margin:4px 0;">Si vos examens ont déjà été corrigés et que vous n'avez toujours pas de relevé, contactez votre enseignant ou l'administration.</p>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-question-circle"></i> Comment obtenir mon relevé ?</h3>
                </div>
                <div style="padding:20px;">
                    <ol style="margin:0;padding-left:24px;line-height:2.2;">
                        <li><i class="fas fa-pencil-alt" style="color:#3b82f6;margin-right:8px;"></i> Passez vos examens via la plateforme CEI</li>
                        <li><i class="fas fa-check-double" style="color:#10b981;margin-right:8px;"></i> Vos copies sont corrigées par vos professeurs</li>
                        <li><i class="fas fa-file-alt" style="color:#f59e0b;margin-right:8px;"></i> Votre professeur ou l'admin génère votre relevé</li>
                        <li><i class="fas fa-download" style="color:#8b5cf6;margin-right:8px;"></i> Le relevé apparaît ici — vous pouvez le télécharger en PDF</li>
                    </ol>
                    <div style="margin-top:16px;padding:12px 16px;background:#f1f5f9;border-radius:8px;color:#475569;font-size:0.93em;">
                        <i class="fas fa-lightbulb" style="color:#f59e0b;margin-right:6px;"></i>
                        <strong>Astuce :</strong> Si vous pensez que vos notes sont déjà disponibles, cliquez sur
                        <button class="btn btn-sm btn-outline" onclick="loadStudentTranscripts()" style="padding:2px 10px;font-size:0.9em;">
                            <i class="fas fa-sync-alt"></i> Actualiser
                        </button> pour recharger cette page.
                    </div>
                </div>
            </div>
        `;
    } else {
        html += `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-history"></i> Mes Relevés (${transcripts.length})</h3>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th><i class="fas fa-graduation-cap"></i> Formation</th>
                            <th><i class="fas fa-calendar"></i> Semestre</th>
                            <th><i class="fas fa-star"></i> Moyenne</th>
                            <th><i class="fas fa-award"></i> Crédits</th>
                            <th><i class="fas fa-check-circle"></i> Statut</th>
                            <th><i class="fas fa-clock"></i> Date</th>
                            <th><i class="fas fa-cog"></i> Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        transcripts.forEach(transcript => {
            const statusClass = transcript.validated ? 'success' : 'danger';
            const statusLabel = transcript.validated ? '✅ VALIDÉ' : '❌ NON VALIDÉ';
            const gpaColor = transcript.gpa >= 10 ? '#10b981' : '#ef4444';
            
            html += `
                <tr>
                    <td>${transcript.formation_name}</td>
                    <td><strong>Semestre ${transcript.semester_number}</strong><br><small>${transcript.semester_name}</small></td>
                    <td><strong style="color: ${gpaColor}; font-size: 18px;">${transcript.gpa}/20</strong></td>
                    <td>${transcript.obtained_credits}/${transcript.total_credits}</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>${new Date(transcript.generated_at).toLocaleDateString('fr-FR')}</td>
                    <td>
                        <button class="btn btn-sm btn-success" onclick="downloadTranscriptPDF(${transcript.id})" title="Télécharger le relevé">
                            <i class="fas fa-download"></i> Télécharger PDF
                        </button>
                    </td>
                </tr>
            `;
        });
        
        html += `
                    </tbody>
                </table>
            </div>
        `;
    }
    
    document.getElementById('main-content').innerHTML = html;
}

async function loadAllTranscripts() {
    let existingTranscripts = [], students = [], loadErr = null;
    try {
        const [tRes, sRes] = await Promise.all([
            authenticatedFetch('/api/transcripts'),
            authenticatedFetch('/api/students/list')
        ]);
        if (!tRes.ok) throw new Error(`Relevés: HTTP ${tRes.status}`);
        if (!sRes.ok) throw new Error(`Étudiants: HTTP ${sRes.status}`);
        existingTranscripts = await tRes.json();
        students = await sRes.json();
    } catch (err) {
        loadErr = err;
    }

    if (loadErr) {
        document.getElementById('main-content').innerHTML = `
            <div class="page-header">
                <h2><i class="fas fa-file-alt"></i> Relevés de Notes</h2>
            </div>
            <div class="alert alert-danger" style="display:flex;gap:16px;align-items:flex-start;">
                <i class="fas fa-exclamation-circle" style="font-size:28px;margin-top:2px;flex-shrink:0;"></i>
                <div>
                    <strong>Erreur de chargement</strong>
                    <p style="margin:8px 0 12px;">Impossible de récupérer les données : ${loadErr.message}.<br>Vérifiez votre connexion et réessayez.</p>
                    <button class="btn btn-primary btn-sm" onclick="loadAllTranscripts()">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                </div>
            </div>
        `;
        return;
    }

    let studentsOptions = '<option value="">-- Sélectionner un étudiant --</option>';
    students.forEach(s => {
        studentsOptions += `<option value="${s.id}">${s.full_name}</option>`;
    });

    let semestersOptions = '<option value="">-- D\'abord sélectionner un étudiant --</option>';

    // Build unique semesters list for bulk ZIP selector
    const semesterMap = {};
    existingTranscripts.forEach(tr => {
        if (tr.semester_id && !semesterMap[tr.semester_id]) {
            semesterMap[tr.semester_id] = tr.semester_name || `Semestre ${tr.semester_id}`;
        }
    });
    const semesterEntries = Object.entries(semesterMap);

    const bulkBtn = semesterEntries.length > 0 ? `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <select id="bulk-semester-select" style="padding:6px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;background:#fff;">
                ${semesterEntries.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-success" onclick="downloadBulkTranscripts()" title="Télécharger tous les relevés du semestre en ZIP">
                <i class="fas fa-file-archive"></i> Télécharger tout (ZIP)
            </button>
        </div>` : '';

    let html = `
        <div class="page-header">
            <h2><i class="fas fa-file-alt"></i> Relevés de Notes</h2>
            <p>Générer et consulter les relevés de notes des étudiants</p>
        </div>

        <!-- SECTION : Relevés Existants -->
        <div class="card" style="margin-bottom: 24px;">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                <h3 style="margin:0;"><i class="fas fa-list"></i> Relevés Générés (${existingTranscripts.length})</h3>
                ${bulkBtn}
            </div>
    `;

    if (existingTranscripts.length === 0) {
        html += `
            <div style="padding:28px 24px;">
                <div style="display:flex;gap:16px;align-items:flex-start;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:20px;">
                    <i class="fas fa-file-circle-plus" style="font-size:36px;color:#94a3b8;flex-shrink:0;margin-top:4px;"></i>
                    <div>
                        <strong style="font-size:1.05em;color:#334155;">Aucun relevé n'a encore été généré</strong>
                        <p style="margin:8px 0 4px;color:#64748b;">Pour créer le premier relevé d'un étudiant, utilisez le formulaire ci-dessous. Assurez-vous que :</p>
                        <ul style="margin:6px 0 0 20px;color:#64748b;line-height:1.9;">
                            <li>L'étudiant a passé au moins un examen pour ce semestre</li>
                            <li>Les copies ont été corrigées (note attribuée)</li>
                            <li>Les UEs/ECs du semestre ont des coefficients renseignés</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
    } else {
        html += `
            <table>
                <thead>
                    <tr>
                        <th><i class="fas fa-user"></i> Étudiant</th>
                        <th><i class="fas fa-graduation-cap"></i> Formation</th>
                        <th><i class="fas fa-calendar"></i> Semestre</th>
                        <th><i class="fas fa-star"></i> Moyenne</th>
                        <th><i class="fas fa-award"></i> Crédits</th>
                        <th><i class="fas fa-check-circle"></i> Statut</th>
                        <th><i class="fas fa-clock"></i> Généré le</th>
                        <th><i class="fas fa-cog"></i> Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        existingTranscripts.forEach(transcript => {
            const statusClass = transcript.validated ? 'success' : 'danger';
            const statusLabel = transcript.validated ? '✅ VALIDÉ' : '❌ NON VALIDÉ';
            const gpaColor = transcript.gpa >= 10 ? '#10b981' : '#ef4444';

            // Droit de suppression : admin toujours, prof seulement si c'est lui qui a généré
            const canDelete = currentUser && (
                currentUser.role === 'admin'
                || (currentUser.role === 'professor' && transcript.generated_by_id == currentUser.id)
            );

            const sName = (transcript.student_name || '').replace(/'/g, "\\'");
            const semName = (transcript.semester_name || '').replace(/'/g, "\\'");

            html += `
                <tr>
                    <td>
                        <strong>${transcript.student_name}</strong>
                        <br><small style="color: #64748b;">${transcript.student_email}</small>
                    </td>
                    <td>${transcript.formation_name}</td>
                    <td>${transcript.semester_name}</td>
                    <td><strong style="color: ${gpaColor}; font-size: 16px;">${transcript.gpa}/20</strong></td>
                    <td>${transcript.obtained_credits}/${transcript.total_credits}</td>
                    <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
                    <td>
                        <div style="font-size:12px;">${new Date(transcript.generated_at).toLocaleDateString('fr-FR')}</div>
                        <small style="color:#64748b;">${transcript.generated_by || 'Système'}</small>
                    </td>
                    <td>
                        <div style="display:flex;gap:4px;flex-wrap:wrap;">
                            <button class="btn btn-sm btn-primary" onclick="downloadTranscriptPDF(${transcript.id})" title="Télécharger PDF">
                                <i class="fas fa-file-pdf"></i> PDF
                            </button>
                            ${canDelete ? `
                            <button class="btn btn-sm btn-danger" onclick="confirmDeleteTranscript(${transcript.id}, '${sName}', '${semName}')" title="Supprimer ce relevé">
                                <i class="fas fa-trash"></i>
                            </button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
        });
        
        html += `
                </tbody>
            </table>
        `;
    }
    
    html += `</div>`;
    
    // SECTION : Générer Nouveau Relevé
    html += `
        <div class="card">
            <div class="card-header">
                <h3><i class="fas fa-plus"></i> Générer un Nouveau Relevé</h3>
            </div>

            <div style="padding:0 20px;">
                <div class="alert alert-info" style="display:flex;gap:14px;align-items:flex-start;margin-bottom:20px;">
                    <i class="fas fa-lightbulb" style="font-size:22px;margin-top:2px;flex-shrink:0;"></i>
                    <div style="font-size:0.93em;">
                        <strong>Prérequis avant de générer un relevé :</strong>
                        <ol style="margin:6px 0 0 18px;line-height:1.8;">
                            <li>Sélectionnez l'étudiant concerné dans la liste</li>
                            <li>Choisissez le semestre pour lequel vous souhaitez générer le relevé</li>
                            <li>Assurez-vous que les copies de l'étudiant pour ce semestre ont été corrigées (sinon le relevé ne peut pas être calculé)</li>
                        </ol>
                        <p style="margin:8px 0 0;color:#475569;">Le relevé sera calculé automatiquement à partir des notes des examens corrigés, puis téléchargé en PDF.</p>
                    </div>
                </div>
            </div>

            <form id="generate-transcript-form" style="padding:0 20px 20px;">
                <div class="form-group">
                    <label><i class="fas fa-user"></i> Étudiant *</label>
                    <select id="transcript-student" required onchange="loadSemestersForStudent(this.value)">
                        ${studentsOptions}
                    </select>
                    <small class="form-help"><i class="fas fa-info-circle"></i> Sélectionnez d'abord l'étudiant pour charger ses semestres disponibles</small>
                </div>

                <div class="form-group">
                    <label><i class="fas fa-calendar"></i> Semestre *</label>
                    <select id="transcript-semester" required disabled>
                        ${semestersOptions}
                    </select>
                    <small class="form-help" id="semester-help-text"><i class="fas fa-arrow-up"></i> Sélectionnez d'abord un étudiant pour activer ce champ</small>
                </div>

                <div id="transcript-form-error" style="display:none;"></div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-file-pdf"></i> Générer le Relevé
                </button>
            </form>
        </div>
    `;
    
    document.getElementById('main-content').innerHTML = html;
    
    document.getElementById('generate-transcript-form').addEventListener('submit', handleGenerateTranscript);
}

async function loadSemestersForStudent(studentId) {
    if (!studentId) return;

    const semesterSelect = document.getElementById('transcript-semester');
    const helpText = document.getElementById('semester-help-text');
    const formError = document.getElementById('transcript-form-error');

    semesterSelect.innerHTML = '<option value="">Chargement des semestres...</option>';
    semesterSelect.disabled = true;
    if (formError) { formError.style.display = 'none'; }

    showLoader(true);

    try {
        const formationsResponse = await authenticatedFetch('/api/formations');
        if (!formationsResponse.ok) throw new Error(`HTTP ${formationsResponse.status}`);
        const formations = await formationsResponse.json();

        let semestersOptions = '<option value="">-- Sélectionner un semestre --</option>';
        let totalSemesters = 0;

        for (const formation of formations) {
            const semestersResponse = await authenticatedFetch(`/api/formations/${formation.id}/semesters`);
            if (!semestersResponse.ok) continue;
            const semesters = await semestersResponse.json();

            if (semesters.length > 0) {
                semestersOptions += `<optgroup label="${formation.name}">`;
                semesters.forEach(s => {
                    semestersOptions += `<option value="${s.id}">${s.name}</option>`;
                });
                semestersOptions += `</optgroup>`;
                totalSemesters += semesters.length;
            }
        }

        semesterSelect.innerHTML = semestersOptions;
        semesterSelect.disabled = false;

        if (helpText) {
            if (totalSemesters === 0) {
                helpText.innerHTML = '<i class="fas fa-exclamation-triangle" style="color:#f59e0b;"></i> Aucun semestre trouvé. Créez d\'abord une formation avec des semestres dans l\'onglet <strong>Formations</strong>.';
            } else {
                helpText.innerHTML = `<i class="fas fa-check" style="color:#10b981;"></i> ${totalSemesters} semestre(s) disponible(s) — choisissez celui pour lequel vous voulez générer le relevé`;
            }
        }
    } catch (error) {
        semesterSelect.innerHTML = '<option value="">Erreur de chargement</option>';
        semesterSelect.disabled = true;
        if (formError) {
            formError.style.display = 'block';
            formError.innerHTML = `
                <div class="alert alert-danger" style="display:flex;gap:12px;align-items:flex-start;">
                    <i class="fas fa-exclamation-circle" style="font-size:20px;flex-shrink:0;margin-top:2px;"></i>
                    <div>
                        <strong>Impossible de charger les semestres</strong>
                        <p style="margin:6px 0 10px;">Une erreur est survenue lors du chargement des formations. Vérifiez votre connexion.</p>
                        <button class="btn btn-sm btn-primary" onclick="loadSemestersForStudent('${studentId}')">
                            <i class="fas fa-redo"></i> Réessayer
                        </button>
                    </div>
                </div>
            `;
        }
    } finally {
        showLoader(false);
    }
}

async function handleGenerateTranscript(e) {
    e.preventDefault();
    showLoader(true);

    const formError = document.getElementById('transcript-form-error');
    if (formError) formError.style.display = 'none';

    try {
        const studentId = document.getElementById('transcript-student').value;
        const semesterId = document.getElementById('transcript-semester').value;
        const studentName = document.getElementById('transcript-student').selectedOptions[0]?.text || 'l\'étudiant';
        const semesterName = document.getElementById('transcript-semester').selectedOptions[0]?.text || 'ce semestre';

        const response = await fetch(`/api/transcripts/generate/${studentId}/${semesterId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` }
        });

        if (response.status === 401 || response.status === 422) {
            showAlert('Votre session a expiré. Veuillez vous reconnecter.', 'warning');
            showLogin();
            return;
        }

        const data = await response.json();

        if (data.success) {
            // Télécharger le PDF directement
            const pdfResponse = await fetch(`/api/transcripts/${data.transcript.id}/pdf`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            if (pdfResponse.ok) {
                const blob = await pdfResponse.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `releve_notes_${data.transcript.student_name || studentName}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showModal(`
                    <div style="text-align:center;padding:10px 0;">
                        <i class="fas fa-check-circle" style="font-size:56px;color:#10b981;margin-bottom:16px;display:block;"></i>
                        <h2 style="margin-bottom:8px;">Relevé généré avec succès !</h2>
                        <p style="color:#64748b;margin-bottom:20px;">
                            Le relevé de <strong>${studentName}</strong> pour <strong>${semesterName}</strong>
                            a été généré et le téléchargement PDF a démarré automatiquement.
                        </p>
                        <div style="display:flex;gap:12px;justify-content:center;">
                            <button class="btn btn-success" onclick="closeModal(); loadAllTranscripts()">
                                <i class="fas fa-list"></i> Voir tous les relevés
                            </button>
                            <button class="btn btn-secondary" onclick="closeModal()">
                                <i class="fas fa-times"></i> Fermer
                            </button>
                        </div>
                    </div>
                `);
            } else {
                showModal(`
                    <div style="text-align:center;padding:10px 0;">
                        <i class="fas fa-check-circle" style="font-size:48px;color:#10b981;margin-bottom:12px;display:block;"></i>
                        <h2 style="margin-bottom:8px;">Relevé généré !</h2>
                        <p style="color:#64748b;margin-bottom:8px;">Le relevé a été enregistré mais le téléchargement PDF a échoué.</p>
                        <p style="color:#64748b;margin-bottom:20px;">Rendez-vous dans la liste des relevés ci-dessus et cliquez sur <strong>PDF</strong> pour le télécharger.</p>
                        <button class="btn btn-primary" onclick="closeModal(); loadAllTranscripts()">
                            <i class="fas fa-list"></i> Voir la liste des relevés
                        </button>
                    </div>
                `);
            }
        } else {
            const errorMsg = data.error || '';
            let helpHtml = '';

            if (errorMsg.includes('Aucune note') || errorMsg.includes('note disponible')) {
                helpHtml = `
                    <div class="alert alert-warning" style="display:flex;gap:14px;align-items:flex-start;text-align:left;">
                        <i class="fas fa-exclamation-triangle" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                        <div>
                            <strong>Aucune note disponible pour ce semestre</strong>
                            <p style="margin:8px 0 4px;">Le relevé de <strong>${studentName}</strong> pour <strong>${semesterName}</strong> ne peut pas être généré car aucune copie corrigée n'a été trouvée.</p>
                            <p style="margin:4px 0 12px;color:#64748b;">Pour résoudre ce problème :</p>
                            <ol style="margin:0 0 12px 20px;color:#64748b;line-height:1.9;">
                                <li>Vérifiez que l'étudiant a bien passé des examens pour ce semestre</li>
                                <li>Vérifiez que les copies ont été corrigées dans l'onglet <strong>Corrections</strong></li>
                                <li>Assurez-vous que les UEs/ECs de ce semestre ont des coefficients &gt; 0</li>
                            </ol>
                            <button class="btn btn-sm btn-primary" onclick="loadExamCorrections()">
                                <i class="fas fa-check-circle"></i> Aller aux Corrections
                            </button>
                        </div>
                    </div>
                `;
            } else if (errorMsg.includes('Étudiant non trouvé')) {
                helpHtml = `
                    <div class="alert alert-danger" style="display:flex;gap:14px;align-items:flex-start;text-align:left;">
                        <i class="fas fa-user-times" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                        <div>
                            <strong>Étudiant introuvable</strong>
                            <p style="margin:8px 0 10px;color:#64748b;">L'étudiant sélectionné n'existe plus dans le système. Actualisez la page pour recharger la liste.</p>
                            <button class="btn btn-sm btn-primary" onclick="loadAllTranscripts()">
                                <i class="fas fa-redo"></i> Actualiser
                            </button>
                        </div>
                    </div>
                `;
            } else if (errorMsg.includes('Semestre non trouvé')) {
                helpHtml = `
                    <div class="alert alert-danger" style="display:flex;gap:14px;align-items:flex-start;text-align:left;">
                        <i class="fas fa-calendar-times" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                        <div>
                            <strong>Semestre introuvable</strong>
                            <p style="margin:8px 0 10px;color:#64748b;">Le semestre sélectionné n'existe plus. Actualisez la page et resélectionnez l'étudiant.</p>
                            <button class="btn btn-sm btn-primary" onclick="loadAllTranscripts()">
                                <i class="fas fa-redo"></i> Actualiser
                            </button>
                        </div>
                    </div>
                `;
            } else if (errorMsg.includes('non autorisé') || errorMsg.includes('403')) {
                helpHtml = `
                    <div class="alert alert-danger" style="display:flex;gap:14px;align-items:flex-start;text-align:left;">
                        <i class="fas fa-lock" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                        <div>
                            <strong>Accès non autorisé</strong>
                            <p style="margin:8px 0 0;color:#64748b;">Vous n'avez pas les droits pour générer des relevés. Seuls les professeurs et les administrateurs peuvent effectuer cette action.</p>
                        </div>
                    </div>
                `;
            } else {
                helpHtml = `
                    <div class="alert alert-danger" style="display:flex;gap:14px;align-items:flex-start;text-align:left;">
                        <i class="fas fa-exclamation-circle" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                        <div>
                            <strong>Erreur lors de la génération</strong>
                            <p style="margin:8px 0 10px;color:#64748b;">${errorMsg || 'Une erreur inattendue est survenue. Veuillez réessayer.'}</p>
                            <button class="btn btn-sm btn-primary" onclick="document.getElementById('generate-transcript-form').dispatchEvent(new Event('submit'))">
                                <i class="fas fa-redo"></i> Réessayer
                            </button>
                        </div>
                    </div>
                `;
            }

            if (formError) {
                formError.style.display = 'block';
                formError.innerHTML = helpHtml;
                formError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } else {
                showModal(helpHtml);
            }
        }
    } catch (error) {
        const formError = document.getElementById('transcript-form-error');
        const errHtml = `
            <div class="alert alert-danger" style="display:flex;gap:14px;align-items:flex-start;">
                <i class="fas fa-wifi" style="font-size:24px;flex-shrink:0;margin-top:2px;"></i>
                <div>
                    <strong>Erreur de connexion</strong>
                    <p style="margin:8px 0 10px;color:#64748b;">Impossible de contacter le serveur. Vérifiez votre connexion internet et réessayez.</p>
                    <button class="btn btn-sm btn-primary" onclick="document.getElementById('generate-transcript-form').dispatchEvent(new Event('submit'))">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                </div>
            </div>
        `;
        if (formError) {
            formError.style.display = 'block';
            formError.innerHTML = errHtml;
        } else {
            showAlert(humanError(error), 'error');
        }
    } finally {
        showLoader(false);
    }
}
// ============================================================================
// CORRECTION D'EXAMENS EN LIGNE
// ============================================================================

async function loadExamCorrections() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    
    try {
        // Récupérer les examens du professeur
        const examsResponse = await authenticatedFetch('/api/online_exams');
        const exams = await examsResponse.json();
        
        // Filtrer les examens terminés ou actifs
        const relevantExams = exams.filter(e => e.status === 'active' || e.status === 'closed');
        
        if (relevantExams.length === 0) {
            document.getElementById('main-content').innerHTML = `
                <div class="page-header">
                    <h2><i class="fas fa-check-circle"></i> Corrections d'Examens en Ligne</h2>
                </div>
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i>
                    <div>Aucun examen à corriger pour le moment</div>
                </div>
            `;
            showLoader(false);
            return;
        }
        
        let html = `
            <div class="page-header">
                <h2><i class="fas fa-check-circle"></i> Corrections d'Examens en Ligne</h2>
                <p>Corrigez automatiquement les examens soumis avec l'IA</p>
            </div>
        `;
        
        for (const exam of relevantExams) {
            // Récupérer les tentatives de cet examen
            const attemptsResponse = await authenticatedFetch(`/api/online_exams/${exam.id}/attempts`);
            const attempts = await attemptsResponse.json();
            
            // Filtrer celles qui nécessitent une correction
            const needsCorrection = attempts.filter(a => a.needs_correction);
            const corrected = attempts.filter(a => a.score !== null);
            
            if (attempts.length === 0) continue;
            
            html += `
                <div class="card" style="margin-bottom: 24px;">
                    <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <h3><i class="fas fa-laptop-code"></i> ${exam.title}</h3>
                            <small style="color: #64748b;">
                                ${attempts.length} tentative(s) |
                                ${needsCorrection.length} à corriger |
                                ${corrected.length} corrigée(s)
                            </small>
                        </div>
                        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                            ${exam.status === 'active' ? `
                                <button class="btn btn-sm" onclick="openProctoringDashboard(${exam.id})"
                                    style="background:#7c3aed;color:white;">
                                    <i class="fas fa-shield-alt"></i> Surveiller
                                </button>
                            ` : ''}
                            ${needsCorrection.length > 0 ? `
                                <button class="btn btn-success" onclick="correctAllExamAttempts(${exam.id})">
                                    <i class="fas fa-magic"></i> Tout Corriger avec IA
                                </button>
                                <button class="btn btn-sm" onclick="startChainCorrection(${exam.id})"
                                    style="background:#6366f1;color:white;">
                                    <i class="fas fa-forward"></i> Correction en chaîne
                                </button>
                            ` : ''}
                            <button class="btn btn-sm" onclick="exportExamResultsCSV(${exam.id}, '${(exam.title||'').replace(/'/g,"\\'")}')"
                                style="background:#0f766e;color:white;" title="Exporter les résultats en CSV">
                                <i class="fas fa-file-csv"></i> Export CSV
                            </button>
                        </div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th><i class="fas fa-user"></i> Étudiant</th>
                                <th><i class="fas fa-calendar"></i> Soumis le</th>
                                <th><i class="fas fa-exclamation-triangle"></i> Incidents</th>
                                <th><i class="fas fa-star"></i> Note</th>
                                <th><i class="fas fa-cog"></i> Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            attempts.forEach(attempt => {
                const statusBadge = {
                    'in_progress': '<span class="status-badge warning">En cours</span>',
                    'submitted': '<span class="status-badge success">Soumis</span>',
                    'auto_submitted': '<span class="status-badge info">Auto-soumis</span>',
                    'banned': '<span class="status-badge danger">Banni</span>'
                }[attempt.status] || attempt.status;
                
                const incidentsBadge = attempt.has_incidents ? 
                    `<span style="color: #ef4444;"><i class="fas fa-exclamation-circle"></i> ${attempt.warnings_count}</span>` : 
                    '<span style="color: #10b981;"><i class="fas fa-check"></i> Aucun</span>';
                
                const scoreDisplay = attempt.score !== null ? 
                    `<strong style="color: ${attempt.score >= 10 ? '#10b981' : '#ef4444'}; font-size: 18px;">${attempt.score}/20</strong>` : 
                    '<span style="color: #94a3b8;">Non corrigé</span>';
                
                html += `
                    <tr>
                        <td>${attempt.student_name}</td>
                        <td>${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString('fr-FR') : 'N/A'}</td>
                        <td>${incidentsBadge}</td>
                        <td>${scoreDisplay}</td>
                        <td>
                            <div style="display:flex;gap:4px;flex-wrap:wrap;">
                            ${attempt.status === 'banned' ? `
                                <span class="status-badge danger" style="font-size:11px;">Banni</span>
                                <button class="btn btn-sm" onclick="confirmUnbanAttempt(${attempt.id}, '${(attempt.student_name||'').replace(/'/g,"\\'")}')"
                                    style="background:#f59e0b;color:#fff;font-size:11px;padding:3px 8px;" title="Lever le bannissement">
                                    <i class="fas fa-user-check"></i> Débannir
                                </button>
                            ` : attempt.needs_correction ? `
                                <button class="btn btn-sm btn-primary" onclick="correctSingleAttempt(${attempt.id})">
                                    <i class="fas fa-magic"></i> Corriger
                                </button>
                            ` : `
                                <button class="btn btn-sm btn-info" onclick="viewAttemptDetails(${attempt.id})">
                                    <i class="fas fa-eye"></i> Voir
                                </button>
                            `}
                            </div>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        document.getElementById('main-content').innerHTML = html;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function correctSingleAttempt(attemptId) {
    if (!confirm('Lancer la correction automatique avec IA pour cette tentative ?')) {
        return;
    }
    
    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/exam_attempts/${attemptId}/correct`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showAlert(`Correction terminée avec succès ! Note attribuée : ${data.attempt.score}/20.`, 'success');
            loadExamCorrections(); // Recharger
        } else {
            showAlert(data.error || 'Impossible de corriger cette copie en ligne. Vérifiez que le sujet a un barème valide.', 'error');
        }
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function correctAllExamAttempts(examId) {
    if (!confirm('Corriger automatiquement TOUTES les tentatives soumises de cet examen avec l\'IA ?')) {
        return;
    }
    
    showLoader(true);
    showAlert('Correction en cours... Veuillez patienter.', 'info');
    
    try {
        // Récupérer les tentatives
        const attemptsResponse = await authenticatedFetch(`/api/online_exams/${examId}/attempts`);
        const attempts = await attemptsResponse.json();
        
        const needsCorrection = attempts.filter(a => a.needs_correction);
        
        let corrected = 0;
        let errors = 0;
        
        for (const attempt of needsCorrection) {
            try {
                const response = await authenticatedFetch(`/api/exam_attempts/${attempt.id}/correct`, {
                    method: 'POST'
                });
                
                const data = await response.json();
                
                if (data.success) {
                    corrected++;
                } else {
                    errors++;
                }
            } catch (error) {
                errors++;
            }
        }
        
        showAlert(`Correction terminée! ${corrected} réussie(s), ${errors} erreur(s)`, 'success');
        loadExamCorrections();
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function confirmUnbanAttempt(attemptId, studentName) {
    const existing = document.getElementById('unban-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'unban-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);';
    modal.innerHTML = `
        <div style="background:var(--surface,#fff);border-radius:12px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
                <span style="background:#fef3c7;border-radius:50%;width:40px;height:40px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-user-check" style="color:#d97706;font-size:18px;"></i>
                </span>
                <h3 style="margin:0;font-size:1.1rem;color:var(--text,#1e293b);">Lever le bannissement</h3>
            </div>
            <p style="color:var(--text-secondary,#475569);margin:0 0 8px;">
                Vous allez réautoriser <strong>${studentName}</strong> à poursuivre l'examen.
            </p>
            <div style="margin-bottom:16px;">
                <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:6px;">Motif (optionnel)</label>
                <input id="unban-reason" type="text" placeholder="Ex : erreur de détection, incident technique..."
                    style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;">
            </div>
            <div style="background:#fef3c7;border-radius:8px;padding:10px 14px;margin-bottom:20px;">
                <p style="margin:0;font-size:12px;color:#92400e;"><i class="fas fa-info-circle"></i> L'étudiant retrouvera accès à l'examen avec le temps restant à l'expiration d'origine.</p>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end;">
                <button onclick="document.getElementById('unban-modal').remove()"
                    style="padding:9px 20px;border:1px solid var(--border,#e2e8f0);background:transparent;border-radius:8px;cursor:pointer;color:var(--text,#1e293b);">
                    Annuler
                </button>
                <button onclick="unbanAttempt(${attemptId})"
                    style="padding:9px 20px;background:#f59e0b;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;">
                    <i class="fas fa-user-check"></i> Confirmer le débannissement
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function unbanAttempt(attemptId) {
    const reason = document.getElementById('unban-reason')?.value || '';
    document.getElementById('unban-modal')?.remove();
    try {
        showLoader(true);
        const res = await authenticatedFetch(`/api/exam_attempts/${attemptId}/unban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            showAlert(data.message, 'success');
            loadExamCorrections();
        } else {
            showAlert(data.error || 'Erreur lors du débannissement.', 'error');
        }
    } catch(e) {
        showAlert('Erreur réseau.', 'error');
    } finally {
        showLoader(false);
    }
}

async function exportExamResultsCSV(examId, examTitle) {
    try {
        showLoader(true);
        const res = await authenticatedFetch(`/api/online_exams/${examId}/results/csv`);
        if (!res.ok) { showAlert('Erreur lors de l\'export.', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `resultats_${(examTitle || examId).replace(/\s+/g, '_').substring(0, 40)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) {
        showAlert('Erreur lors du téléchargement CSV.', 'error');
    } finally {
        showLoader(false);
    }
}

async function viewAttemptDetails(attemptId) {
    showLoader(true);
    
    try {
        // Récupérer les détails de la tentative en récupérant l'examen et ses tentatives
        const examsResponse = await authenticatedFetch('/api/online_exams');
        const exams = await examsResponse.json();
        
        let attempt = null;
        for (const exam of exams) {
            const attemptsResponse = await authenticatedFetch(`/api/online_exams/${exam.id}/attempts`);
            const attempts = await attemptsResponse.json();
            attempt = attempts.find(a => a.id === attemptId);
            if (attempt) break;
        }
        
        if (!attempt) {
            showAlert('Tentative introuvable. Veuillez actualiser la liste.', 'error');
            showLoader(false);
            return;
        }
        
        // Parser les réponses (supporte content, reponse, answer, text)
        let answers = '';
        try {
            const answersData = JSON.parse(attempt.answers);
            answers = answersData.content || answersData.reponse || answersData.answer || answersData.text || attempt.answers || '';
        } catch {
            answers = attempt.answers || '';
        }
        answers = answers.trim() || 'Aucune réponse enregistrée';
        
        const modalContent = `
            <h2><i class="fas fa-file-alt"></i> Détails de la Tentative</h2>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-info-circle"></i> Informations</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong>Étudiant:</strong> ${attempt.student_name}</p>
                    <p><strong>Examen:</strong> ${attempt.exam_title}</p>
                    <p><strong>Démarré le:</strong> ${new Date(attempt.started_at).toLocaleString('fr-FR')}</p>
                    <p><strong>Soumis le:</strong> ${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString('fr-FR') : 'N/A'}</p>
                    <p><strong>Statut:</strong> ${attempt.status}</p>
                    <p><strong>Changements de fenêtre:</strong> ${attempt.tab_switches}</p>
                    <p><strong>Avertissements:</strong> ${attempt.warnings_count}</p>
                </div>
            </div>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-pen"></i> Réponses de l'Étudiant</h4>
                </div>
                <div style="padding: 15px;">
                    <div style="background: #f8fafc; padding: 12px; border-radius: 6px; max-height: 300px; overflow-y: auto; white-space: pre-wrap;">
${answers}
                    </div>
                </div>
            </div>
            
            ${attempt.score !== null ? `
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-star"></i> Résultat</h4>
                    </div>
                    <div style="padding: 15px;">
                        <p><strong>Note:</strong> <span style="font-size: 24px; color: ${attempt.score >= 10 ? '#10b981' : '#ef4444'}; font-weight: bold;">${attempt.score}/20</span></p>
                        <p><strong>Corrigé par:</strong> ${attempt.corrector_name || 'Système'}</p>
                        <p><strong>Corrigé le:</strong> ${new Date(attempt.corrected_at).toLocaleString('fr-FR')}</p>
                    </div>
                </div>
                
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-comment"></i> Feedback</h4>
                    </div>
                    <div style="padding: 15px;">
                        <div style="background: #f1f5f9; padding: 12px; border-radius: 6px; max-height: 300px; overflow-y: auto; white-space: pre-wrap;">
${attempt.feedback}
                        </div>
                    </div>
                </div>
            ` : ''}
            
            ${attempt.signature_data ? `
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-pen-nib"></i> Signature électronique</h4>
                    </div>
                    <div style="padding: 15px;">
                        <img src="${attempt.signature_data}" alt="Signature de l'étudiant" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;max-width:360px;height:auto;display:block;">
                    </div>
                </div>
            ` : ''}

            <button class="btn btn-secondary" onclick="closeModal()">
                <i class="fas fa-times"></i> Fermer
            </button>
        `;

        showModal(modalContent, '900px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// INCIDENTS ET LOGS
// ============================================================================

async function viewExamIncidents(examId) {
    showLoader(true);
    
    try {
        const response = await authenticatedFetch(`/api/online_exams/${examId}/incidents`);
        const data = await response.json();
        
        let html = `
            <h2><i class="fas fa-shield-alt"></i> Incidents et Logs de Surveillance</h2>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-chart-bar"></i> Statistiques</h4>
                </div>
                <div style="padding: 15px; display: flex; gap: 24px;">
                    <div>
                        <strong>Total incidents:</strong> ${data.statistics.total_incidents}
                    </div>
                    <div style="color: #ef4444;">
                        <strong>Changements de fenêtre:</strong> ${data.statistics.tab_switches}
                    </div>
                    <div style="color: #dc2626;">
                        <strong>Étudiants bannis:</strong> ${data.statistics.banned_students}
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h4><i class="fas fa-list"></i> Journal des Événements</h4>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th><i class="fas fa-clock"></i> Horodatage</th>
                            <th><i class="fas fa-user"></i> Étudiant</th>
                            <th><i class="fas fa-exclamation-triangle"></i> Type</th>
                            <th><i class="fas fa-info-circle"></i> Détails</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        if (data.incidents.length === 0) {
            html += '<tr><td colspan="4" style="text-align: center; color: #10b981;"><i class="fas fa-check-circle"></i> Aucun incident détecté</td></tr>';
        } else {
            data.incidents.forEach(incident => {
                const eventTypeLabels = {
                    'tab_switch': '🚨 Changement de fenêtre',
                    'copy_attempt': '📋 Tentative de copie',
                    'paste_attempt': '📋 Tentative de collage',
                    'right_click': '🖱️ Clic droit',
                    'devtools_attempt': '🔧 Console développeur',
                    'face_absent': '👤 Visage absent',
                    'no_face_detected': '👤 Visage absent',
                    'multiple_faces': '👥 Plusieurs visages'
                };
                
                const eventLabel = eventTypeLabels[incident.event_type] || incident.event_type;
                const severityColor = incident.severity === 'high' ? '#ef4444' : '#f59e0b';
                
                // ✅ CORRECTION : Parser et formater le JSON des détails
                let detailsText = '-';
                if (incident.event_data) {
                    try {
                        const eventData = JSON.parse(incident.event_data);
                        
                        if (incident.event_type === 'tab_switch' && eventData.count) {
                            detailsText = `Tentative n°${eventData.count}`;
                        } else if (eventData.count) {
                            detailsText = `Occurrence n°${eventData.count}`;
                        } else {
                            // Afficher les clés/valeurs de manière lisible
                            const entries = Object.entries(eventData);
                            if (entries.length > 0) {
                                detailsText = entries.map(([key, val]) => `${key}: ${val}`).join(', ');
                            }
                        }
                    } catch (e) {
                        // Si le parsing échoue, afficher tel quel
                        detailsText = incident.event_data;
                    }
                }
                
                html += `
                    <tr>
                        <td>${new Date(incident.timestamp).toLocaleString('fr-FR')}</td>
                        <td>${incident.student_name}</td>
                        <td><span style="color: ${severityColor}; font-weight: bold;">${eventLabel}</span></td>
                        <td><small style="color: #64748b;">${detailsText}</small></td>
                    </tr>
                `;
            });
        }
        
        html += `
                    </tbody>
                </table>
            </div>
            
            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;
        
        showModal(html, '1000px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// Modifier viewOnlineExamDetails pour ajouter le bouton incidents
// Remplacez la fonction existante par celle-ci:

async function viewOnlineExamDetails(examId) {
    showLoader(true);
    
    try {
        const response = await authenticatedFetch('/api/online_exams');
        const exams = await response.json();
        const exam = exams.find(e => e.id === examId);
        
        if (!exam) {
            showAlert('Examen introuvable. Veuillez actualiser la liste.', 'error');
            showLoader(false);
            return;
        }
        
        const statusClass = {
            'draft': 'secondary',
            'scheduled': 'warning',
            'active': 'success',
            'closed': 'danger'
        }[exam.status] || 'secondary';
        
        const statusLabel = {
            'draft': 'Brouillon',
            'scheduled': 'Planifié',
            'active': 'En cours',
            'closed': 'Terminé'
        }[exam.status] || exam.status;
        
        const modalContent = `
            <h2><i class="fas fa-laptop-code"></i> Détails de l'Examen</h2>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-info-circle"></i> Informations Générales</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong><i class="fas fa-heading"></i> Titre:</strong> ${exam.title}</p>
                    <p><strong><i class="fas fa-book"></i> Sujet:</strong> ${exam.subject_title || 'N/A'}</p>
                    <p><strong><i class="fas fa-user"></i> Créé par:</strong> ${exam.creator_name || 'N/A'}</p>
                    <p><strong><i class="fas fa-info-circle"></i> Statut:</strong> 
                        <span class="status-badge ${statusClass}">${statusLabel}</span>
                    </p>
                    <p><strong><i class="fas fa-clock"></i> Durée:</strong> ${exam.duration_minutes} minutes</p>
                    <p><strong><i class="fas fa-calendar"></i> Début:</strong> ${fmtDakar(exam.start_time)}</p>
                    <p><strong><i class="fas fa-calendar"></i> Fin:</strong> ${fmtDakar(exam.end_time)}</p>
                    <p><strong><i class="fas fa-users"></i> Tentatives:</strong> ${exam.attempts_count}</p>
                </div>
            </div>
            
            ${exam.instructions ? `
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h4><i class="fas fa-file-alt"></i> Instructions</h4>
                    </div>
                    <div style="padding: 15px;">
                        <div style="background: #f8fafc; padding: 12px; border-radius: 6px; white-space: pre-wrap;">
${exam.instructions}
                        </div>
                    </div>
                </div>
            ` : ''}
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-shield-alt"></i> Paramètres de Sécurité</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong><i class="fas fa-window-restore"></i> Changements de fenêtre autorisés:</strong> ${exam.max_tab_switches}</p>
                    <p><strong><i class="fas fa-copy"></i> Copier/Coller:</strong> ${exam.enable_copy_paste ? '✅ Autorisé' : '❌ Désactivé'}</p>
                    <p><strong><i class="fas fa-mouse-pointer"></i> Clic droit:</strong> ${exam.enable_right_click ? '✅ Autorisé' : '❌ Désactivé'}</p>
                </div>
            </div>
            
            <div style="display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap;">
                ${exam.attempts_count > 0 ? `
                    <button class="btn btn-primary" onclick="closeModal(); viewExamSubmissions(${exam.id})">
                        <i class="fas fa-file-alt"></i> Voir les Copies Soumises
                    </button>
                    <button class="btn btn-warning" onclick="closeModal(); viewExamIncidents(${exam.id})">
                        <i class="fas fa-exclamation-triangle"></i> Incidents
                    </button>
                ` : ''}
                ${exam.status === 'active' ? `
                    <button class="btn btn-success" onclick="closeModal(); openProctoringDashboard(${exam.id})">
                        <i class="fas fa-shield-alt"></i> Surveiller
                    </button>
                    <button class="btn btn-danger" onclick="closeModal(); closeExam(${exam.id})">
                        <i class="fas fa-stop-circle"></i> Fermer l'Examen
                    </button>
                ` : ''}
                ${exam.status === 'scheduled' || exam.status === 'draft' ? `
                    <button class="btn btn-success" onclick="closeModal(); activateExam(${exam.id})">
                        <i class="fas fa-play-circle"></i> Activer l'Examen
                    </button>
                    <button class="btn btn-danger" onclick="closeModal(); deleteOnlineExam(${exam.id})">
                        <i class="fas fa-trash"></i> Supprimer
                    </button>
                ` : ''}
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;
        
        showModal(modalContent, '800px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function viewExamSubmissions(examId) {
    window._currentViewedExamId = examId;
    showLoader(true);
    try {
        const [examsResp, attemptsResp] = await Promise.all([
            authenticatedFetch('/api/online_exams'),
            authenticatedFetch(`/api/online_exams/${examId}/attempts`)
        ]);
        const exams    = await examsResp.json();
        const attempts = await attemptsResp.json();
        const exam     = exams.find(e => e.id === examId);
        if (!exam) { showAlert('Examen introuvable.', 'error'); showLoader(false); return; }

        const inProgress = attempts.filter(a => a.status === 'in_progress');
        const done       = attempts.filter(a => ['submitted','auto_submitted'].includes(a.status));
        const banned     = attempts.filter(a => a.status === 'banned');

        const th = (label) => `<th style="padding:9px 12px;text-align:left;border-bottom:2px solid #e2e8f0;font-size:11px;text-transform:uppercase;color:#64748b;font-weight:600;">${label}</th>`;
        const tdStyle = 'padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle;';

        // ── Section En cours ────────────────────────────────
        const inProgressRows = inProgress.length === 0
            ? `<tr><td colspan="5" style="${tdStyle}text-align:center;color:#94a3b8;">Aucun étudiant en cours</td></tr>`
            : inProgress.map(a => `
                <tr>
                    <td style="${tdStyle}"><strong>${a.student_name||'N/A'}</strong><br><small style="color:#64748b;">${a.student_email||''}</small></td>
                    <td style="${tdStyle}">${a.started_at ? new Date(a.started_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
                    <td style="${tdStyle}">${a.warnings_count > 0
                        ? `<span style="color:#ef4444;font-weight:600;"><i class="fas fa-exclamation-circle"></i> ${a.warnings_count}</span>`
                        : `<span style="color:#10b981;"><i class="fas fa-check"></i> 0</span>`}</td>
                    <td style="${tdStyle}">
                        <span style="background:rgba(16,185,129,.1);color:#059669;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;">
                            <i class="fas fa-circle" style="font-size:7px;margin-right:4px;"></i>En cours
                        </span>
                    </td>
                    <td style="${tdStyle}">
                        <div style="display:flex;gap:5px;">
                            <button class="btn btn-sm" onclick="grantExtraTime(${a.id},'${(a.student_name||'').replace(/'/g,"\\'")}') "
                                style="background:#dcfce7;color:#16a34a;font-size:10px;padding:4px 9px;" title="Accorder du temps supplémentaire">
                                <i class="fas fa-clock"></i> +temps
                            </button>
                            <button class="btn btn-sm" onclick="addProctorNote(${a.id},'${(a.student_name||'').replace(/'/g,"\\'")}') "
                                style="background:#e0f2fe;color:#0284c7;font-size:10px;padding:4px 9px;" title="Note de surveillance">
                                <i class="fas fa-sticky-note"></i> Note
                            </button>
                        </div>
                    </td>
                </tr>`).join('');

        // ── Section Terminés ────────────────────────────────
        const doneRows = done.length === 0
            ? `<tr><td colspan="6" style="${tdStyle}text-align:center;color:#94a3b8;">Aucune copie soumise</td></tr>`
            : done.map(a => {
                const isAuto = a.status === 'auto_submitted';
                // Signature pré-examen
                let preMeta = null;
                try { preMeta = a.pre_exam_signature_meta ? JSON.parse(a.pre_exam_signature_meta) : null; } catch(e) {}
                const preQuality = preMeta
                    ? `traits:${preMeta.strokes} dur:${Math.round((preMeta.duration_ms||0)/1000)}s`
                    : '';
                const preSign = a.pre_exam_signature_data
                    ? `<button onclick="showSignatureImage('${encodeURIComponent(a.pre_exam_signature_data)}','Attestation pré-examen — ${(a.student_name||'').replace(/'/g,"\\'")}','${preQuality}')"
                        style="background:rgba(16,185,129,.1);color:#059669;border:1px solid rgba(16,185,129,.3);border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer;font-weight:600;" title="Voir la signature pré-examen">
                        <i class="fas fa-check-circle"></i> Pré ↗
                      </button>`
                    : `<span style="color:#94a3b8;font-size:10px;"><i class="fas fa-times-circle"></i> Pré absent</span>`;
                const postSign = a.signature_data
                    ? `<button onclick="showSignatureImage('${encodeURIComponent(a.signature_data)}','Signature de soumission — ${(a.student_name||'').replace(/'/g,"\\'")}','')"
                        style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);border-radius:5px;padding:2px 8px;font-size:10px;cursor:pointer;font-weight:600;" title="Voir la signature post-examen">
                        <i class="fas fa-check-circle"></i> Post ↗
                      </button>`
                    : `<span style="color:${isAuto ? '#f59e0b' : '#94a3b8'};font-size:10px;"><i class="fas fa-${isAuto ? 'clock' : 'times-circle'}"></i> ${isAuto ? 'Auto' : 'Post absent'}</span>`;
                return `
                <tr>
                    <td style="${tdStyle}"><strong>${a.student_name||'N/A'}</strong><br><small style="color:#64748b;">${a.student_email||''}</small></td>
                    <td style="${tdStyle}">
                        ${isAuto
                            ? `<span style="background:rgba(245,158,11,.1);color:#d97706;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;"><i class="fas fa-clock"></i> Auto-soumis</span>`
                            : `<span style="background:rgba(16,185,129,.1);color:#059669;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;"><i class="fas fa-check"></i> Soumis</span>`}
                    </td>
                    <td style="${tdStyle}">${a.submitted_at ? new Date(a.submitted_at).toLocaleString('fr-FR') : '—'}</td>
                    <td style="${tdStyle}">
                        <div style="display:flex;gap:8px;align-items:center;">${preSign}${postSign}</div>
                    </td>
                    <td style="${tdStyle}">${a.score !== null && a.score !== undefined
                        ? `<strong style="color:${a.score>=10?'#10b981':'#ef4444'};font-size:15px;">${a.score}/20</strong>`
                        : `<span style="color:#94a3b8;font-size:12px;">Non corrigé</span>`}</td>
                    <td style="${tdStyle}">
                        <div style="display:flex;gap:5px;flex-wrap:wrap;">
                            ${a.needs_correction
                                ? `<button class="btn btn-sm btn-primary" onclick="closeModal();correctSingleAttempt(${a.id})" style="font-size:10px;padding:4px 8px;"><i class="fas fa-magic"></i> Corriger</button>`
                                : `<button class="btn btn-sm" onclick="closeModal();viewAttemptDetails(${a.id})" style="background:#f1f5f9;color:#475569;font-size:10px;padding:4px 8px;"><i class="fas fa-eye"></i> Voir</button>`}
                            <button class="btn btn-sm" onclick="showManualGradingModal(${a.id},'${(a.student_name||'').replace(/'/g,"\\'")}',${a.score !== null && a.score !== undefined ? a.score : 'null'})"
                                style="background:#ede9fe;color:#6366f1;font-size:10px;padding:4px 8px;" title="Correction manuelle">
                                <i class="fas fa-pen"></i>
                            </button>
                            <button class="btn btn-sm" onclick="downloadIntegrityReport(${a.id},'${(a.student_name||'etudiant').replace(/'/g,'').replace(/\s+/g,'_')}')"
                                style="background:#fef3c7;color:#d97706;font-size:10px;padding:4px 8px;" title="Rapport intégrité PDF">
                                <i class="fas fa-file-pdf"></i>
                            </button>
                            <button class="btn btn-sm" onclick="viewProctorNotes(${a.id},'${(a.student_name||'').replace(/'/g,"\\'")}') "
                                style="background:#e0f2fe;color:#0284c7;font-size:10px;padding:4px 8px;" title="Voir les notes de surveillance">
                                <i class="fas fa-sticky-note"></i>
                            </button>
                        </div>
                    </td>
                </tr>`;
            }).join('');

        // ── Section Bannis ───────────────────────────────────
        const bannedRows = banned.length === 0 ? '' : banned.map(a => `
            <tr>
                <td style="${tdStyle}"><strong>${a.student_name||'N/A'}</strong><br><small style="color:#64748b;">${a.student_email||''}</small></td>
                <td style="${tdStyle};color:#ef4444;">${a.ban_reason || 'Fraude détectée'}</td>
                <td style="${tdStyle}">
                    <button class="btn btn-sm" onclick="closeModal();unbanStudent(${a.id})" style="background:rgba(239,68,68,.1);color:#ef4444;font-size:11px;padding:5px 10px;">
                        <i class="fas fa-user-check"></i> Débannir
                    </button>
                </td>
            </tr>`).join('');

        const hasToCorrected = done.some(a => a.needs_correction);

        const modalContent = `
            <div style="margin-bottom:16px;">
                <h2 style="margin:0 0 4px;font-size:18px;"><i class="fas fa-file-alt"></i> ${exam.title}</h2>
                <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">
                    <span style="background:rgba(16,185,129,.1);color:#059669;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;">
                        <i class="fas fa-circle" style="font-size:8px;"></i> ${inProgress.length} en cours
                    </span>
                    <span style="background:rgba(99,102,241,.1);color:#6366f1;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;">
                        <i class="fas fa-check-circle"></i> ${done.length} terminé(s)
                    </span>
                    ${banned.length > 0 ? `<span style="background:rgba(239,68,68,.1);color:#ef4444;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:600;">
                        <i class="fas fa-ban"></i> ${banned.length} banni(s)
                    </span>` : ''}
                    ${hasToCorrected ? `<button class="btn btn-success btn-sm" onclick="closeModal();correctAllExamAttempts(${examId})" style="margin-left:auto;">
                        <i class="fas fa-magic"></i> Tout corriger (IA)
                    </button>` : ''}
                </div>
                <!-- Barre d'outils examen -->
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #f1f5f9;">
                    <button class="btn btn-sm" onclick="showExamStats(${examId})"
                        style="background:#ede9fe;color:#6366f1;font-size:12px;padding:6px 12px;">
                        <i class="fas fa-chart-bar"></i> Statistiques
                    </button>
                    <button class="btn btn-sm" onclick="exportExamCSV(${examId},'${(exam.title||'').replace(/'/g,'').replace(/"/g,'')}')"
                        style="background:#d1fae5;color:#059669;font-size:12px;padding:6px 12px;">
                        <i class="fas fa-file-csv"></i> Export CSV
                    </button>
                    <button class="btn btn-sm" onclick="showPlagiarismReport(${examId},'${(exam.title||'').replace(/'/g,'').replace(/"/g,'')}')"
                        style="background:#fee2e2;color:#ef4444;font-size:12px;padding:6px 12px;">
                        <i class="fas fa-search"></i> Plagiat
                    </button>
                    <button class="btn btn-sm" onclick="showExamQRCode(${examId},'${(exam.title||'').replace(/'/g,'').replace(/"/g,'')}')"
                        style="background:#fef3c7;color:#d97706;font-size:12px;padding:6px 12px;">
                        <i class="fas fa-qrcode"></i> QR Code
                    </button>
                    <button class="btn btn-sm" onclick="showExamBilan(${examId},'${(exam.title||'').replace(/'/g,'').replace(/"/g,'')}')"
                        style="background:#e0f2fe;color:#0369a1;font-size:12px;padding:6px 12px;">
                        <i class="fas fa-list-alt"></i> Bilan
                    </button>
                </div>
            </div>

            <!-- EN COURS -->
            <div style="margin-bottom:20px;">
                <div style="font-size:12px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <span style="display:inline-block;width:8px;height:8px;background:#10b981;border-radius:50%;animation:pulse 1.5s infinite;"></span>
                    En cours (${inProgress.length})
                </div>
                <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">${th('Étudiant')}${th('Démarré')}${th('Alertes')}${th('Statut')}${th('Actions surveillant')}</tr></thead>
                        <tbody>${inProgressRows}</tbody>
                    </table>
                </div>
            </div>

            <!-- TERMINÉS -->
            <div style="margin-bottom:20px;">
                <div style="font-size:12px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
                    <i class="fas fa-check-circle"></i> Terminés (${done.length})
                    <span style="font-weight:400;color:#64748b;font-size:11px;margin-left:8px;text-transform:none;">
                        Pré = signature avant exam · Post = signature à la soumission
                    </span>
                </div>
                <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:8px;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">${th('Étudiant')}${th('Statut')}${th('Soumis le')}${th('Signatures')}${th('Note')}${th('Action')}</tr></thead>
                        <tbody>${doneRows}</tbody>
                    </table>
                </div>
            </div>

            ${banned.length > 0 ? `
            <!-- BANNIS -->
            <div style="margin-bottom:20px;">
                <div style="font-size:12px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
                    <i class="fas fa-ban"></i> Exclus (${banned.length})
                </div>
                <div style="overflow-x:auto;border:1px solid #fee2e2;border-radius:8px;background:#fff5f5;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#fef2f2;">${th('Étudiant')}${th('Raison')}${th('Action')}</tr></thead>
                        <tbody>${bannedRows}</tbody>
                    </table>
                </div>
            </div>` : ''}

            <div style="text-align:right;">
                <button class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Fermer</button>
            </div>`;

        showModal(modalContent, '960px');
    } catch(e) {
        showAlert(humanError(e), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// VISIONNEUSE DE SIGNATURE
// ============================================================================

function showSignatureImage(encodedData, title, metaStr) {
    const data = decodeURIComponent(encodedData);
    const metaHtml = metaStr ? `
        <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:10px;">
            ${metaStr.split(' ').map(part => {
                const [k, v] = part.split(':');
                const labels = { traits: 'Traits', dur: 'Durée', lon: 'Longueur' };
                return `<span style="background:#f1f5f9;padding:3px 10px;border-radius:6px;font-size:12px;color:#475569;">
                    <strong>${labels[k] || k}</strong> : ${v}
                </span>`;
            }).join('')}
        </div>` : '';

    showModal(`
        <div style="text-align:center;">
            <h3 style="margin:0 0 14px;font-size:15px;color:#0f172a;">
                <i class="fas fa-signature" style="color:#6366f1;margin-right:8px;"></i>${title}
            </h3>
            <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#f8fafc;display:inline-block;max-width:100%;">
                <img src="${data}" alt="Signature" style="display:block;max-width:480px;width:100%;height:auto;">
            </div>
            ${metaHtml}
            <div style="margin-top:16px;">
                <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fermer</button>
            </div>
        </div>`, '560px');
}

// ============================================================================
// HISTORIQUE DES EXAMENS (ADMIN)
// ============================================================================

async function loadExamsHistory() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/admin/exams_history');
        const history = await response.json();

        if (history.length === 0) {
            document.getElementById('main-content').innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px;">
                    <div>
                        <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                            <i class="fas fa-clock-rotate-left" style="color:#3b82f6;"></i> Historique des Examens
                        </h2>
                        <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Statistiques et journaux des examens terminés</p>
                    </div>
                </div>
                <div style="text-align:center;padding:64px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
                    <i class="fas fa-folder-open" style="font-size:52px;color:#94a3b8;margin-bottom:18px;display:block;"></i>
                    <h3 style="color:#334155;margin:0 0 10px;">Aucun examen terminé</h3>
                    <p style="color:#64748b;margin:0;max-width:360px;margin-left:auto;margin-right:auto;">
                        L'historique s'alimentera automatiquement dès qu'un examen sera clôturé.
                    </p>
                </div>
            `;
            showLoader(false);
            return;
        }

        const totalAttempts  = history.reduce((s, e) => s + (e.total_attempts || 0), 0);
        const totalIncidents = history.reduce((s, e) => s + (e.incidents_count || 0), 0);
        const avgScore       = history.filter(e => e.average_score != null).length > 0
            ? (history.reduce((s, e) => s + (e.average_score || 0), 0) / history.length).toFixed(1)
            : '—';

        const rows = history.map(exam => {
            const sc        = exam.average_score;
            const scColor   = sc >= 10 ? '#10b981' : '#ef4444';
            const scBg      = sc >= 10 ? '#dcfce7'  : '#fee2e2';
            const dateStr   = fmtDakarDate(exam.end_time);
            const initials  = (exam.creator_name || 'N').split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();

            return `
                <tr style="transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;max-width:260px;">
                        <p style="margin:0;font-weight:600;color:#0f172a;font-size:13px;line-height:1.4;">${exam.title}</p>
                        ${exam.subject_title ? `<p style="margin:3px 0 0;font-size:11px;color:#94a3b8;">${exam.subject_title}</p>` : ''}
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:7px;">
                            <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                            <span style="font-size:13px;color:#334155;">${exam.creator_name}</span>
                        </div>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#64748b;">
                            <i class="fas fa-calendar-day" style="color:#94a3b8;font-size:11px;"></i> ${dateStr}
                        </div>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;">
                        <p style="margin:0;font-size:13px;font-weight:600;color:#0f172a;">${exam.total_attempts} participant(s)</p>
                        <p style="margin:2px 0 0;font-size:11px;color:#64748b;">
                            ${exam.submitted_count} soumis · ${exam.corrected_count} corrigés
                            ${exam.banned_count > 0 ? ` · <span style="color:#ef4444;font-weight:600;">${exam.banned_count} exclus</span>` : ''}
                        </p>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
                        <span style="display:inline-block;background:${scBg};color:${scColor};padding:4px 10px;border-radius:8px;font-weight:700;font-size:15px;">${sc}/20</span>
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">
                        ${exam.incidents_count > 0
                            ? `<span style="display:inline-flex;align-items:center;gap:5px;background:#fee2e2;color:#991b1b;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:600;">
                                   <i class="fas fa-triangle-exclamation" style="font-size:10px;"></i> ${exam.incidents_count}
                               </span>`
                            : `<span style="display:inline-flex;align-items:center;gap:5px;background:#dcfce7;color:#15803d;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:600;">
                                   <i class="fas fa-check" style="font-size:10px;"></i> Aucun
                               </span>`}
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #f1f5f9;white-space:nowrap;">
                        <div style="display:flex;gap:6px;">
                            <button onclick="viewExamHistoryDetails(${exam.id})"
                                style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                                <i class="fas fa-eye"></i> Détails
                            </button>
                            <button onclick="viewExamIncidents(${exam.id})"
                                style="display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background:#fffbeb;color:#92400e;border:1px solid #fde68a;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;"
                                onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='#fffbeb'">
                                <i class="fas fa-list-ul"></i> Logs
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('main-content').innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
                <div>
                    <h2 style="margin:0;font-size:20px;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <i class="fas fa-clock-rotate-left" style="color:#3b82f6;"></i> Historique des Examens
                    </h2>
                    <p style="margin:4px 0 0;color:#64748b;font-size:13px;">Statistiques et journaux des examens terminés</p>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#eff6ff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-file-circle-check" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${history.length}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">Examens terminés</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:#dcfce7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-users" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${totalAttempts}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">Participations totales</p>
                    </div>
                </div>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:14px;">
                    <div style="width:40px;height:40px;border-radius:10px;background:${totalIncidents > 0 ? '#fee2e2' : '#dcfce7'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-triangle-exclamation" style="color:${totalIncidents > 0 ? '#ef4444' : '#10b981'};font-size:16px;"></i>
                    </div>
                    <div>
                        <p style="margin:0;font-size:22px;font-weight:800;color:#0f172a;">${totalIncidents}</p>
                        <p style="margin:0;font-size:12px;color:#64748b;">Incidents détectés</p>
                    </div>
                </div>
            </div>

            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                <div style="padding:14px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-list" style="color:#64748b;font-size:13px;"></i>
                    <h3 style="margin:0;font-size:15px;color:#0f172a;font-weight:600;">Liste des examens</h3>
                    <span style="background:#f1f5f9;color:#64748b;padding:1px 8px;border-radius:99px;font-size:12px;margin-left:4px;">${history.length}</span>
                </div>
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="background:#f8fafc;">
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Examen</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Créateur</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Date de clôture</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Participants</th>
                                <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Moyenne</th>
                                <th style="padding:10px 16px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Incidents</th>
                                <th style="padding:10px 16px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid #e2e8f0;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function viewExamHistoryDetails(examId) {
    // Réutiliser viewOnlineExamDetails
    await viewOnlineExamDetails(examId);
}

// ============================================================================
// NOTIFICATIONS INCIDENTS PROFESSEUR
// ============================================================================

async function loadProfessorNotifications() {
    try {
        const response = await authenticatedFetch('/api/professor/recent_incidents');
        const data = await response.json();
        
        const notifBadge = document.getElementById('notif-badge');
        if (notifBadge && data.unread_count > 0) {
            notifBadge.textContent = data.unread_count;
            notifBadge.style.display = 'inline-block';
        }
        
        return data.incidents;
    } catch (error) {
        console.error('Erreur chargement notifications:', error);
        return [];
    }
}

async function showProfessorNotifications() {
    showLoader(true);
    
    try {
        const incidents = await loadProfessorNotifications();
        
        let html = `
            <h2><i class="fas fa-bell"></i> Notifications d'Incidents</h2>
            <p style="color: #64748b;">Incidents détectés dans les dernières 24h</p>
        `;
        
        if (incidents.length === 0) {
            html += `
                <div class="alert alert-success">
                    <i class="fas fa-check-circle"></i>
                    <div>Aucun incident détecté récemment. Tout va bien!</div>
                </div>
            `;
        } else {
            html += `
                <div class="card">
                    <table>
                        <thead>
                            <tr>
                                <th><i class="fas fa-clock"></i> Quand</th>
                                <th><i class="fas fa-laptop-code"></i> Examen</th>
                                <th><i class="fas fa-user"></i> Étudiant</th>
                                <th><i class="fas fa-exclamation-triangle"></i> Type</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            incidents.forEach(incident => {
                const eventTypeLabels = {
                    'tab_switch': 'Changement de fenêtre',
                    'copy_attempt': 'Tentative de copie',
                    'paste_attempt': 'Tentative de collage',
                    'right_click': 'Clic droit',
                    'devtools_attempt': 'Console développeur',
                    'face_absent': 'Visage absent',
                    'no_face_detected': 'Visage absent',
                    'multiple_faces': 'Plusieurs visages'
                };
                
                const eventLabel = eventTypeLabels[incident.event_type] || incident.event_type;
                const severityColor = incident.severity === 'high' ? '#ef4444' : '#f59e0b';
                
                const timeAgo = getTimeAgo(new Date(incident.timestamp));
                
                html += `
                    <tr>
                        <td>${timeAgo}</td>
                        <td><strong>${incident.exam_title}</strong></td>
                        <td>${incident.student_name}</td>
                        <td><span style="color: ${severityColor}; font-weight: bold;">${eventLabel}</span></td>
                    </tr>
                `;
            });
            
            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        html += `
            <div style="margin-top: 20px;">
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;
        
        showModal(html, '900px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    const intervals = {
        'an': 31536000,
        'mois': 2592000,
        'jour': 86400,
        'heure': 3600,
        'minute': 60
    };
    
    for (const [name, seconds_in_interval] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / seconds_in_interval);
        if (interval >= 1) {
            return `Il y a ${interval} ${name}${interval > 1 ? 's' : ''}`;
        }
    }
    
    return 'À l\'instant';
}

// Charger notifications au démarrage si professeur
if (currentUser && currentUser.role === 'professor') {
    setInterval(loadProfessorNotifications, 60000); // Toutes les minutes
}

async function downloadTranscriptPDF(transcriptId) {
    showLoader(true);

    try {
        const response = await fetch(`/api/transcripts/${transcriptId}/pdf`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `releve_notes_${transcriptId}.pdf`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showAlert('Relevé téléchargé avec succès !', 'success');
        } else if (response.status === 404) {
            showModal(`
                <div style="text-align:center;padding:10px 0;">
                    <i class="fas fa-file-times" style="font-size:48px;color:#ef4444;margin-bottom:16px;display:block;"></i>
                    <h3>Relevé introuvable</h3>
                    <p style="color:#64748b;margin:12px 0 20px;">Ce relevé n'existe plus dans le système ou le fichier PDF n'a pas pu être généré.<br>
                    Actualisez la liste et réessayez. Si le problème persiste, régénérez le relevé.</p>
                    <div style="display:flex;gap:12px;justify-content:center;">
                        <button class="btn btn-primary" onclick="closeModal(); loadAllTranscripts()">
                            <i class="fas fa-redo"></i> Actualiser la liste
                        </button>
                        <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                    </div>
                </div>
            `);
        } else if (response.status === 403) {
            showModal(`
                <div style="text-align:center;padding:10px 0;">
                    <i class="fas fa-lock" style="font-size:48px;color:#f59e0b;margin-bottom:16px;display:block;"></i>
                    <h3>Accès non autorisé</h3>
                    <p style="color:#64748b;margin:12px 0 20px;">Vous n'avez pas les droits pour télécharger ce relevé.<br>
                    Si vous êtes l'étudiant concerné, reconnectez-vous et réessayez.</p>
                    <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                </div>
            `);
        } else {
            showModal(`
                <div style="text-align:center;padding:10px 0;">
                    <i class="fas fa-exclamation-triangle" style="font-size:48px;color:#ef4444;margin-bottom:16px;display:block;"></i>
                    <h3>Téléchargement impossible</h3>
                    <p style="color:#64748b;margin:12px 0 20px;">Le serveur a retourné une erreur (${response.status}) lors de la génération du PDF.<br>
                    Vérifiez votre connexion et réessayez dans quelques instants.</p>
                    <div style="display:flex;gap:12px;justify-content:center;">
                        <button class="btn btn-primary" onclick="closeModal(); downloadTranscriptPDF(${transcriptId})">
                            <i class="fas fa-redo"></i> Réessayer
                        </button>
                        <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                    </div>
                </div>
            `);
        }
    } catch (error) {
        showModal(`
            <div style="text-align:center;padding:10px 0;">
                <i class="fas fa-wifi" style="font-size:48px;color:#ef4444;margin-bottom:16px;display:block;"></i>
                <h3>Erreur de connexion</h3>
                <p style="color:#64748b;margin:12px 0 20px;">Impossible de contacter le serveur pour télécharger le PDF.<br>
                Vérifiez votre connexion internet et réessayez.</p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button class="btn btn-primary" onclick="closeModal(); downloadTranscriptPDF(${transcriptId})">
                        <i class="fas fa-redo"></i> Réessayer
                    </button>
                    <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                </div>
            </div>
        `);
    } finally {
        showLoader(false);
    }
}

async function downloadBulkTranscripts() {
    const select = document.getElementById('bulk-semester-select');
    if (!select) return;
    const semesterId = select.value;
    const semesterName = select.options[select.selectedIndex]?.text || semesterId;
    if (!semesterId) { showAlert('Veuillez sélectionner un semestre.', 'warning'); return; }

    showLoader(true);
    try {
        const response = await fetch(`/api/transcripts/bulk-pdf?semester_id=${semesterId}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `releves_${semesterName.replace(/\s+/g,'_')}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showAlert(`ZIP téléchargé — relevés du semestre ${semesterName}`, 'success');
        } else {
            const data = await response.json().catch(() => ({}));
            showAlert(data.error || `Erreur ${response.status} lors de la génération du ZIP.`, 'danger');
        }
    } catch (err) {
        showAlert('Impossible de contacter le serveur. Vérifiez votre connexion.', 'danger');
    } finally {
        showLoader(false);
    }
}

async function viewTranscriptDetails(transcriptId) {
    showLoader(true);
    
    try {
        // Récupérer les détails du relevé
        const response = await authenticatedFetch('/api/transcripts');
        const transcripts = await response.json();
        const transcript = transcripts.find(t => t.id === transcriptId);
        
        if (!transcript) {
            showLoader(false);
            showModal(`
                <div style="text-align:center;padding:10px 0;">
                    <i class="fas fa-search" style="font-size:48px;color:#94a3b8;margin-bottom:16px;display:block;"></i>
                    <h3>Relevé introuvable</h3>
                    <p style="color:#64748b;margin:12px 0 20px;">
                        Ce relevé n'a pas pu être trouvé, il a peut-être été supprimé entre-temps.<br>
                        Actualisez la liste pour voir les relevés disponibles.
                    </p>
                    <div style="display:flex;gap:12px;justify-content:center;">
                        <button class="btn btn-primary" onclick="closeModal(); loadAllTranscripts()">
                            <i class="fas fa-redo"></i> Actualiser la liste
                        </button>
                        <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                    </div>
                </div>
            `);
            return;
        }
        
        const statusClass = transcript.validated ? 'success' : 'danger';
        const statusLabel = transcript.validated ? '✅ VALIDÉ' : '❌ NON VALIDÉ';
        const gpaColor = transcript.gpa >= 10 ? '#10b981' : '#ef4444';
        
        const modalContent = `
            <h2><i class="fas fa-file-alt"></i> Détails du Relevé</h2>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-user"></i> Informations Étudiant</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong>Nom:</strong> ${transcript.student_name}</p>
                    <p><strong>Email:</strong> ${transcript.student_email}</p>
                    <p><strong>Formation:</strong> ${transcript.formation_name}</p>
                    <p><strong>Semestre:</strong> ${transcript.semester_name}</p>
                </div>
            </div>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-chart-bar"></i> Résultats</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong>Moyenne Générale:</strong> <span style="font-size: 24px; color: ${gpaColor}; font-weight: bold;">${transcript.gpa}/20</span></p>
                    <p><strong>Crédits:</strong> ${transcript.obtained_credits}/${transcript.total_credits}</p>
                    <p><strong>Décision:</strong> <span class="status-badge ${statusClass}">${statusLabel}</span></p>
                </div>
            </div>
            
            <div class="card" style="margin-bottom: 20px;">
                <div class="card-header">
                    <h4><i class="fas fa-info-circle"></i> Informations Génération</h4>
                </div>
                <div style="padding: 15px;">
                    <p><strong>Généré par:</strong> ${transcript.generated_by}</p>
                    <p><strong>Date:</strong> ${new Date(transcript.generated_at).toLocaleString('fr-FR')}</p>
                </div>
            </div>
            
            <div style="display: flex; gap: 12px;">
                <button class="btn btn-success" onclick="closeModal(); downloadTranscriptPDF(${transcript.id})">
                    <i class="fas fa-download"></i> Télécharger PDF
                </button>
                <button class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Fermer
                </button>
            </div>
        `;
        
        showModal(modalContent, '700px');
    } catch (error) {
        showModal(`
            <div style="text-align:center;padding:10px 0;">
                <i class="fas fa-exclamation-circle" style="font-size:48px;color:#ef4444;margin-bottom:16px;display:block;"></i>
                <h3>Impossible d'afficher le relevé</h3>
                <p style="color:#64748b;margin:12px 0 20px;">
                    Une erreur est survenue lors de la récupération des données de ce relevé.<br>
                    Actualisez la liste et réessayez.
                </p>
                <div style="display:flex;gap:12px;justify-content:center;">
                    <button class="btn btn-primary" onclick="closeModal(); loadAllTranscripts()">
                        <i class="fas fa-redo"></i> Actualiser la liste
                    </button>
                    <button class="btn btn-secondary" onclick="closeModal()">Fermer</button>
                </div>
            </div>
        `);
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// NOUVEAU : CRÉATION ÉTUDIANT SANS EMAIL
// ============================================================================

function showCreateStudentNoEmailModal() {
    const modalContent = `
        <h2><i class="fas fa-user-plus"></i> Créer un Étudiant (Sans Email)</h2>
        <p style="color: #64748b; margin-bottom: 20px;">
            <i class="fas fa-info-circle"></i> Pour les étudiants qui n'ont pas d'adresse email
        </p>
        <form id="create-student-noemail-form">
            <div class="form-group">
                <label><i class="fas fa-user"></i> Nom Complet *</label>
                <input type="text" id="student-fullname" required placeholder="Ex: Jean Dupont">
                <small class="form-help">
                    <i class="fas fa-lightbulb"></i> Vérifiez bien l'orthographe pour éviter les doublons
                </small>
            </div>
            
            <div class="alert alert-warning" style="margin: 20px 0;">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <strong>Important:</strong>
                    <ul style="margin: 10px 0 0 20px;">
                        <li>L'étudiant ne recevra PAS d'email de bienvenue</li>
                        <li>Mot de passe par défaut : <code>Student2025</code></li>
                        <li>Aucun email ne sera envoyé lors de la correction de ses copies</li>
                    </ul>
                </div>
            </div>
            
            <div class="d-flex gap-2 mt-2">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-check"></i> Créer l'Étudiant
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeModal()">
                    <i class="fas fa-times"></i> Annuler
                </button>
            </div>
        </form>
    `;
    
    showModal(modalContent, '600px');
    
    document.getElementById('create-student-noemail-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        showLoader(true);
        
        try {
            const response = await authenticatedFetch('/api/admin/users/student-no-email', {
                method: 'POST',
                body: JSON.stringify({
                    full_name: document.getElementById('student-fullname').value
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showAlert(`✅ Étudiant créé : ${data.user.full_name}<br>Mot de passe : ${data.temp_password}`, 'success');
                closeModal();
                loadUsers();
            } else {
                showAlert(data.error || 'Impossible de créer l\'étudiant. Le nom est peut-être déjà enregistré.', 'error');
            }
        } catch (error) {
            showAlert(humanError(error), 'error');
        } finally {
            showLoader(false);
        }
    });
}

//============================================================================
// NOUVEAU : AFFICHER LISTE DES COPIES CORRIGÉES (PROFESSEUR)
// ============================================================================

async function loadCorrectedPapersList() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    
    try {
        const endpoint = currentUser.role === 'admin' 
            ? '/api/admin/corrected_papers' 
            : '/api/professor/corrected_papers';
        
        const response = await authenticatedFetch(endpoint);
        const data = await response.json();
        
        let html = `
            <div class="page-header">
                <h2><i class="fas fa-check-circle"></i> Copies Corrigées</h2>
                <p>${data.papers ? data.papers.length : 0} copie(s) corrigée(s)</p>
            </div>
        `;
        
        if (!data.papers || data.papers.length === 0) {
            html += `
                <div class="alert alert-info">
                    <i class="fas fa-info-circle"></i>
                    <div>Aucune copie corrigée pour le moment</div>
                </div>
            `;
        } else {
            html += `
                <div class="card">
                    <table>
                        <thead>
                            <tr>
                                <th><i class="fas fa-user"></i> Étudiant</th>
                                <th><i class="fas fa-envelope"></i> Email</th>
                                <th><i class="fas fa-file-alt"></i> Sujet</th>
                                <th><i class="fas fa-star"></i> Note</th>
                                <th><i class="fas fa-calendar"></i> Corrigé le</th>
                                <th><i class="fas fa-envelope-open"></i> Email</th>
                                <th><i class="fas fa-cog"></i> Actions</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            data.papers.forEach(p => {
                const scoreClass = p.score >= 10 ? 'success' : 'danger';
                const emailStatus = p.email_sent 
                    ? '<span style="color: #10b981;"><i class="fas fa-check-circle"></i> Envoyé</span>'
                    : '<span style="color: #94a3b8;"><i class="fas fa-times-circle"></i> Non envoyé</span>';
                
                html += `
                    <tr>
                        <td><strong>${p.student_name}</strong></td>
                        <td>${p.student_email}</td>
                        <td>${p.subject_title}</td>
                        <td><span class="status-badge ${scoreClass}">${p.score}/20</span></td>
                        <td>${new Date(p.corrected_at).toLocaleString('fr-FR')}</td>
                        <td>${emailStatus}</td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="viewPaperDetail(${p.id})">
                                <i class="fas fa-eye"></i> Détail
                            </button>
                            <button class="btn btn-sm btn-success" onclick="exportPaperPDF(${p.id})">
                                <i class="fas fa-file-pdf"></i> PDF
                            </button>
                        </td>
                    </tr>
                `;
            });
            
            html += `
                        </tbody>
                    </table>
                </div>
            `;
        }
        
        document.getElementById('main-content').innerHTML = html;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ============================================================================
// CRÉATION DE COURS AVEC SUGGESTIONS IA (VERSION AMÉLIORÉE)
// ============================================================================

async function showCreateCourseWithAISuggestionsModal() {
    showLoader(true);
    
    try {
        // Récupérer les ECs disponibles
        const ecsResponse = await authenticatedFetch('/api/ecs');
        const ecs = await ecsResponse.json();
        
        let ecsOptions = '<option value="">-- Optionnel: Lier à un EC --</option>';
        ecs.forEach(ec => {
            ecsOptions += `<option value="${ec.id}">${ec.ue_code} - ${ec.code}: ${ec.name}</option>`;
        });
        
        const modalContent = `
            <div class="ai-suggestions-modal">
                <div class="modal-header-custom">
                    <h2><i class="fas fa-magic"></i> Générer des Suggestions d'Examen avec IA</h2>
                    <p class="modal-subtitle">
                        <i class="fas fa-lightbulb"></i> Uploadez votre cours, l'IA analysera le contenu et proposera 3 sujets adaptés
                    </p>
                </div>
                
                <!-- STEP 1: Upload Formulaire -->
                <div id="upload-step" class="step-container">
                    <div class="info-box">
                        <div class="info-box-header">
                            <i class="fas fa-book-reader"></i>
                            <strong>Comment ça marche ?</strong>
                        </div>
                        <ol class="info-list">
                            <li><i class="fas fa-upload"></i> Uploadez votre fichier de cours (PDF, DOCX ou TXT)</li>
                            <li><i class="fas fa-robot"></i> L'IA analyse le contenu</li>
                            <li><i class="fas fa-check-circle"></i> Vous obtenez 3 suggestions de sujets personnalisées</li>
                        </ol>
                    </div>

                    <form id="ai-suggestions-form" class="ai-form">
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-file-upload"></i> Fichier Cours <span class="required">*</span>
                                <span class="label-hint">(PDF, DOCX, TXT - Max 16MB)</span>
                            </label>
                            <div class="file-input-wrapper">
                                <input type="file" id="course-file-input" accept=".pdf,.docx,.doc,.txt" required class="file-input">
                                <div class="file-input-placeholder">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    <span>Cliquez pour sélectionner ou glissez-déposez</span>
                                </div>
                            </div>
                            <small class="form-help">
                                <i class="fas fa-info-circle"></i> Le système analysera ce document pour générer des suggestions pertinentes
                            </small>
                        </div>

                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">
                                    <i class="fas fa-signal"></i> Niveau de Difficulté
                                </label>
                                <select id="ai-difficulty" class="form-select">
                                    <option value="Facile">Facile</option>
                                    <option value="Moyen" selected>Moyen</option>
                                    <option value="Difficile">Difficile</option>
                                    <option value="Très Difficile">Très Difficile</option>
                                </select>
                            </div>

                            <div class="form-group">
                                <label class="form-label">
                                    <i class="fas fa-user-graduate"></i> Niveau des Étudiants
                                </label>
                                <select id="ai-student-level" class="form-select">
                                    <option value="Licence 1">Licence 1</option>
                                    <option value="Licence 2">Licence 2</option>
                                    <option value="Licence 3" selected>Licence 3</option>
                                    <option value="Master 1">Master 1</option>
                                    <option value="Master 2">Master 2</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-layer-group"></i> Élément Constitutif (EC)
                                <span class="label-hint">(Optionnel)</span>
                            </label>
                            <select id="ai-ec-id" class="form-select">${ecsOptions}</select>
                        </div>

                        <div class="form-actions">
                            <button type="submit" class="btn btn-primary btn-large">
                                <i class="fas fa-sparkles"></i> Générer les Suggestions
                            </button>
                            <button type="button" class="btn btn-secondary" onclick="closeModal()">
                                <i class="fas fa-times"></i> Annuler
                            </button>
                        </div>
                    </form>
                </div>

                <!-- STEP 2: Résultats -->
                <div id="results-step" class="step-container" style="display: none;">
                    <!-- Résumé du cours -->
                    <div id="course-summary-section" class="summary-card">
                        <div class="summary-header">
                            <i class="fas fa-book-open"></i>
                            <h3>Résumé du Cours Analysé</h3>
                        </div>
                        <p id="course-summary-text" class="summary-text"></p>
                        <div id="main-topics-container" class="topics-container"></div>
                    </div>

                    <!-- En-tête Suggestions -->
                    <div class="suggestions-header">
                        <div class="suggestions-header-content">
                            <i class="fas fa-sparkles"></i>
                            <div>
                                <h3>Suggestions de Sujets d'Examen</h3>
                                <p>Sélectionnez le sujet qui correspond le mieux à vos besoins</p>
                            </div>
                        </div>
                    </div>

                    <!-- Liste des suggestions -->
                    <div id="suggestions-list-container" class="suggestions-grid"></div>

                    <div class="form-actions">
                        <button class="btn btn-secondary" onclick="showCreateCourseWithAISuggestionsModal()">
                            <i class="fas fa-arrow-left"></i> Nouvelle Génération
                        </button>
                    </div>
                </div>
            </div>

            <style>
                .ai-suggestions-modal {
                    max-width: 100%;
                }

                .modal-header-custom {
                    text-align: center;
                    margin-bottom: 24px;
                    padding-bottom: 16px;
                    border-bottom: 2px solid var(--border);
                }

                .modal-header-custom h2 {
                    margin: 0 0 8px 0;
                    color: var(--text);
                    font-size: 24px;
                }

                .modal-subtitle {
                    margin: 0;
                    color: var(--text-secondary);
                    font-size: 14px;
                }

                .step-container {
                    animation: fadeIn 0.3s ease-in-out;
                }

                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }

                .info-box {
                    background: var(--card-bg);
                    border: 2px solid var(--primary);
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 24px;
                }

                .info-box-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--primary);
                    font-size: 16px;
                    margin-bottom: 12px;
                }

                .info-box-header i {
                    font-size: 20px;
                }

                .info-list {
                    margin: 0;
                    padding-left: 20px;
                    list-style: none;
                }

                .info-list li {
                    padding: 8px 0;
                    color: var(--text-secondary);
                    display: flex;
                    align-items: start;
                    gap: 10px;
                }

                .info-list li i {
                    color: var(--primary);
                    margin-top: 2px;
                    min-width: 16px;
                }

                .ai-form {
                    display: flex;
                    flex-direction: column;
                    gap: 20px;
                }

                .form-label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-weight: 600;
                    color: var(--text);
                    margin-bottom: 8px;
                }

                .form-label i {
                    color: var(--primary);
                }

                .required {
                    color: var(--danger);
                }

                .label-hint {
                    font-weight: normal;
                    color: var(--text-secondary);
                    font-size: 13px;
                }

                .file-input-wrapper {
                    position: relative;
                    border: 2px dashed var(--border);
                    border-radius: 8px;
                    padding: 40px 20px;
                    text-align: center;
                    background: var(--bg);
                    transition: all 0.3s ease;
                    cursor: pointer;
                }

                .file-input-wrapper:hover {
                    border-color: var(--primary);
                    background: var(--card-bg);
                }

                .file-input {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    opacity: 0;
                    cursor: pointer;
                }

                .file-input-placeholder {
                    pointer-events: none;
                }

                .file-input-placeholder i {
                    font-size: 48px;
                    color: var(--primary);
                    margin-bottom: 12px;
                    display: block;
                }

                .file-input-placeholder span {
                    color: var(--text-secondary);
                    font-size: 14px;
                }

                .form-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 16px;
                }

                .form-select {
                    width: 100%;
                    padding: 10px 12px;
                    border: 1px solid var(--border);
                    border-radius: 6px;
                    background: var(--bg);
                    color: var(--text);
                    font-size: 14px;
                    transition: border-color 0.3s;
                }

                .form-select:focus {
                    outline: none;
                    border-color: var(--primary);
                }

                .form-help {
                    display: flex;
                    align-items: start;
                    gap: 6px;
                    color: var(--text-secondary);
                    font-size: 13px;
                    margin-top: 6px;
                }

                .form-help i {
                    color: var(--primary);
                    margin-top: 2px;
                }

                .form-actions {
                    display: flex;
                    gap: 12px;
                    margin-top: 24px;
                    flex-wrap: wrap;
                }

                .btn-large {
                    padding: 12px 24px;
                    font-size: 16px;
                }

                .summary-card {
                    background: var(--card-bg);
                    border: 1px solid var(--border);
                    border-left: 4px solid var(--primary);
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 24px;
                }

                .summary-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin-bottom: 16px;
                }

                .summary-header i {
                    font-size: 24px;
                    color: var(--primary);
                }

                .summary-header h3 {
                    margin: 0;
                    color: var(--text);
                    font-size: 18px;
                }

                .summary-text {
                    color: var(--text-secondary);
                    line-height: 1.6;
                    margin: 0;
                }

                .topics-container {
                    margin-top: 16px;
                    padding-top: 16px;
                    border-top: 1px solid var(--border);
                }

                .topics-label {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: var(--text);
                    font-weight: 600;
                    margin-bottom: 12px;
                }

                .topics-label i {
                    color: var(--primary);
                }

                .topics-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }

                .topic-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--primary);
                    color: white;
                    padding: 6px 14px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 500;
                }

                .topic-tag i {
                    font-size: 11px;
                }

                .suggestions-header {
                    background: var(--success);
                    color: white;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 24px;
                }

                .suggestions-header-content {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }

                .suggestions-header-content > i {
                    font-size: 32px;
                }

                .suggestions-header h3 {
                    margin: 0 0 4px 0;
                    font-size: 20px;
                }

                .suggestions-header p {
                    margin: 0;
                    opacity: 0.9;
                    font-size: 14px;
                }

                .suggestions-grid {
                    display: grid;
                    gap: 20px;
                }

                .suggestion-card {
                    background: var(--card-bg);
                    border: 2px solid var(--border);
                    border-radius: 12px;
                    padding: 24px;
                    transition: all 0.3s ease;
                }

                .suggestion-card:hover {
                    border-color: var(--primary);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                    transform: translateY(-2px);
                }

                .suggestion-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: start;
                    gap: 16px;
                    margin-bottom: 16px;
                    flex-wrap: wrap;
                }

                .suggestion-title {
                    flex: 1;
                    min-width: 200px;
                }

                .suggestion-title h4 {
                    color: var(--text);
                    margin: 0 0 12px 0;
                    font-size: 18px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .suggestion-title h4 i {
                    color: var(--primary);
                }

                .suggestion-badges {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }

                .badge-icon {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: 6px 12px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 500;
                    white-space: nowrap;
                }

                .badge-type {
                    background: var(--primary);
                    color: white;
                }

                .badge-difficulty {
                    background: #8b5cf6;
                    color: white;
                }

                .badge-duration {
                    background: var(--success);
                    color: white;
                }

                .badge-icon i {
                    font-size: 12px;
                }

                .suggestion-description {
                    color: var(--text-secondary);
                    line-height: 1.6;
                    margin: 16px 0;
                }

                .suggestion-section {
                    background: var(--bg);
                    border-radius: 8px;
                    padding: 16px;
                    margin: 16px 0;
                }

                .section-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: var(--text);
                    font-weight: 600;
                    margin-bottom: 12px;
                }

                .section-title i {
                    color: var(--primary);
                }

                .suggestion-list {
                    margin: 8px 0 0 20px;
                    padding: 0;
                    list-style: none;
                }

                .suggestion-list li {
                    color: var(--text-secondary);
                    margin: 6px 0;
                    display: flex;
                    align-items: start;
                    gap: 8px;
                }

                .suggestion-list li::before {
                    content: "•";
                    color: var(--primary);
                    font-weight: bold;
                    font-size: 18px;
                    line-height: 1.4;
                }

                .ordered-list {
                    counter-reset: item;
                    list-style-type: none;
                }

                .ordered-list li {
                    counter-increment: item;
                }

                .ordered-list li::before {
                    content: counter(item) ".";
                    color: var(--primary);
                    font-weight: bold;
                    margin-right: 8px;
                }

                .grading-section {
                    background: #e0f2fe;
                    border-left: 4px solid var(--primary);
                }

                .grading-text {
                    color: var(--text);
                    margin: 8px 0 0 0;
                    white-space: pre-line;
                    line-height: 1.6;
                }

                @media (max-width: 768px) {
                    .modal-header-custom h2 {
                        font-size: 20px;
                    }

                    .form-grid {
                        grid-template-columns: 1fr;
                    }

                    .suggestion-header {
                        flex-direction: column;
                    }

                    .suggestion-title {
                        width: 100%;
                    }

                    .form-actions {
                        flex-direction: column;
                    }

                    .form-actions button {
                        width: 100%;
                    }
                }
            </style>
        `;
        
        showModal(modalContent, '900px');
        showLoader(false);
        
        // Gestionnaire pour afficher le nom du fichier sélectionné
        const fileInput = document.getElementById('course-file-input');
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                const fileName = this.files[0].name;
                const placeholder = document.querySelector('.file-input-placeholder span');
                placeholder.textContent = `✓ ${fileName}`;
                placeholder.style.color = 'var(--success)';
            }
        });
        
        // Gestionnaire de soumission
        document.getElementById('ai-suggestions-form').addEventListener('submit', handleAIFormSubmit);
        
    } catch (error) {
        showAlert('Impossible de charger le formulaire. Veuillez réessayer.', 'error');
        showLoader(false);
    }
}

async function handleAIFormSubmit(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('course-file-input');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Veuillez sélectionner un fichier de cours', 'warning');
        return;
    }
    
    // Taille maximale autorisée : 600 MB
    const MAX_FILE_SIZE = 600 * 1024 * 1024; // bytes
    
    // Calcul de la taille réelle du fichier
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);
    
    // Affichage de la taille du fichier à l'utilisateur
    showAlert(`Taille du fichier sélectionné : ${fileSizeMB} MB`, 'info');
    
    // Vérification de la taille
    if (file.size > MAX_FILE_SIZE) {
        showAlert(
            `Le fichier est trop volumineux (${fileSizeMB} MB). 
            'La taille maximale autorisée est de 600 MB.`,
            'error'
        );
        return;
    }
    
    // Vérifier l'extension
    const validExtensions = ['.pdf', '.docx', '.doc', '.txt'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
        showAlert('Format de fichier non supporté. Veuillez utiliser un fichier PDF, DOCX ou TXT', 'error');
        return;
    }
    
    showLoader(true);
    
    try {
        // Créer FormData pour l'upload
        const formData = new FormData();
        formData.append('course_file', file);
        formData.append('difficulty', document.getElementById('ai-difficulty').value);
        formData.append('student_level', document.getElementById('ai-student-level').value);
        
        // Récupérer EC si sélectionné
        const ecId = document.getElementById('ai-ec-id').value;
        if (ecId) {
            formData.append('ec_id', ecId);
        }
        
        // Envoyer la requête
        const response = await fetch('/api/ai/generate-exam-suggestions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });
        
        if (!response.ok) {
            if (response.status === 413) {
                showAlert('Le fichier est trop volumineux pour être traité', 'error');
            } else if (response.status === 500) {
                showAlert('Une erreur est survenue lors de l\'analyse du fichier. Veuillez réessayer', 'error');
            } else {
                showAlert('Impossible de générer les suggestions. Veuillez vérifier votre fichier', 'error');
            }
            showLoader(false);
            return;
        }
        
        const data = await response.json();
        
        if (data.success && data.suggestions) {
            // Afficher le résumé du cours
            document.getElementById('course-summary-text').textContent = data.course_summary || 'Aucun résumé disponible';
            
            if (data.main_topics && data.main_topics.length > 0) {
                document.getElementById('main-topics-container').innerHTML = `
                    <div class="topics-label">
                        <i class="fas fa-tags"></i>
                        <span>Thèmes principaux :</span>
                    </div>
                    <div class="topics-tags">
                        ${data.main_topics.map(topic => 
                            `<span class="topic-tag"><i class="fas fa-bookmark"></i> ${topic}</span>`
                        ).join('')}
                    </div>
                `;
            }
            
            // Afficher les suggestions
            displayAISuggestions(data.suggestions);
            
            // Changer de step
            document.getElementById('upload-step').style.display = 'none';
            document.getElementById('results-step').style.display = 'block';
            
            showAlert(`${data.suggestions.length} suggestions générées avec succès`, 'success');
        } else {
            showAlert(data.error || 'Impossible de générer les suggestions. Le contenu du fichier est peut-être insuffisant', 'error');
        }
    } catch (error) {
        if (error.message.includes('Failed to fetch')) {
            showAlert('Problème de connexion au serveur. Vérifiez votre connexion internet et réessayez.', 'error');
        } else {
            showAlert('Impossible de générer les suggestions. Le fichier est peut-être illisible ou le service IA est temporairement indisponible.', 'error');
        }
    } finally {
        showLoader(false);
    }
}

function displayAISuggestions(suggestions) {
    const container = document.getElementById('suggestions-list-container');
    
    if (!suggestions || suggestions.length === 0) {
        container.innerHTML = `
            <div class="alert alert-warning">
                <i class="fas fa-exclamation-triangle"></i>
                <div>Aucune suggestion n'a pu être générée à partir de ce fichier</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = suggestions.map((suggestion, index) => `
        <div class="suggestion-card">
            <div class="suggestion-header">
                <div class="suggestion-title">
                    <h4>
                        <i class="fas fa-file-alt"></i>
                        <span>${index + 1}. ${suggestion.title}</span>
                    </h4>
                    <div class="suggestion-badges">
                        <span class="badge-icon badge-type">
                            <i class="fas fa-book"></i> ${suggestion.exam_type}
                        </span>
                        <span class="badge-icon badge-difficulty">
                            <i class="fas fa-signal"></i> ${suggestion.difficulty}
                        </span>
                        <span class="badge-icon badge-duration">
                            <i class="fas fa-clock"></i> ${suggestion.duration} min
                        </span>
                    </div>
                </div>
                <button class="btn btn-success" onclick='selectAISuggestion(${JSON.stringify(suggestion).replace(/'/g, "&#39;")})'>
                    <i class="fas fa-check"></i> Utiliser ce Sujet
                </button>
            </div>
            
            <p class="suggestion-description">${suggestion.description}</p>
            
            <div class="suggestion-section">
                <div class="section-title">
                    <i class="fas fa-list-check"></i>
                    <span>Points Clés du Cours</span>
                </div>
                <ul class="suggestion-list">
                    ${suggestion.key_points.map(point => `<li>${point}</li>`).join('')}
                </ul>
            </div>
            
            ${suggestion.questions_examples ? `
                <div class="suggestion-section">
                    <div class="section-title">
                        <i class="fas fa-question-circle"></i>
                        <span>Exemples de Questions</span>
                    </div>
                    <ol class="suggestion-list ordered-list">
                        ${suggestion.questions_examples.map(q => `<li>${q}</li>`).join('')}
                    </ol>
                </div>
            ` : ''}
            
            <div class="suggestion-section grading-section">
                <div class="section-title">
                    <i class="fas fa-clipboard-check"></i>
                    <span>Critères d'Évaluation</span>
                </div>
                <p class="grading-text">${suggestion.grading_criteria}</p>
            </div>
        </div>
    `).join('');
}

async function selectAISuggestion(suggestion) {
    const ecId = document.getElementById('ai-ec-id') ? document.getElementById('ai-ec-id').value : '';

    // Étape 1: générer l'examen complet avec questions + barème
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/subjects/generate-full-exam', {
            method: 'POST',
            body: JSON.stringify({ suggestion })
        });

        if (!response.ok) {
            showAlert('Impossible de générer le sujet complet. Veuillez réessayer.', 'error');
            showLoader(false);
            return;
        }

        const data = await response.json();
        if (!data.success) {
            showAlert(data.error || 'Erreur lors de la génération du sujet.', 'error');
            showLoader(false);
            return;
        }

        showLoader(false);
        // Étape 2: afficher la prévisualisation dans le modal
        _showGeneratedExamPreview(data.title, data.content, data.rubric, ecId);

    } catch (error) {
        showLoader(false);
        showAlert('Erreur de connexion. Veuillez réessayer.', 'error');
    }
}

function _showGeneratedExamPreview(title, content, rubric, ecId) {
    const previewContent = `
        <div style="max-width:100%;">
            <div style="text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e2e8f0;">
                <h2 style="margin:0 0 6px;color:#0f172a;"><i class="fas fa-eye" style="color:#3b82f6;"></i> Aperçu du Sujet Généré</h2>
                <p style="margin:0;color:#64748b;font-size:14px;">L'IA a créé un sujet complet avec questions et barème de notation</p>
            </div>

            <!-- Sujet / Questions -->
            <div style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <i class="fas fa-file-lines" style="color:#3b82f6;"></i>
                    <strong style="color:#0f172a;">Sujet d'Examen &amp; Questions</strong>
                    <span style="margin-left:auto;background:#eff6ff;color:#3b82f6;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">
                        <i class="fas fa-robot"></i> Généré par IA
                    </span>
                </div>
                <div style="max-height:300px;overflow-y:auto;padding:14px;background:#f8fafc;border-radius:8px;font-family:monospace;font-size:13px;line-height:1.7;white-space:pre-wrap;border:1px solid #e2e8f0;">${content}</div>
            </div>

            <!-- Barème -->
            <div style="margin-bottom:20px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                    <i class="fas fa-clipboard-list" style="color:#10b981;"></i>
                    <strong style="color:#0f172a;">Barème de Notation</strong>
                    <span style="margin-left:auto;background:#f0fdf4;color:#15803d;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;">
                        <i class="fas fa-check"></i> Points attribués
                    </span>
                </div>
                <div style="max-height:280px;overflow-y:auto;padding:14px;background:#f0fdf4;border-radius:8px;font-family:monospace;font-size:13px;line-height:1.8;white-space:pre-wrap;border:1px solid #bbf7d0;">${rubric}</div>
            </div>

            <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:20px;font-size:13px;color:#92400e;">
                <i class="fas fa-info-circle"></i>
                <strong> Information :</strong> Ce sujet et son barème seront sauvegardés. Les étudiants verront les questions avec leurs points lors de l'examen en ligne.
            </div>

            <div style="display:flex;gap:12px;justify-content:flex-end;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="closeModal(); showCreateCourseWithAISuggestionsModal();">
                    <i class="fas fa-arrow-left"></i> Retour aux suggestions
                </button>
                <button class="btn btn-primary" id="btn-confirm-save-subject" onclick="_confirmSaveGeneratedSubject(${JSON.stringify(title).replace(/"/g, '&quot;')}, ${JSON.stringify(content).replace(/"/g, '&quot;')}, ${JSON.stringify(rubric).replace(/"/g, '&quot;')}, ${JSON.stringify(ecId || '').replace(/"/g, '&quot;')})">
                    <i class="fas fa-save"></i> Enregistrer ce Sujet
                </button>
            </div>
        </div>
    `;
    showModal(previewContent, '850px');
}

async function _confirmSaveGeneratedSubject(title, content, rubric, ecId) {
    const btn = document.getElementById('btn-confirm-save-subject');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...'; }

    try {
        const response = await authenticatedFetch('/api/subjects/create-from-suggestion', {
            method: 'POST',
            body: JSON.stringify({
                title: title,
                ec_id: ecId || null,
                content: content,
                rubric_override: rubric,
                metadata: { generated_by_ai: true }
            })
        });

        const data = await response.json();
        if (data.success) {
            closeModal();
            showSubjectCreatedPreview(data.subject);
        } else {
            showAlert(data.error || 'Impossible de sauvegarder le sujet.', 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Enregistrer ce Sujet'; }
        }
    } catch (error) {
        showAlert('Erreur de connexion. Veuillez réessayer.', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Enregistrer ce Sujet'; }
    }
}

// ============================================================================
// SURVEILLANT — Dashboard et gestion examens
// ============================================================================

async function loadSurveillantDashboard() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/surveillant/exams');
        const data = await response.json();
        const exams = data.exams || [];

        const activeExams   = exams.filter(e => e.status === 'active');
        const totalStudents = exams.reduce((s, e) => s + (e.my_student_count || 0), 0);

        const statusBadge = s => {
            const cfg = {
                in_progress:   ['En cours',    '#6366f1', '#ede9fe'],
                submitted:     ['Soumis',       '#10b981', '#dcfce7'],
                auto_submitted:['Auto-soumis',  '#8b5cf6', '#f3e8ff'],
                banned:        ['Exclu',         '#ef4444', '#fef2f2'],
                not_started:   ['Absent/Attente','#94a3b8', '#f1f5f9'],
            };
            const [label, col, bg] = cfg[s] || ['—', '#94a3b8', '#f1f5f9'];
            return `<span style="background:${bg};color:${col};font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;">${label}</span>`;
        };

        // Student list per exam (for dashboard overview)
        const studentListHtml = exams.map(exam => {
            if (!exam.my_students || exam.my_students.length === 0) return '';
            const rows = exam.my_students.map(s => {
                const riskColor = s.risk_score >= 70 ? '#ef4444' : s.risk_score >= 40 ? '#f59e0b' : '#10b981';
                return `<tr>
                    <td style="padding:7px 12px;font-size:13px;font-weight:500;color:#0f172a;">
                        <i class="fas fa-user-circle" style="color:#94a3b8;margin-right:6px;"></i>${escHtml(s.student_name)}
                    </td>
                    <td style="padding:7px 12px;">${statusBadge(s.status)}</td>
                    <td style="padding:7px 12px;font-size:12px;font-weight:600;color:${riskColor};">
                        ${exam.status === 'active' ? s.risk_score + '%' : '—'}
                    </td>
                </tr>`;
            }).join('');
            const sc = {active:'#10b981',scheduled:'#3b82f6',closed:'#94a3b8',draft:'#f59e0b'}[exam.status]||'#94a3b8';
            return `<div style="background:white;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:14px;">
                <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="width:8px;height:8px;background:${sc};border-radius:50%;flex-shrink:0;"></span>
                        <span style="font-size:14px;font-weight:700;color:#0f172a;">${escHtml(exam.title)}</span>
                        <span style="font-size:12px;color:#64748b;">${exam.my_students.length} étudiant(s)</span>
                    </div>
                    ${exam.status === 'active' ? `<button onclick="openSurveillantDashboard(${exam.id})"
                        style="display:inline-flex;align-items:center;gap:5px;padding:6px 14px;background:#7c3aed;color:white;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-shield-alt"></i> Surveiller
                    </button>` : ''}
                </div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="background:#f8fafc;">
                        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Étudiant</th>
                        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Statut</th>
                        <th style="padding:6px 12px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;">Risque</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }).join('') || '';

        document.getElementById('main-content').innerHTML = `
            <div style="margin-bottom:24px;">
                <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px;display:flex;align-items:center;gap:12px;">
                    <span style="background:#f59e0b;width:40px;height:40px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-tachometer-alt" style="color:white;font-size:16px;"></i>
                    </span>
                    Tableau de Bord Surveillant
                </h2>
                <p style="color:#64748b;margin:0 0 0 52px;font-size:13px;">Bienvenue, ${escHtml(currentUser.full_name)}</p>
            </div>

            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px;">
                <div style="background:white;border-radius:12px;padding:18px;border:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;">
                    <div style="background:rgba(16,185,129,.12);width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-play-circle" style="color:#10b981;font-size:16px;"></i>
                    </div>
                    <div><div style="font-size:26px;font-weight:800;color:#0f172a;">${activeExams.length}</div>
                    <div style="font-size:11px;color:#64748b;">En cours</div></div>
                </div>
                <div style="background:white;border-radius:12px;padding:18px;border:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;">
                    <div style="background:rgba(59,130,246,.12);width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-laptop-code" style="color:#3b82f6;font-size:16px;"></i>
                    </div>
                    <div><div style="font-size:26px;font-weight:800;color:#0f172a;">${exams.length}</div>
                    <div style="font-size:11px;color:#64748b;">Examens assignés</div></div>
                </div>
                <div style="background:white;border-radius:12px;padding:18px;border:1px solid #e2e8f0;display:flex;align-items:center;gap:12px;">
                    <div style="background:rgba(124,58,237,.12);width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <i class="fas fa-user-graduate" style="color:#7c3aed;font-size:16px;"></i>
                    </div>
                    <div><div style="font-size:26px;font-weight:800;color:#0f172a;">${totalStudents}</div>
                    <div style="font-size:11px;color:#64748b;">Étudiants à surveiller</div></div>
                </div>
            </div>

            ${activeExams.length > 0 ? `
            <div style="background:white;border:1px solid #a7f3d0;border-left:4px solid #10b981;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
                <h3 style="margin:0 0 10px;font-size:14px;color:#065f46;font-weight:700;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-play-circle"></i> Examens en cours — Action requise
                </h3>
                ${activeExams.map(e => `
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:10px 0;${activeExams.indexOf(e)<activeExams.length-1?'border-bottom:1px solid #f0fdf4;':''}">
                    <div>
                        <div style="font-weight:600;color:#0f172a;font-size:14px;">${escHtml(e.title)}</div>
                        <div style="font-size:12px;color:#64748b;margin-top:2px;">
                            <i class="fas fa-user-graduate"></i> ${e.my_student_count || 0} étudiant(s) dans votre groupe
                        </div>
                    </div>
                    <button onclick="openSurveillantDashboard(${e.id})"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-shield-alt"></i> Surveiller maintenant
                    </button>
                </div>`).join('')}
            </div>` : ''}

            <h3 style="font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin:0 0 12px;display:flex;align-items:center;gap:8px;">
                <i class="fas fa-users" style="color:#7c3aed;"></i> Mes étudiants par examen
            </h3>
            ${studentListHtml || `<div style="text-align:center;padding:40px 24px;background:white;border-radius:12px;border:1px solid #e2e8f0;">
                <i class="fas fa-eye" style="font-size:40px;color:#cbd5e1;display:block;margin-bottom:12px;"></i>
                <h3 style="color:#475569;font-size:16px;font-weight:600;margin:0 0 6px;">Aucun examen assigné</h3>
                <p style="color:#94a3b8;font-size:13px;margin:0;">L'enseignant vous assignera des examens à surveiller.</p>
            </div>`}
        `;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

// ─── Onglet "Mes Examens" — vue différente axée planning ─────────────────────

async function loadSurveillantExams() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const response = await authenticatedFetch('/api/surveillant/exams');
        const data = await response.json();
        const exams = data.exams || [];

        const statusCfg = {
            active:    { label: 'En cours',  col: '#059669', bg: '#ecfdf5' },
            scheduled: { label: 'Planifié',  col: '#d97706', bg: '#fffbeb' },
            closed:    { label: 'Terminé',   col: '#dc2626', bg: '#fff1f2' },
            draft:     { label: 'Brouillon', col: '#64748b', bg: '#f1f5f9' },
        };

        const examCards = exams.map(e => {
            const sc    = statusCfg[e.status] || statusCfg.draft;
            const dt    = e.start_time ? new Date(e.start_time).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
            const dur   = e.duration_minutes ? e.duration_minutes + ' min' : '—';
            const total = e.my_students ? e.my_students.length : 0;
            const inProgress  = (e.my_students||[]).filter(s => s.status === 'in_progress').length;
            const submitted   = (e.my_students||[]).filter(s => ['submitted','auto_submitted'].includes(s.status)).length;
            const notStarted  = (e.my_students||[]).filter(s => s.status === 'not_started').length;
            const banned      = (e.my_students||[]).filter(s => s.status === 'banned').length;

            const studentRows = (e.my_students || []).map((s, idx) => {
                const stCfg = {
                    in_progress:   ['En cours',     '#6366f1','#ede9fe'],
                    submitted:     ['Soumis',        '#10b981','#dcfce7'],
                    auto_submitted:['Auto-soumis',   '#8b5cf6','#f3e8ff'],
                    banned:        ['Exclu',          '#ef4444','#fef2f2'],
                    not_started:   ['Pas commencé',  '#94a3b8','#f1f5f9'],
                };
                const [sl, sc2, sbg] = stCfg[s.status] || ['—','#94a3b8','#f1f5f9'];
                const riskColor = s.risk_score >= 70 ? '#ef4444' : s.risk_score >= 40 ? '#f59e0b' : '#10b981';
                return `<tr style="${idx % 2 === 0 ? 'background:#fafafa;' : ''}">
                    <td style="padding:8px 14px;font-size:13px;color:#0f172a;">${idx + 1}. ${escHtml(s.student_name)}</td>
                    <td style="padding:8px 14px;">
                        <span style="background:${sbg};color:${sc2};font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;">${sl}</span>
                    </td>
                    <td style="padding:8px 14px;font-size:12px;font-weight:700;color:${riskColor};">
                        ${e.status === 'active' || e.status === 'closed' ? s.risk_score + '%' : '—'}
                    </td>
                </tr>`;
            }).join('');

            return `<div style="background:white;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;margin-bottom:16px;">
                <!-- Card header -->
                <div style="padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                    <div>
                        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                            <span style="background:${sc.bg};color:${sc.col};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;">${sc.label}</span>
                            <span style="font-size:15px;font-weight:700;color:#0f172a;">${escHtml(e.title)}</span>
                        </div>
                        <div style="font-size:12px;color:#64748b;display:flex;gap:16px;flex-wrap:wrap;">
                            <span><i class="fas fa-calendar" style="color:#94a3b8;margin-right:4px;"></i>${dt}</span>
                            <span><i class="fas fa-clock" style="color:#94a3b8;margin-right:4px;"></i>${dur}</span>
                            <span><i class="fas fa-users" style="color:#94a3b8;margin-right:4px;"></i>${total} étudiant(s)</span>
                        </div>
                    </div>
                    ${e.status === 'active' ? `<button onclick="openSurveillantDashboard(${e.id})"
                        style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:#7c3aed;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0;">
                        <i class="fas fa-shield-alt"></i> Surveiller
                    </button>` : ''}
                </div>
                <!-- Progress mini-stats -->
                <div style="padding:10px 20px;background:#f8fafc;border-bottom:1px solid #f1f5f9;display:flex;gap:18px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#6366f1;font-weight:600;"><b>${inProgress}</b> en cours</span>
                    <span style="font-size:12px;color:#10b981;font-weight:600;"><b>${submitted}</b> soumis</span>
                    <span style="font-size:12px;color:#94a3b8;font-weight:600;"><b>${notStarted}</b> pas commencé</span>
                    ${banned ? `<span style="font-size:12px;color:#ef4444;font-weight:600;"><b>${banned}</b> exclu(s)</span>` : ''}
                </div>
                <!-- Student list -->
                ${total > 0 ? `<table style="width:100%;border-collapse:collapse;">
                    <thead><tr style="background:#f8fafc;">
                        <th style="padding:7px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Étudiant</th>
                        <th style="padding:7px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Statut</th>
                        <th style="padding:7px 14px;text-align:left;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Risque</th>
                    </tr></thead>
                    <tbody>${studentRows}</tbody>
                </table>` : '<p style="padding:16px 20px;color:#94a3b8;font-size:13px;">Aucun étudiant assigné.</p>'}
            </div>`;
        }).join('') || `<div style="text-align:center;padding:48px 24px;background:white;border-radius:14px;border:1px solid #e2e8f0;">
            <i class="fas fa-clipboard-list" style="font-size:40px;color:#cbd5e1;display:block;margin-bottom:12px;"></i>
            <h3 style="color:#475569;font-size:16px;margin:0 0 6px;">Aucun examen</h3>
            <p style="color:#94a3b8;font-size:13px;margin:0;">Vos examens assignés apparaîtront ici.</p>
        </div>`;

        document.getElementById('main-content').innerHTML = `
            <div style="margin-bottom:20px;display:flex;align-items:center;gap:12px;">
                <span style="background:#3b82f6;width:40px;height:40px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-clipboard-list" style="color:white;font-size:16px;"></i>
                </span>
                <div>
                    <h2 style="font-size:19px;font-weight:700;color:#0f172a;margin:0;">Mes Examens</h2>
                    <p style="color:#64748b;margin:0;font-size:13px;">${exams.length} examen(s) assigné(s) — liste complète avec étudiants</p>
                </div>
            </div>
            ${examCards}`;
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

function openSurveillantDashboard(examId) {
    window.open(`/proctor/monitor/${examId}`, `proctor-${examId}`,
        'width=1400,height=900,menubar=no,toolbar=no,location=no,status=no');
}

// ============================================================================
// ENSEIGNANT — Gestion du pool de surveillants par examen
// ============================================================================

async function showManageProctorsModal(examId) {
    showLoader(true);
    try {
        const [proctorsResp, usersResp] = await Promise.all([
            authenticatedFetch(`/api/online_exams/${examId}/proctors`),
            authenticatedFetch('/api/users/proctors')
        ]);
        const proctorsData = await proctorsResp.json();
        const allUsers = usersResp.ok ? await usersResp.json() : [];

        const assignedIds = (proctorsData.proctors || []).map(p => p.proctor_id);
        const available = allUsers.filter(u => !assignedIds.includes(u.id));

        const renderProctorRow = (p) => `
            <tr id="proctor-row-${p.proctor_id}">
                <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;">
                    <div style="font-weight:600;font-size:13px;color:#0f172a;">${p.proctor_name}</div>
                    <div style="font-size:11px;color:#64748b;">${p.proctor_email || ''}</div>
                </td>
                <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;text-align:center;">${p.student_count || 0}</td>
                <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;">
                    <button onclick="removeProctor(${examId}, ${p.proctor_id})"
                        style="display:inline-flex;align-items:center;gap:4px;padding:5px 10px;background:#fff1f2;color:#ef4444;border:1px solid #fecaca;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">
                        <i class="fas fa-times"></i> Retirer
                    </button>
                </td>
            </tr>`;

        // Charger le statut agent pour cet examen
        let agentStatusHtml = '';
        try {
            const agentResp = await authenticatedFetch(`/api/agent/status?exam_id=${examId}`);
            if (agentResp.ok) {
                const ag = await agentResp.json();
                const dotColor  = ag.alive ? '#10b981' : '#ef4444';
                const badgeTxt  = ag.alive ? 'EN SERVICE' : 'HORS LIGNE';
                const badgeBg   = ag.alive ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)';
                const badgeClr  = ag.alive ? '#059669' : '#dc2626';
                const borderClr = ag.alive ? '#a7f3d0' : '#fecaca';
                const bgColor   = ag.alive ? '#f0fdf4' : '#fef2f2';
                const ex        = ag.exam || {};
                const lastCheck = ag.last_check_ago_sec != null
                    ? (ag.last_check_ago_sec < 60 ? `il y a ${ag.last_check_ago_sec}s` : `il y a ${Math.floor(ag.last_check_ago_sec/60)}min`)
                    : '—';
                agentStatusHtml = `
                <div style="background:${bgColor};border:1px solid ${borderClr};border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="width:10px;height:10px;background:${dotColor};border-radius:50%;display:inline-block;flex-shrink:0;${ag.alive?'animation:pulse 2s infinite':''}"></span>
                            <span style="font-weight:700;font-size:14px;color:#0f172a;">🤖 Agent IA Autonome</span>
                            <span style="background:${badgeBg};color:${badgeClr};font-size:11px;font-weight:700;padding:2px 9px;border-radius:10px;">${badgeTxt}</span>
                        </div>
                        <span style="font-size:11px;color:#64748b;">Dernier cycle : ${lastCheck}</span>
                    </div>
                    <p style="margin:8px 0 0;font-size:12px;color:#475569;line-height:1.5;">
                        ${ag.alive
                            ? `L'agent surveille <strong>tous les ${ex.students || proctorsData.total_students || '?'} étudiant(s)</strong> automatiquement.
                               Seuil d'alerte : risque <strong>≥ ${ag.risk_alert || 60}/100</strong> · Urgence : <strong>≥ ${ag.risk_urgent || 80}/100</strong>.
                               Alertes envoyées cette session : <strong>${ex.alerts_sent ?? 0}</strong>.`
                            : `Le service <code>cei-agent-proctor</code> n'est pas actif. Relancez-le via : <code>pm2 restart cei-agent-proctor</code>`
                        }
                    </p>
                    <p style="margin:6px 0 0;font-size:11px;color:#94a3b8;">
                        <i class="fas fa-info-circle"></i>
                        L'agent est <strong>attribué automatiquement</strong> à tous les examens actifs — aucune action requise.
                        Il analyse les comportements et envoie des emails aux surveillants + enseignant en cas d'anomalie.
                    </p>
                </div>`;
            }
        } catch(e) {}

        const content = `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
                <div style="width:40px;height:40px;background:#fef3c7;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <i class="fas fa-shield-alt" style="color:#f59e0b;font-size:16px;"></i>
                </div>
                <div>
                    <h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a;">Gestion de la Surveillance</h2>
                    <p style="margin:0;font-size:12px;color:#64748b;">${proctorsData.total_students || 0} étudiant(s) · ${proctorsData.unassigned_students || 0} non affecté(s)</p>
                </div>
            </div>
            ${agentStatusHtml}

            <!-- Ajouter un surveillant -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:16px;">
                <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                    <div style="flex:1;min-width:200px;">
                        <label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:6px;">Sélectionner un surveillant</label>
                        <select id="add-proctor-select" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;background:white;">
                            <option value="">-- Sélectionner --</option>
                            ${available.map(u => `<option value="${u.id}">${u.full_name}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="addProctor(${examId})"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:#f59e0b;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
                        <i class="fas fa-plus"></i> Ajouter
                    </button>
                </div>
            </div>

            <!-- Liste des surveillants affectés -->
            <div id="proctors-table-wrap" style="margin-bottom:16px;">
            ${(proctorsData.proctors || []).length === 0 ? `
                <div style="text-align:center;padding:32px;color:#94a3b8;font-size:13px;">
                    <i class="fas fa-eye-slash" style="display:block;font-size:28px;margin-bottom:8px;"></i>
                    Aucun surveillant assigné à cet examen
                </div>` : `
                <table style="width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;">
                    <thead><tr style="background:#f8fafc;">
                        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Surveillant</th>
                        <th style="padding:10px 14px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Étudiants</th>
                        <th style="padding:10px 14px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Action</th>
                    </tr></thead>
                    <tbody id="proctors-tbody">
                        ${(proctorsData.proctors || []).map(renderProctorRow).join('')}
                    </tbody>
                </table>`}
            </div>

            <!-- Répartition automatique -->
            ${(proctorsData.proctors || []).length > 0 ? `
            <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:14px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
                    <div>
                        <div style="font-size:13px;font-weight:600;color:#065f46;margin-bottom:2px;"><i class="fas fa-random"></i> Répartition automatique</div>
                        <div style="font-size:12px;color:#047857;">Distribue les étudiants équitablement entre les ${(proctorsData.proctors || []).length} surveillant(s) (ordre alphabétique)</div>
                    </div>
                    <button onclick="distributeProctors(${examId})"
                        style="display:inline-flex;align-items:center;gap:6px;padding:9px 16px;background:#059669;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;">
                        <i class="fas fa-random"></i> Répartir maintenant
                    </button>
                </div>
            </div>` : ''}
        `;
        showModal(content, '620px');
    } catch (error) {
        showAlert(humanError(error), 'error');
    } finally {
        showLoader(false);
    }
}

async function addProctor(examId) {
    const sel = document.getElementById('add-proctor-select');
    const proctorId = sel ? parseInt(sel.value) : null;
    if (!proctorId) { showAlert('Veuillez sélectionner un surveillant.', 'error'); return; }

    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/proctors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proctor_id: proctorId })
        });
        const d = await r.json();
        if (d.success) {
            showAlert('Surveillant ajouté avec succès.', 'success');
            closeModal();
            showManageProctorsModal(examId);
        } else {
            showAlert(d.error || 'Erreur lors de l\'ajout.', 'error');
        }
    } catch (e) {
        showAlert('Erreur de connexion.', 'error');
    }
}

async function removeProctor(examId, proctorId) {
    if (!confirm('Retirer ce surveillant ? Ses affectations d\'étudiants seront supprimées.')) return;
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/proctors/${proctorId}`, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) {
            showAlert('Surveillant retiré.', 'success');
            closeModal();
            showManageProctorsModal(examId);
        } else {
            showAlert(d.error || 'Erreur.', 'error');
        }
    } catch (e) {
        showAlert('Erreur de connexion.', 'error');
    }
}

async function distributeProctors(examId) {
    if (!confirm('Répartir les étudiants entre les surveillants ? Les affectations existantes seront remplacées.')) return;
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/distribute_proctors`, { method: 'POST' });
        const d = await r.json();
        if (d.success) {
            const summary = (d.distribution || []).map(p => `• ${p.proctor_name} : ${p.student_count} étudiant(s)`).join('\n');
            const modeNote = d.mode === 'pre_assignment' ? '\n\n⏳ Pré-affectation enregistrée. Les groupes seront confirmés au démarrage de l\'examen.' : '';
            showAlert(`✅ ${d.message}\n\n${summary}${modeNote}`, 'success');
            closeModal();
            showManageProctorsModal(examId);
        } else {
            let msg = d.error || 'Erreur lors de la répartition.';
            if (msg.includes('Aucun surveillant')) msg = 'Ajoutez d\'abord au moins un surveillant à cet examen avant de lancer la répartition.';
            if (msg.includes('Aucun étudiant')) msg = 'Aucun étudiant n\'a encore composé cet examen. La répartition se fait une fois l\'examen actif.';
            showAlert(msg, 'error');
        }
    } catch (e) {
        showAlert('Erreur de connexion.', 'error');
    }
}
// ============================================================================
// PROFIL UTILISATEUR — modale accessible depuis le header pour tous les rôles
// ============================================================================

function showProfileModal(initialTab) {
    initialTab = initialTab || 'info';
    const roleLabels = { admin: 'Administrateur', professor: 'Enseignant', student: 'Étudiant', surveillant: 'Surveillant' };
    const role     = currentUser.role;
    const color    = getRoleColor(role);
    const initials = buildInitials(currentUser.full_name);
    const since    = currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString('fr-FR') : '—';

    document.getElementById('modal-body').innerHTML = `
        <div style="padding:4px 0;">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
                <div style="width:64px;height:64px;border-radius:50%;background:${color};color:white;font-size:22px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${initials}</div>
                <div>
                    <div style="font-size:17px;font-weight:700;color:#0f172a;" id="prof-display-name">${currentUser.full_name}</div>
                    <span style="display:inline-block;background:${color}20;color:${color};padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;margin-top:4px;">${roleLabels[role] || role}</span>
                    <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Membre depuis ${since}</div>
                </div>
            </div>

            <div style="display:flex;border-bottom:2px solid #e2e8f0;margin-bottom:20px;gap:0;">
                <button id="tab-info-btn" onclick="switchProfileTab('info')"
                    style="padding:10px 20px;border:none;background:none;border-bottom:2px solid ${color};margin-bottom:-2px;color:${color};font-weight:700;font-size:13px;cursor:pointer;">
                    <i class="fas fa-user-edit"></i> Mes informations
                </button>
                <button id="tab-pw-btn" onclick="switchProfileTab('pw')"
                    style="padding:10px 20px;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-2px;color:#64748b;font-weight:600;font-size:13px;cursor:pointer;">
                    <i class="fas fa-lock"></i> Mot de passe
                </button>
            </div>

            <div id="tab-info">
                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Nom complet</label>
                    <input id="prof-fullname" type="text" value="${currentUser.full_name}"
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;"
                        onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom:20px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Adresse email</label>
                    <input id="prof-email" type="email" value="${currentUser.email}"
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;"
                        onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom:20px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Rôle</label>
                    <input type="text" value="${roleLabels[role] || role}" disabled
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;background:#f8fafc;color:#94a3b8;box-sizing:border-box;">
                </div>
                <button onclick="saveProfileInfo()" style="width:100%;padding:11px;background:${color};color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
                    <i class="fas fa-save"></i> Enregistrer les modifications
                </button>
            </div>

            <div id="tab-pw" style="display:none;">
                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Mot de passe actuel</label>
                    <input id="prof-pw-current" type="password" placeholder="••••••••"
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;"
                        onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom:14px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Nouveau mot de passe</label>
                    <input id="prof-pw-new" type="password" placeholder="Minimum 6 caractères"
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;"
                        onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="margin-bottom:20px;">
                    <label style="display:block;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Confirmer le nouveau mot de passe</label>
                    <input id="prof-pw-confirm" type="password" placeholder="••••••••"
                        style="width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;"
                        onfocus="this.style.borderColor='${color}'" onblur="this.style.borderColor='#e2e8f0'">
                </div>
                <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:16px;">
                    <i class="fas fa-info-circle"></i> Vous resterez connecté après le changement de mot de passe.
                </div>
                <button onclick="saveProfilePassword()" style="width:100%;padding:11px;background:${color};color:white;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">
                    <i class="fas fa-key"></i> Changer le mot de passe
                </button>
            </div>
        </div>
    `;
    document.getElementById('modal').style.display = 'flex';
    if (initialTab === 'pw') switchProfileTab('pw');
}

function switchProfileTab(tab) {
    const color = getRoleColor(currentUser.role);
    document.getElementById('tab-info').style.display = tab === 'info' ? 'block' : 'none';
    document.getElementById('tab-pw').style.display   = tab === 'pw'   ? 'block' : 'none';
    const ib = document.getElementById('tab-info-btn'), pb = document.getElementById('tab-pw-btn');
    ib.style.borderBottomColor = tab === 'info' ? color : 'transparent';
    ib.style.color             = tab === 'info' ? color : '#64748b';
    pb.style.borderBottomColor = tab === 'pw'   ? color : 'transparent';
    pb.style.color             = tab === 'pw'   ? color : '#64748b';
}

async function saveProfileInfo() {
    const full_name = document.getElementById('prof-fullname').value.trim();
    const email     = document.getElementById('prof-email').value.trim();
    if (!full_name) { showAlert('Le nom complet est requis.', 'error'); return; }
    if (!email)     { showAlert("L'adresse email est requise.", 'error'); return; }
    try {
        const r = await authenticatedFetch('/api/profile', { method: 'PUT', body: JSON.stringify({ full_name, email }) });
        const d = await r.json();
        if (d.success) {
            currentUser.full_name = d.user.full_name;
            currentUser.email     = d.user.email;
            document.getElementById('prof-display-name').textContent  = d.user.full_name;
            refreshNavbarAvatar();
            showAlert('Profil mis à jour avec succès.', 'success');
        } else {
            showAlert(d.error || 'Erreur lors de la mise à jour.', 'error');
        }
    } catch (e) { showAlert('Erreur de connexion.', 'error'); }
}

// ============================================================================
// EXPORT CSV DES NOTES
// ============================================================================

async function exportExamCSV(examId, examTitle) {
    try {
        const resp = await fetch(`/api/online_exams/${examId}/export-csv`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!resp.ok) { showAlert('Erreur lors de l\'export CSV.', 'error'); return; }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `notes_${(examTitle||examId).replace(/\s+/g,'_')}.csv`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
    } catch(e) { showAlert('Erreur export CSV : ' + (e.serverMessage || e.message), 'error'); }
}

// ============================================================================
// STATISTIQUES PAR EXAMEN
// ============================================================================

async function showExamStats(examId) {
    showLoader(true);
    try {
        const resp = await authenticatedFetch(`/api/online_exams/${examId}/stats`);
        const s    = await resp.json();
        const bar  = (pct, color) => `<div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;margin-top:3px;">
            <div style="width:${Math.min(pct,100)}%;height:100%;background:${color};border-radius:4px;"></div></div>`;
        const distLabels  = ['0–4', '5–9', '10–13', '14–16', '17–20'];
        const distColors  = ['#ef4444','#f97316','#10b981','#3b82f6','#6366f1'];
        const maxDist     = Math.max(...(s.distribution||[0]));
        const distRows    = (s.distribution||[]).map((n,i) => `
            <tr>
                <td style="padding:5px 8px;font-size:12px;color:#475569;width:50px;">${distLabels[i]}</td>
                <td style="padding:5px 8px;">
                    ${bar(maxDist ? n/maxDist*100 : 0, distColors[i])}
                </td>
                <td style="padding:5px 8px;font-size:12px;font-weight:700;color:#1e293b;width:30px;">${n}</td>
            </tr>`).join('');
        const kpi = (label, val, color='#1e293b') =>
            `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;flex:1;min-width:110px;">
                <div style="font-size:18px;font-weight:700;color:${color};">${val ?? '—'}</div>
                <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">${label}</div>
             </div>`;
        showModal(`
            <div style="max-width:640px;">
                <h2 style="margin:0 0 4px;font-size:17px;"><i class="fas fa-chart-bar" style="color:#6366f1;margin-right:8px;"></i>Statistiques</h2>
                <p style="color:#64748b;margin:0 0 16px;font-size:13px;">${s.exam_title||''}</p>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
                    ${kpi('Total inscrits', s.total)}
                    ${kpi('Soumis', s.submitted, '#6366f1')}
                    ${kpi('Corrigés', s.corrected, '#0ea5e9')}
                    ${kpi('Bannis', s.banned, '#ef4444')}
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
                    ${kpi('Moyenne', s.avg_score!=null ? s.avg_score+'/20' : '—', s.avg_score>=10?'#10b981':'#ef4444')}
                    ${kpi('Médiane', s.median_score!=null ? s.median_score+'/20' : '—')}
                    ${kpi('Min', s.min_score!=null ? s.min_score+'/20' : '—', '#ef4444')}
                    ${kpi('Max', s.max_score!=null ? s.max_score+'/20' : '—', '#10b981')}
                    ${kpi('Taux réussite', s.pass_rate!=null ? s.pass_rate+'%' : '—', s.pass_rate>=50?'#10b981':'#ef4444')}
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
                    ${kpi('Durée moy.', s.avg_duration_min ? s.avg_duration_min+' min' : '—')}
                    ${kpi('Risque moy.', s.avg_risk+'%', s.avg_risk>=40?'#f59e0b':'#10b981')}
                    ${kpi('Haut risque', s.high_risk_count, s.high_risk_count>0?'#ef4444':'#10b981')}
                    ${kpi('Sig. pré', s.pre_sig_rate+'%', '#6366f1')}
                </div>
                <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">Distribution des notes</div>
                <table style="width:100%;">${distRows}</table>
                <div style="margin-top:20px;text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fermer</button>
                    <button class="btn btn-primary btn-sm" onclick="closeModal();exportExamCSV(${examId},'${(s.exam_title||'').replace(/'/g,'')}')" style="margin-left:8px;">
                        <i class="fas fa-file-csv"></i> Export CSV
                    </button>
                </div>
            </div>`, '680px');
    } catch(e) {
        showAlert('Erreur statistiques : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}

// ============================================================================
// CORRECTION MANUELLE
// ============================================================================

async function showManualGradingModal(attemptId, studentName, currentScore) {
    const scoreVal = currentScore !== null && currentScore !== undefined ? currentScore : '';
    showModal(`
        <div style="max-width:460px;">
            <h2 style="margin:0 0 4px;font-size:16px;"><i class="fas fa-pen" style="color:#6366f1;margin-right:8px;"></i>Correction manuelle</h2>
            <p style="color:#64748b;font-size:13px;margin:0 0 18px;">${studentName||'Étudiant'}</p>
            <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Note /20 <span style="color:#ef4444;">*</span></label>
            <input id="manual-score" type="number" min="0" max="20" step="0.25" value="${scoreVal}"
                style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;margin-bottom:14px;outline:none;box-sizing:border-box;"
                placeholder="Ex : 14.5">
            <label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Commentaire / feedback</label>
            <textarea id="manual-feedback" rows="4"
                style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;outline:none;"
                placeholder="Points forts, points faibles, conseils…"></textarea>
            <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">
                <button class="btn btn-secondary btn-sm" onclick="closeModal()">Annuler</button>
                <button class="btn btn-success btn-sm" onclick="submitManualGrade(${attemptId})">
                    <i class="fas fa-save"></i> Enregistrer la note
                </button>
            </div>
        </div>`, '500px');
    setTimeout(() => document.getElementById('manual-score')?.focus(), 100);
}

async function submitManualGrade(attemptId) {
    const scoreEl    = document.getElementById('manual-score');
    const feedbackEl = document.getElementById('manual-feedback');
    const score      = parseFloat(scoreEl?.value);
    if (isNaN(score) || score < 0 || score > 20) {
        showAlert('Veuillez saisir une note valide entre 0 et 20.', 'error'); return;
    }
    try {
        await authenticatedFetch(`/api/exam_attempts/${attemptId}/manual-grade`, {
            method: 'PUT',
            body: JSON.stringify({ score, feedback: feedbackEl?.value || '' })
        });
        closeModal();
        showAlert(`Note ${score}/20 enregistrée avec succès.`, 'success');
        // Rafraîchir la liste
        const examId = window._currentViewedExamId;
        if (examId) setTimeout(() => viewExamSubmissions(examId), 600);
    } catch(e) { showAlert(e.serverMessage || e.message || 'Erreur lors de l\'enregistrement.', 'error'); }
}

// ============================================================================
// HISTORIQUE EXAMENS ÉTUDIANT
// ============================================================================

async function showStudentExamHistory() {
    showLoader(true);
    try {
        const resp = await authenticatedFetch('/api/student/exam-history');
        const d    = await resp.json();
        const history = d.history || [];
        const statusBadge = (s, corrected_at) => {
            // Si l'examen a été corrigé (score défini), on le signale peu importe le statut
            if (corrected_at) return `<span style="color:#10b981;background:#d1fae5;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">Corrigé</span>`;
            const map = {
                in_progress:   ['#f59e0b', '#fef3c7', 'En cours'],
                submitted:     ['#6366f1', '#ede9fe', 'Soumis'],
                auto_submitted:['#8b5cf6', '#ede9fe', 'Auto-soumis'],
                banned:        ['#ef4444', '#fee2e2', 'Exclu'],
            };
            const [tc, bg, label] = map[s] || ['#64748b','#f1f5f9', s];
            return `<span style="color:${tc};background:${bg};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">${label}</span>`;
        };
        const rows = history.length === 0
            ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">Aucun examen passé</td></tr>'
            : history.map(h => {
                const score = h.score !== null && h.score !== undefined
                    ? `<strong style="color:${h.score>=10?'#10b981':'#ef4444'};font-size:14px;">${h.score}/20</strong>`
                    : '<span style="color:#94a3b8;font-size:11px;">—</span>';
                const date = h.started_at ? new Date(h.started_at).toLocaleDateString('fr-FR') : '—';
                const dur  = h.duration_min ? `${h.duration_min} min` : '—';
                const riskColor = h.risk_score >= 70 ? '#ef4444' : h.risk_score >= 40 ? '#f59e0b' : '#10b981';
                return `<tr style="border-bottom:1px solid #f1f5f9;">
                    <td style="padding:10px 12px;font-size:13px;"><strong>${h.exam_title}</strong><br>
                        <span style="font-size:10px;color:#94a3b8;">${date}</span></td>
                    <td style="padding:10px 12px;">${statusBadge(h.status, h.corrected_at)}</td>
                    <td style="padding:10px 12px;text-align:center;">${score}</td>
                    <td style="padding:10px 12px;text-align:center;font-size:12px;">${dur}</td>
                    <td style="padding:10px 12px;text-align:center;">
                        <span style="color:${riskColor};font-weight:700;font-size:12px;">${h.risk_score}%</span>
                    </td>
                    <td style="padding:10px 12px;">
                        ${h.feedback ? `<button class="btn btn-sm" onclick="showFeedbackModal('${encodeURIComponent(h.exam_title)}','${encodeURIComponent(h.feedback||'')}')"
                            style="background:#f1f5f9;color:#475569;font-size:11px;padding:4px 10px;">
                            <i class="fas fa-comment"></i> Feedback
                        </button>` : '<span style="color:#94a3b8;font-size:11px;">—</span>'}
                    </td>
                </tr>`;
            }).join('');
        showModal(`
            <div style="max-width:760px;">
                <h2 style="margin:0 0 4px;font-size:16px;"><i class="fas fa-history" style="color:#6366f1;margin-right:8px;"></i>Historique de mes examens</h2>
                <p style="color:#64748b;font-size:12px;margin:0 0 16px;">${history.length} examen(s) au total</p>
                <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Examen</th>
                            <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Statut</th>
                            <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Note</th>
                            <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Durée</th>
                            <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Risque</th>
                            <th style="padding:9px 12px;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;"></th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="margin-top:14px;text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fermer</button>
                </div>
            </div>`, '800px');
    } catch(e) {
        showAlert('Erreur chargement historique : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}

function showFeedbackModal(encodedTitle, encodedFeedback) {
    const title    = decodeURIComponent(encodedTitle);
    const feedback = decodeURIComponent(encodedFeedback);
    showModal(`
        <div style="max-width:520px;">
            <h2 style="font-size:15px;margin:0 0 4px;"><i class="fas fa-comment" style="color:#6366f1;margin-right:8px;"></i>Feedback — ${title}</h2>
            <div style="margin-top:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;font-size:13px;line-height:1.6;white-space:pre-wrap;color:#374151;">${feedback}</div>
            <div style="margin-top:14px;text-align:right;">
                <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fermer</button>
            </div>
        </div>`, '560px');
}

// ============================================================================
// DÉTECTION DE PLAGIAT
// ============================================================================

async function showPlagiarismReport(examId, examTitle) {
    showLoader(true);
    try {
        const resp = await authenticatedFetch(`/api/online_exams/${examId}/plagiarism-check?threshold=0.7`);
        const d    = await resp.json();
        const pairs = d.suspicious || [];
        const levelBadge = (l) => l === 'CRITIQUE'
            ? `<span style="background:#fee2e2;color:#ef4444;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">🔴 CRITIQUE</span>`
            : `<span style="background:#fef3c7;color:#d97706;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">⚠️ SUSPECT</span>`;
        const rows = pairs.length === 0
            ? `<tr><td colspan="4" style="text-align:center;padding:28px;color:#10b981;">
                <i class="fas fa-shield-check" style="font-size:24px;display:block;margin-bottom:8px;"></i>
                Aucune similarité suspecte détectée (seuil : ${d.threshold_pct}%)
               </td></tr>`
            : pairs.map(p => `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:10px 12px;font-size:12px;">
                    <strong>${p.student1_name}</strong><br>
                    <span style="color:#94a3b8;font-size:10px;">Tentative #${p.attempt1_id}</span>
                </td>
                <td style="padding:10px 12px;font-size:12px;">
                    <strong>${p.student2_name}</strong><br>
                    <span style="color:#94a3b8;font-size:10px;">Tentative #${p.attempt2_id}</span>
                </td>
                <td style="padding:10px 12px;text-align:center;">
                    <strong style="font-size:16px;color:${p.similarity>=90?'#ef4444':'#f59e0b'};">${p.similarity}%</strong>
                </td>
                <td style="padding:10px 12px;text-align:center;">${levelBadge(p.level)}</td>
              </tr>`).join('');
        showModal(`
            <div style="max-width:700px;">
                <h2 style="margin:0 0 4px;font-size:16px;"><i class="fas fa-search" style="color:#ef4444;margin-right:8px;"></i>Rapport de plagiat</h2>
                <p style="color:#64748b;font-size:12px;margin:0 0 4px;">${examTitle||d.exam_title||''}</p>
                <p style="font-size:11px;color:#94a3b8;margin:0 0 16px;">${d.total_checked} copies analysées · seuil ${d.threshold_pct}% · ${pairs.length} paire(s) suspecte(s)</p>
                <div style="overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Étudiant A</th>
                            <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Étudiant B</th>
                            <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Similarité</th>
                            <th style="padding:9px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#64748b;border-bottom:2px solid #e2e8f0;">Niveau</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="margin-top:14px;text-align:right;">
                    <button class="btn btn-secondary btn-sm" onclick="closeModal()">Fermer</button>
                </div>
            </div>`, '740px');
    } catch(e) {
        showAlert('Erreur analyse plagiat : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}

// ============================================================================
// RAPPORT D'INTÉGRITÉ PDF
// ============================================================================

async function downloadIntegrityReport(attemptId, studentName) {
    showLoader(true);
    try {
        const resp = await fetch(`/api/exam_attempts/${attemptId}/integrity-report`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            showAlert(err.error || 'Erreur rapport intégrité.', 'error');
            return;
        }
        const blob = await resp.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `rapport_integrite_${(studentName||'etudiant').replace(/\s+/g,'_')}.pdf`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
    } catch(e) {
        showAlert('Erreur téléchargement rapport : ' + (e.message || ''), 'error');
    } finally { showLoader(false); }
}

// ============================================================================
// RÉCLAMATION — STATUT EN COURS D'EXAMEN (IN_REVIEW)
// ============================================================================

function reclamStatusLabel(status) {
    const map = {
        pending:   { label: '⏳ En attente',       color: '#f59e0b', bg: '#fef3c7' },
        in_review: { label: '🔍 En cours d\'examen', color: '#3b82f6', bg: '#dbeafe' },
        resolved:  { label: '✅ Acceptée',          color: '#10b981', bg: '#d1fae5' },
        rejected:  { label: '❌ Rejetée',           color: '#ef4444', bg: '#fee2e2' },
    };
    const m = map[status] || { label: status, color: '#64748b', bg: '#f1f5f9' };
    return `<span style="background:${m.bg};color:${m.color};padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;">${m.label}</span>`;
}

async function setReclamationInReview(reclamationId) {
    try {
        await authenticatedFetch(`/api/reclamations/${reclamationId}`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'in_review', response: 'Réclamation en cours d\'examen.' })
        });
        showAlert('Statut mis à jour : En cours d\'examen.', 'success');
    } catch(e) { showAlert(e.serverMessage || e.message, 'error'); }
}

async function saveProfilePassword() {
    const current_password = document.getElementById('prof-pw-current').value;
    const new_password     = document.getElementById('prof-pw-new').value;
    const confirm_password = document.getElementById('prof-pw-confirm').value;
    if (!current_password) { showAlert('Saisissez votre mot de passe actuel.', 'error'); return; }
    if (!new_password)     { showAlert('Saisissez un nouveau mot de passe.', 'error'); return; }
    if (new_password !== confirm_password) { showAlert('Les mots de passe ne correspondent pas.', 'error'); return; }
    try {
        const r = await authenticatedFetch('/api/profile/password', { method: 'PUT', body: JSON.stringify({ current_password, new_password, confirm_password }) });
        const d = await r.json();
        if (d.success) {
            ['prof-pw-current','prof-pw-new','prof-pw-confirm'].forEach(id => document.getElementById(id).value = '');
            showAlert('Mot de passe changé avec succès !', 'success');
        } else {
            showAlert(d.error || 'Erreur lors du changement.', 'error');
        }
    } catch (e) { showAlert('Erreur de connexion.', 'error'); }
}

// ─── TEMPS SUPPLÉMENTAIRE ─────────────────────────────────────────────────────
async function grantExtraTime(attemptId, studentName) {
    const minutes = parseInt(prompt(`Combien de minutes supplémentaires pour ${studentName} ? (1-60)`, '10'), 10);
    if (!minutes || minutes < 1 || minutes > 60) { showAlert('Valeur invalide (1-60 min).', 'error'); return; }
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/extra-time`, {
            method: 'PUT',
            body: JSON.stringify({ minutes })
        });
        const d = await r.json();
        showAlert(`+${d.added} min accordées à ${studentName} (total : ${d.total_extra} min).`, 'success');
        if (window._currentViewedExamId) viewExamSubmissions(window._currentViewedExamId);
    } catch (e) { showAlert(e.serverMessage || 'Erreur lors de l\'attribution du temps.', 'error'); }
}

// ─── NOTES SURVEILLANT ────────────────────────────────────────────────────────
async function addProctorNote(attemptId, studentName) {
    const note = prompt(`Note de surveillance pour ${studentName} :`);
    if (!note || !note.trim()) return;
    try {
        await authenticatedFetch(`/api/exam_attempts/${attemptId}/proctor-note`, {
            method: 'POST',
            body: JSON.stringify({ note: note.trim() })
        });
        showAlert('Note enregistrée.', 'success');
    } catch (e) { showAlert(e.serverMessage || 'Erreur lors de l\'enregistrement de la note.', 'error'); }
}

async function viewProctorNotes(attemptId, studentName) {
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/proctor-notes`);
        const d = await r.json();
        const notes = d.notes || [];
        if (!notes.length) { showAlert(`Aucune note de surveillance pour ${studentName}.`, 'info'); return; }
        const rows = notes.map(n => {
            const ts = new Date(n.timestamp).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
            return `<tr>
              <td style="padding:6px 10px;color:#64748b;font-size:12px;white-space:nowrap">${ts}</td>
              <td style="padding:6px 10px;color:#64748b;font-size:12px">${escapeHtml(n.author || '—')}</td>
              <td style="padding:6px 10px">${escapeHtml(n.note)}</td>
            </tr>`;
        }).join('');
        const html = `<div style="max-height:380px;overflow-y:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc;font-size:11px;color:#94a3b8;text-transform:uppercase">
              <th style="padding:6px 10px;text-align:left">Heure</th>
              <th style="padding:6px 10px;text-align:left">Auteur</th>
              <th style="padding:6px 10px;text-align:left">Note</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`;
        showModal(html);
    } catch (e) { showAlert('Erreur lors de la récupération des notes.', 'error'); }
}

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── QR CODE EXAMEN ───────────────────────────────────────────────────────────
async function showExamQRCode(examId, examTitle) {
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/qrcode`);
        const d = await r.json();
        const html = `<div style="text-align:center;padding:16px">
          <p style="color:#64748b;font-size:13px;margin-bottom:12px">Scannez ce QR code pour accéder à l'examen :</p>
          <img src="${d.qrcode_b64}" alt="QR Code" style="width:220px;height:220px;border:1px solid #e2e8f0;border-radius:8px"/>
          <p style="margin-top:12px;font-size:11px;color:#94a3b8;word-break:break-all">${d.url || ''}</p>
          <button onclick="
            const a=document.createElement('a');
            a.href='${d.qrcode_b64}';
            a.download='qrcode-examen-${examId}.png';
            a.click();
          " style="margin-top:12px;padding:8px 18px;background:#6366f1;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px">
            Télécharger
          </button>
        </div>`;
        showModal(html);
    } catch (e) { showAlert(e.serverMessage || 'Erreur lors de la génération du QR code.', 'error'); }
}


// ============================================================================
// BILAN D'EXAMEN PAR ÉTUDIANT
// ============================================================================

async function showExamBilan(examId, examTitle) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/bilan`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Erreur');

        const statusLabel = { submitted: 'Soumis', auto_submitted: 'Auto-soumis', in_progress: 'En cours', banned: 'Exclu', not_started: 'Absent' };
        const statusColor = { submitted: '#6366f1', auto_submitted: '#8b5cf6', in_progress: '#f59e0b', banned: '#ef4444', not_started: '#94a3b8' };
        const riskColor   = s => s >= 70 ? '#ef4444' : s >= 40 ? '#f59e0b' : '#10b981';
        const scoreColor  = s => s === null ? '#94a3b8' : s >= 10 ? '#10b981' : '#ef4444';

        const rows = (d.attempts || []).map(a => {
            const sc       = statusColor[a.status] || '#94a3b8';
            const sl       = statusLabel[a.status]  || a.status;
            const safeName = (a.student_name || '').replace(/'/g, "\\'");
            return `<tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px 10px;font-size:13px;font-weight:500;color:#0f172a">${escHtml(a.student_name)}</td>
                <td style="padding:8px 10px;text-align:center;">
                    <span style="background:${sc}22;color:${sc};font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;">${sl}</span>
                </td>
                <td style="padding:8px 10px;text-align:center;font-size:13px;font-weight:700;color:${scoreColor(a.score)};">${a.score !== null ? a.score + '/20' : '—'}</td>
                <td style="padding:8px 10px;text-align:center;">
                    <span style="color:${riskColor(a.risk_score)};font-size:12px;font-weight:600;">${a.risk_score}%</span>
                </td>
                <td style="padding:8px 10px;text-align:center;font-size:12px;color:#64748b;">${a.duration_min !== null ? a.duration_min + ' min' : '—'}</td>
                <td style="padding:8px 10px;text-align:center;font-size:12px;color:${a.extra_minutes > 0 ? '#d97706' : '#94a3b8'};">${a.extra_minutes > 0 ? '+' + a.extra_minutes + ' min' : '—'}</td>
                <td style="padding:8px 10px;text-align:center;font-size:12px;color:${a.note_count > 0 ? '#6366f1' : '#94a3b8'};">${a.note_count > 0 ? a.note_count + ' note(s)' : '—'}</td>
                <td style="padding:8px 10px;text-align:center;">
                    <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">
                        <button onclick="showAttemptReview(${a.attempt_id},'${safeName}')"
                            style="padding:3px 9px;font-size:11px;background:#ede9fe;color:#6366f1;border:none;border-radius:5px;cursor:pointer;white-space:nowrap;">
                            <i class="fas fa-eye"></i> Réviser
                        </button>
                        ${a.score != null ? `<button onclick="downloadAttemptReportPDF(${a.attempt_id},'${safeName}')"
                            style="padding:3px 9px;font-size:11px;background:#f0fdf4;color:#16a34a;border:none;border-radius:5px;cursor:pointer;white-space:nowrap;">
                            <i class="fas fa-file-pdf"></i> PDF
                        </button>` : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

        const html = `
        <div style="max-width:820px;">
            <h2 style="margin:0 0 4px;font-size:17px;"><i class="fas fa-list-alt" style="color:#0369a1;margin-right:8px;"></i>Bilan — ${escHtml(d.exam_title || examTitle)}</h2>
            <p style="color:#64748b;margin:0 0 16px;font-size:13px;">${(d.attempts||[]).length} participant(s)</p>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;">
                            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Étudiant</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Statut</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Note</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Risque</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Durée</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#d97706;font-weight:700;text-transform:uppercase;">Extra</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6366f1;font-weight:700;text-transform:uppercase;">Notes surv.</th>
                            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8;">Aucun participant</td></tr>'}</tbody>
                </table>
            </div>
            <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
                <button onclick="downloadCorrectionsZip(${examId},'${(d.exam_title||examTitle||'').replace(/'/g,'')}')"
                    style="background:#0369a1;color:white;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-file-archive"></i> ZIP copies
                </button>
                <button onclick="downloadBilanPDF(${examId},'${(d.exam_title||examTitle||'').replace(/'/g,'')}')"
                    style="background:#1e293b;color:white;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:8px;">
                    <i class="fas fa-file-pdf"></i> PDF Bilan
                </button>
            </div>
        </div>`;
        showModal(html);
    } catch (e) {
        showAlert(e.message || 'Impossible de charger le bilan.', 'error');
    } finally {
        showLoader(false);
    }
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================================
// TÉLÉCHARGEMENT PDF BILAN
// ============================================================================

async function downloadBilanPDF(examId, examTitle) {
    try {
        const token = localStorage.getItem('authToken');
        const r = await fetch(`/api/online_exams/${examId}/bilan/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur PDF'); }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `bilan-${(examTitle||'examen').replace(/[^a-zA-Z0-9-_ ]/g,'').trim()}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) { showAlert(e.message || 'Erreur lors du téléchargement PDF.', 'error'); }
}

// ============================================================================
// CORRECTION EN CHAÎNE
// ============================================================================

let _chainQueue = [];
let _chainIdx   = 0;
let _chainExamId = null;

async function startChainCorrection(examId) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/attempts`);
        const attempts = await r.json();
        const queue = attempts.filter(a => a.needs_correction || (a.status === 'submitted' || a.status === 'auto_submitted'));
        if (!queue.length) { showAlert('Aucune copie à corriger pour cet examen.', 'info'); return; }
        _chainQueue  = queue;
        _chainIdx    = 0;
        _chainExamId = examId;
        await _renderChainModal();
    } catch (e) { showAlert(e.message, 'error'); }
    finally { showLoader(false); }
}

async function _renderChainModal() {
    const existing = document.getElementById('chain-modal');
    if (existing) existing.remove();

    const attempt = _chainQueue[_chainIdx];
    if (!attempt) return;

    // Fetch full details for this attempt
    let answers = '', feedback = '', score = attempt.score, warnings = attempt.warnings_count || 0;
    try {
        const r2 = await authenticatedFetch(`/api/exam_attempts/${attempt.id}/result`).catch(() => null);
        if (r2 && r2.ok) {
            const d2 = await r2.json();
            feedback = d2.feedback || '';
            score    = d2.score !== undefined ? d2.score : score;
        }
    } catch (_) {}
    try {
        const parsed = JSON.parse(attempt.answers || '{}');
        answers = parsed.reponse || parsed.content || parsed.answer || parsed.text || attempt.answers || '';
    } catch { answers = attempt.answers || ''; }
    answers = (answers || '').trim();

    const scoreColor = score !== null ? (score >= 10 ? '#10b981' : '#ef4444') : '#94a3b8';
    const m = document.createElement('div');
    m.id = 'chain-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9998;display:flex;align-items:center;justify-content:center;padding:12px;';
    m.innerHTML = `
    <div style="background:#fff;border-radius:16px;width:100%;max-width:780px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.3);">
        <!-- Header -->
        <div style="padding:16px 22px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <div>
                <span style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;">Correction en chaîne</span>
                <h2 style="margin:2px 0 0;font-size:16px;font-weight:700;color:#0f172a;">${escHtml(attempt.student_name)}</h2>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="background:#f1f5f9;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;color:#475569;">${_chainIdx+1} / ${_chainQueue.length}</span>
                ${score !== null ? `<span style="background:${scoreColor}22;color:${scoreColor};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;">${score}/20</span>` : ''}
                ${warnings > 0 ? `<span style="background:#fef3c7;color:#d97706;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;"><i class="fas fa-exclamation-triangle"></i> ${warnings} incident(s)</span>` : ''}
                <button onclick="document.getElementById('chain-modal').remove()" style="background:none;border:none;font-size:20px;color:#94a3b8;cursor:pointer;line-height:1;">&times;</button>
            </div>
        </div>
        <!-- Body -->
        <div style="flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
            <div>
                <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Réponse de l'étudiant</div>
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;font-size:13px;color:#334155;line-height:1.7;max-height:220px;overflow-y:auto;white-space:pre-wrap;">${escHtml(answers) || '<em style="color:#94a3b8">Aucune réponse enregistrée</em>'}</div>
            </div>
            ${feedback ? `<div>
                <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">Feedback IA</div>
                <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px;font-size:12px;color:#1e40af;line-height:1.6;max-height:140px;overflow-y:auto;">${feedback.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')}</div>
            </div>` : ''}
            <!-- Saisie manuelle -->
            <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px;">
                <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:10px;"><i class="fas fa-pen"></i> Correction manuelle</div>
                <div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">
                    <div style="flex:0 0 120px;">
                        <label style="font-size:12px;color:#475569;display:block;margin-bottom:4px;">Note /20</label>
                        <input id="chain-score" type="number" min="0" max="20" step="0.5" value="${score !== null ? score : ''}" placeholder="—"
                            style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:15px;font-weight:700;text-align:center;box-sizing:border-box;">
                    </div>
                    <div style="flex:1;min-width:200px;">
                        <label style="font-size:12px;color:#475569;display:block;margin-bottom:4px;">Feedback (optionnel)</label>
                        <textarea id="chain-feedback" rows="3" placeholder="Commentaire pour l'étudiant…"
                            style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;resize:vertical;box-sizing:border-box;">${escHtml(feedback)}</textarea>
                    </div>
                </div>
            </div>
        </div>
        <!-- Footer -->
        <div style="padding:14px 22px;border-top:1px solid #f1f5f9;display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;">
            <div style="display:flex;gap:8px;">
                <button onclick="_chainNav(-1)" ${_chainIdx === 0 ? 'disabled' : ''}
                    style="padding:9px 16px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:13px;${_chainIdx===0?'opacity:.4;cursor:not-allowed;':''}">
                    <i class="fas fa-chevron-left"></i> Précédent
                </button>
                <button onclick="_chainNav(1)" ${_chainIdx >= _chainQueue.length-1 ? 'disabled' : ''}
                    style="padding:9px 16px;border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;cursor:pointer;font-size:13px;${_chainIdx>=_chainQueue.length-1?'opacity:.4;cursor:not-allowed;':''}">
                    Suivant <i class="fas fa-chevron-right"></i>
                </button>
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="_chainSaveManual(${attempt.id})"
                    style="padding:9px 18px;background:#d97706;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">
                    <i class="fas fa-save"></i> Enregistrer
                </button>
                <button onclick="_chainCorrectAI(${attempt.id})"
                    style="padding:9px 18px;background:#10b981;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">
                    <i class="fas fa-robot"></i> Corriger par IA
                </button>
            </div>
        </div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
}

async function _chainNav(dir) {
    const newIdx = _chainIdx + dir;
    if (newIdx < 0 || newIdx >= _chainQueue.length) return;
    _chainIdx = newIdx;
    await _renderChainModal();
}

async function _chainSaveManual(attemptId) {
    const scoreVal = parseFloat(document.getElementById('chain-score').value);
    const fb = (document.getElementById('chain-feedback').value || '').trim();
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 20) {
        showAlert('Note invalide (0–20)', 'error'); return;
    }
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/manual-grade`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ score: scoreVal, feedback: fb })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        // Update queue entry
        const entry = _chainQueue.find(a => a.id === attemptId);
        if (entry) { entry.score = scoreVal; entry.needs_correction = false; }
        showAlert(`✅ Note enregistrée : ${scoreVal}/20`, 'success');
        if (_chainIdx < _chainQueue.length - 1) {
            _chainIdx++;
            await _renderChainModal();
        } else {
            document.getElementById('chain-modal')?.remove();
            showAlert('Toutes les copies ont été corrigées.', 'success');
        }
    } catch (e) { showAlert(e.message, 'error'); }
}

async function _chainCorrectAI(attemptId) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/correct`, { method: 'POST' });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.error || 'Erreur IA');
        const entry = _chainQueue.find(a => a.id === attemptId);
        if (entry) { entry.score = d.attempt?.score; entry.needs_correction = false; }
        showAlert(`✅ IA : ${d.attempt?.score}/20`, 'success');
        if (_chainIdx < _chainQueue.length - 1) {
            _chainIdx++;
            await _renderChainModal();
        } else {
            document.getElementById('chain-modal')?.remove();
            showAlert('Toutes les copies ont été corrigées.', 'success');
        }
    } catch (e) { showAlert(e.message, 'error'); }
    finally { showLoader(false); }
}

// ============================================================================
// CALENDRIER GRILLE — PROFESSEUR / ADMIN
// ============================================================================

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-based
let _calExams = [];

async function loadExamCalendar() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const r = await authenticatedFetch('/api/online_exams');
        _calExams = await r.json();
        _calYear  = new Date().getFullYear();
        _calMonth = new Date().getMonth();
        _renderCalendar();
    } catch (e) { showAlert('Erreur chargement calendrier.', 'error'); }
    finally { showLoader(false); }
}

function _renderCalendar() {
    const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const dayNames   = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    const statusColors = { active:'#10b981', scheduled:'#3b82f6', closed:'#94a3b8', draft:'#f59e0b' };

    // Build day→exams map
    const dayMap = {};
    _calExams.forEach(ex => {
        const dt = ex.scheduled_start ? new Date(ex.scheduled_start) : null;
        if (!dt) return;
        if (dt.getFullYear() === _calYear && dt.getMonth() === _calMonth) {
            const d = dt.getDate();
            if (!dayMap[d]) dayMap[d] = [];
            dayMap[d].push(ex);
        }
    });

    const firstDay = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
    const leadDays = (firstDay + 6) % 7; // Mon-based
    const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
    const today = new Date();

    let cells = '';
    for (let i = 0; i < leadDays; i++) cells += '<div style="background:#fafafa;border-radius:8px;min-height:80px;"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const isToday = today.getFullYear() === _calYear && today.getMonth() === _calMonth && today.getDate() === d;
        const exams   = dayMap[d] || [];
        const dots = exams.map(ex => {
            const c = statusColors[ex.status] || '#94a3b8';
            const safe = escHtml((ex.title||'').replace(/'/g,''));
            return `<div onclick="event.stopPropagation();_calShowExam(${ex.id})" title="${safe}"
                style="background:${c};color:white;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;margin-bottom:2px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:100%;">
                ${safe}
            </div>`;
        }).join('');
        cells += `
        <div style="background:${isToday ? '#eff6ff' : '#fff'};border:${isToday ? '2px solid #3b82f6' : '1px solid #f1f5f9'};border-radius:8px;padding:6px 8px;min-height:80px;cursor:default;">
            <div style="font-size:12px;font-weight:${isToday?'800':'600'};color:${isToday?'#2563eb':'#334155'};margin-bottom:4px;">${d}</div>
            ${dots}
        </div>`;
    }
    // Fill trailing cells to complete last week
    const total = leadDays + daysInMonth;
    const trail = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 0; i < trail; i++) cells += '<div style="background:#fafafa;border-radius:8px;min-height:80px;"></div>';

    const upcomingList = _calExams
        .filter(ex => ex.scheduled_start)
        .sort((a,b) => new Date(a.scheduled_start) - new Date(b.scheduled_start))
        .slice(0, 8)
        .map(ex => {
            const c = statusColors[ex.status] || '#94a3b8';
            const dt = new Date(ex.scheduled_start).toLocaleDateString('fr-FR',{weekday:'short',day:'numeric',month:'short'});
            return `<div onclick="_calShowExam(${ex.id})" style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <span style="width:10px;height:10px;background:${c};border-radius:50%;flex-shrink:0;"></span>
                <span style="flex:1;font-size:13px;color:#0f172a;font-weight:500;">${escHtml(ex.title)}</span>
                <span style="font-size:11px;color:#94a3b8;">${dt}</span>
            </div>`;
        }).join('') || '<p style="color:#94a3b8;font-size:13px;padding:8px 12px;">Aucun examen planifié</p>';

    document.getElementById('main-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:start;">
        <!-- Calendrier -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <button onclick="_calNav(-1)" style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:14px;">‹</button>
                <h2 style="margin:0;font-size:17px;font-weight:700;color:#0f172a;">${monthNames[_calMonth]} ${_calYear}</h2>
                <button onclick="_calNav(1)"  style="background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:14px;">›</button>
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
                ${dayNames.map(d => `<div style="text-align:center;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;padding:4px 0;">${d}</div>`).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
            <!-- Légende -->
            <div style="display:flex;gap:14px;margin-top:12px;flex-wrap:wrap;">
                ${Object.entries(statusColors).map(([s,c])=>`<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:#64748b;"><span style="width:8px;height:8px;background:${c};border-radius:50%;"></span>${s}</span>`).join('')}
            </div>
        </div>
        <!-- Sidebar liste -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:16px;">
            <h3 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;"><i class="fas fa-list" style="color:#3b82f6;"></i> À venir</h3>
            ${upcomingList}
        </div>
    </div>`;
}

function _calNav(dir) {
    _calMonth += dir;
    if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
    if (_calMonth > 11) { _calMonth = 0;  _calYear++; }
    _renderCalendar();
}

async function _calShowExam(examId) {
    const ex = _calExams.find(e => e.id === examId);
    if (!ex) return;
    const statusColors = { active:'#10b981', scheduled:'#3b82f6', closed:'#94a3b8', draft:'#f59e0b' };
    const c = statusColors[ex.status] || '#94a3b8';
    const dt = ex.scheduled_start ? new Date(ex.scheduled_start).toLocaleString('fr-FR',{timeZone:'Africa/Dakar'}) : '—';
    const html = `
    <div style="max-width:440px;">
        <h2 style="margin:0 0 6px;font-size:17px;">${escHtml(ex.title)}</h2>
        <span style="background:${c}22;color:${c};padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">${ex.status}</span>
        <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <div style="background:#f8fafc;border-radius:10px;padding:12px;">
                <div style="font-size:11px;color:#94a3b8;">Date</div>
                <div style="font-size:13px;font-weight:600;color:#0f172a;margin-top:2px;">${dt}</div>
            </div>
            <div style="background:#f8fafc;border-radius:10px;padding:12px;">
                <div style="font-size:11px;color:#94a3b8;">Durée</div>
                <div style="font-size:13px;font-weight:600;color:#0f172a;margin-top:2px;">${ex.duration_minutes || '—'} min</div>
            </div>
        </div>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
            <button onclick="closeModal();loadOnlineExams()" style="flex:1;padding:9px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">
                <i class="fas fa-external-link-alt"></i> Gérer l'examen
            </button>
            ${ex.status === 'closed' ? `<button onclick="closeModal();showExamBilan(${examId},'${(ex.title||"").replace(/'/g,"\\'")}')" style="flex:1;padding:9px;background:#0369a1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;"><i class="fas fa-list-alt"></i> Bilan</button>` : ''}
        </div>
    </div>`;
    showModal(html);
}


// ============================================================================
// RÉVISION DÉTAILLÉE D'UNE TENTATIVE
// ============================================================================

async function showAttemptReview(attemptId, studentName) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/review`);
        const d = await r.json();

        const scoreColor = (d.score != null && d.score >= 10) ? '#10b981' : '#ef4444';
        const riskColor  = d.risk_score >= 70 ? '#ef4444' : d.risk_score >= 40 ? '#f59e0b' : '#10b981';

        const badge = (label, val, bg, fg='white') =>
            `<span style="background:${bg}22;color:${bg};padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid ${bg}44;">${label}: ${val}</span>`;

        const incidentTypes = { tab_switch:'Changement onglet', copy_attempt:'Copier', paste_attempt:'Coller',
            right_click:'Clic droit', devtools:'Outils dev', no_face:'Visage absent',
            face_mismatch:'Visage différent', suspicious_audio:'Audio suspect' };

        const incRows = d.incidents.slice(-20).map(inc => {
            const ts = inc.timestamp ? new Date(inc.timestamp).toLocaleTimeString('fr-FR') : '—';
            const label = incidentTypes[inc.type] || inc.type;
            return `<tr><td style="padding:4px 8px;font-size:11px;color:#64748b;">${ts}</td>
                    <td style="padding:4px 8px;font-size:11px;font-weight:600;color:#ef4444;">${label}</td></tr>`;
        }).join('') || `<tr><td colspan="2" style="padding:8px;font-size:12px;color:#94a3b8;">Aucun incident</td></tr>`;

        const noteRows = d.proctor_notes.map(n => {
            const ts = n.timestamp ? new Date(n.timestamp).toLocaleString('fr-FR') : '—';
            return `<div style="background:#fef3c7;border-left:3px solid #f59e0b;padding:8px 12px;margin-bottom:8px;border-radius:0 6px 6px 0;">
                <div style="font-size:11px;color:#92400e;font-weight:700;">${escHtml(n.author || '—')} — ${ts}</div>
                <div style="font-size:12px;color:#78350f;margin-top:2px;">${escHtml(n.note)}</div>
            </div>`;
        }).join('') || '<p style="color:#94a3b8;font-size:12px;">Aucune note</p>';

        const answerHtml = d.student_answer
            ? `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;color:#334155;background:#f8fafc;padding:12px;border-radius:8px;max-height:250px;overflow-y:auto;border:1px solid #e2e8f0;">${escHtml(d.student_answer.substring(0,3000))}${d.student_answer.length>3000?'\n…(tronqué)':''}</pre>`
            : '<p style="color:#94a3b8;font-size:12px;">Réponse non disponible</p>';

        const feedbackHtml = d.feedback
            ? `<pre style="white-space:pre-wrap;word-break:break-word;font-family:inherit;font-size:12px;color:#334155;background:#f0f9ff;padding:12px;border-radius:8px;max-height:250px;overflow-y:auto;border:1px solid #bae6fd;">${escHtml(d.feedback.substring(0,4000))}${d.feedback.length>4000?'\n…(tronqué)':''}</pre>`
            : '<p style="color:#94a3b8;font-size:12px;">Pas encore corrigé</p>';

        const duration = d.duration_min != null ? `${d.duration_min} min` : '—';

        showModal(`
        <div style="max-width:760px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap;">
                <div>
                    <h2 style="margin:0 0 4px;font-size:16px;"><i class="fas fa-user-graduate" style="color:#6366f1;margin-right:8px;"></i>${escHtml(d.student_name)}</h2>
                    <p style="color:#64748b;margin:0;font-size:12px;">${escHtml(d.exam_title)}</p>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${d.score != null ? badge('Note', d.score+'/20', scoreColor) : ''}
                    ${badge('Risque', d.risk_score+'%', riskColor)}
                    ${badge('Durée', duration, '#6366f1')}
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <!-- Incidents -->
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
                    <h4 style="margin:0 0 8px;font-size:12px;font-weight:700;color:#ef4444;text-transform:uppercase;letter-spacing:.05em;">
                        <i class="fas fa-exclamation-triangle"></i> Incidents (${d.incidents.length})
                    </h4>
                    <div style="font-size:11px;color:#64748b;margin-bottom:6px;">
                        ${d.tab_switches} fenêtre · ${d.warnings_count} avert. · ${d.no_face_count} sans-visage
                        ${d.extra_minutes ? ` · +${d.extra_minutes} min extra` : ''}
                    </div>
                    <table style="width:100%;">${incRows}</table>
                    ${d.ban_reason ? `<div style="background:#fef2f2;border-radius:6px;padding:8px;margin-top:8px;font-size:11px;color:#dc2626;"><b>Exclu :</b> ${escHtml(d.ban_reason)}</div>` : ''}
                </div>
                <!-- Notes surveillant -->
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;">
                    <h4 style="margin:0 0 8px;font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:.05em;">
                        <i class="fas fa-sticky-note"></i> Notes surveillant (${d.proctor_notes.length})
                    </h4>
                    ${noteRows}
                </div>
            </div>
            <!-- Réponse -->
            <div style="margin-bottom:12px;">
                <h4 style="margin:0 0 6px;font-size:12px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.05em;">Réponse étudiant</h4>
                ${answerHtml}
            </div>
            <!-- Correction -->
            <div style="margin-bottom:16px;">
                <h4 style="margin:0 0 6px;font-size:12px;font-weight:700;color:#6366f1;text-transform:uppercase;letter-spacing:.05em;">Correction IA</h4>
                ${feedbackHtml}
            </div>
            <div style="text-align:right;display:flex;gap:10px;justify-content:flex-end;">
                <button onclick="downloadAttemptReportPDF(${attemptId},'${(d.student_name||'').replace(/'/g,"\\'")}');closeModal();"
                    style="padding:8px 18px;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">
                    <i class="fas fa-file-pdf"></i> Rapport PDF
                </button>
                <button onclick="closeModal()" style="padding:8px 18px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;cursor:pointer;font-size:13px;">Fermer</button>
            </div>
        </div>`, '800px');
    } catch(e) {
        showAlert('Erreur révision : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}


// ============================================================================
// TÉLÉCHARGEMENT ZIP DES COPIES CORRIGÉES
// ============================================================================

async function downloadCorrectionsZip(examId, examTitle) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/online_exams/${examId}/corrections/zip`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Erreur téléchargement ZIP');
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `corrections_${(examTitle||'exam').replace(/[^a-z0-9]/gi,'_')}.zip`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert('ZIP téléchargé avec succès.', 'success');
    } catch(e) {
        showAlert('Erreur ZIP : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}


// ============================================================================
// PDF RAPPORT INDIVIDUEL PAR TENTATIVE
// ============================================================================

async function downloadAttemptReportPDF(attemptId, studentName) {
    showLoader(true);
    try {
        const r = await authenticatedFetch(`/api/exam_attempts/${attemptId}/report/pdf`);
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error || 'Erreur rapport PDF');
        }
        const blob = await r.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `rapport_${(studentName||'etudiant').replace(/[^a-z0-9]/gi,'_')}_${attemptId}.pdf`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch(e) {
        showAlert('Erreur rapport : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}


// ============================================================================
// DASHBOARD ANALYTIQUE PROF
// ============================================================================

async function loadProfessorAnalytics() {
    if (window.event && window.event.target) setActiveTab(window.event.target);
    showLoader(true);
    try {
        const r = await authenticatedFetch('/api/professor/analytics');
        const d = await r.json();

        const kpi = (label, val, color='#1e293b', sub='') =>
            `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;flex:1;min-width:130px;">
                <div style="font-size:24px;font-weight:800;color:${color};">${val ?? '—'}</div>
                <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">${label}</div>
                ${sub ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">${sub}</div>` : ''}
             </div>`;

        const statusColors = { active:'#10b981', scheduled:'#3b82f6', closed:'#94a3b8', draft:'#f59e0b' };

        const statusDots = Object.entries(d.status_counts||{}).map(([s,n]) =>
            `<span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#475569;margin-right:14px;">
                <span style="width:10px;height:10px;background:${statusColors[s]||'#94a3b8'};border-radius:50%;"></span>${s} <b>${n}</b>
             </span>`
        ).join('');

        const examRankRow = (exam, medal) =>
            `<tr onclick="loadOnlineExams()" style="cursor:pointer;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
                <td style="padding:8px 10px;font-size:13px;">${medal} ${escHtml(exam.title)}</td>
                <td style="padding:8px 10px;font-size:13px;font-weight:700;color:${(exam.avg_score||0)>=10?'#10b981':'#ef4444'};">${exam.avg_score}/20</td>
                <td style="padding:8px 10px;font-size:12px;color:#64748b;">${exam.pass_rate}%</td>
                <td style="padding:8px 10px;font-size:12px;color:#64748b;">${exam.corrected} copie(s)</td>
             </tr>`;

        const topRows = (d.top_exams||[]).map((e,i) => examRankRow(e, ['🥇','🥈','🥉'][i]||'•')).join('');
        const botRows = (d.bottom_exams||[]).map((e,i) => examRankRow(e, ['⬇️','⬇️','⬇️'][i]||'•')).join('');

        const recentRows = (d.recent_corrections||[]).map(c => {
            const sc = c.score != null ? c.score : null;
            const dt = c.corrected_at ? new Date(c.corrected_at).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
            return `<tr>
                <td style="padding:7px 10px;font-size:12px;">${escHtml(c.student_name)}</td>
                <td style="padding:7px 10px;font-size:12px;color:#64748b;">${escHtml(c.exam_title)}</td>
                <td style="padding:7px 10px;font-size:12px;font-weight:700;color:${sc!=null&&sc>=10?'#10b981':'#ef4444'};">${sc != null ? sc+'/20' : '—'}</td>
                <td style="padding:7px 10px;font-size:11px;color:#94a3b8;">${dt}</td>
             </tr>`;
        }).join('') || `<tr><td colspan="4" style="padding:12px;color:#94a3b8;text-align:center;">Aucune correction récente</td></tr>`;

        const avgColor = d.overall_avg != null ? (d.overall_avg >= 10 ? '#10b981' : '#ef4444') : '#1e293b';
        const prColor  = d.overall_pass_rate != null ? (d.overall_pass_rate >= 50 ? '#10b981' : '#f59e0b') : '#1e293b';

        document.getElementById('main-content').innerHTML = `
        <div class="page-header">
            <h2><i class="fas fa-chart-line" style="color:#6366f1;margin-right:10px;"></i>Tableau de bord analytique</h2>
            <p style="color:#64748b;margin:4px 0 0;">${statusDots}</p>
        </div>
        <!-- KPI Row -->
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
            ${kpi('Examens', d.total_exams, '#6366f1')}
            ${kpi('Tentatives', d.total_attempts, '#0ea5e9')}
            ${kpi('Soumissions', d.total_submitted, '#8b5cf6')}
            ${kpi('Copies corrigées', d.total_corrected, '#10b981')}
            ${kpi('Moyenne globale', d.overall_avg != null ? d.overall_avg+'/20' : '—', avgColor)}
            ${kpi('Taux réussite', d.overall_pass_rate != null ? d.overall_pass_rate+'%' : '—', prColor)}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <!-- Top exams -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;">
                    <i class="fas fa-trophy" style="color:#f59e0b;margin-right:6px;"></i>Meilleurs examens
                </h3>
                ${topRows ? `<table style="width:100%;border-collapse:collapse;">${topRows}</table>` : '<p style="color:#94a3b8;font-size:12px;">Pas encore de données (min. 2 copies corrigées)</p>'}
            </div>
            <!-- Bottom exams -->
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
                <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;">
                    <i class="fas fa-arrow-down" style="color:#ef4444;margin-right:6px;"></i>Examens à améliorer
                </h3>
                ${botRows ? `<table style="width:100%;border-collapse:collapse;">${botRows}</table>` : '<p style="color:#94a3b8;font-size:12px;">Pas encore de données (min. 2 copies corrigées)</p>'}
            </div>
        </div>

        <!-- Corrections récentes -->
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;">
            <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.05em;">
                <i class="fas fa-clock" style="color:#6366f1;margin-right:6px;"></i>Corrections récentes (10 dernières)
            </h3>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr style="background:#f8fafc;">
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Étudiant</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Examen</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Note</th>
                        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;">Date</th>
                    </tr>
                </thead>
                <tbody>${recentRows}</tbody>
            </table>
        </div>`;
    } catch(e) {
        showAlert('Erreur analytique : ' + (e.serverMessage || e.message), 'error');
    } finally { showLoader(false); }
}
