// State management
let summaryData = {
  totalReleases: 0,
  apps: [],
  platforms: [],
  deployments: [],
  recentReleases: []
};

let userToken = localStorage.getItem('token');
let currentUser = null;

// Selectors
const statApps = document.getElementById('stat-apps');
const statReleases = document.getElementById('stat-releases');
const statPlatforms = document.getElementById('stat-platforms');

const appSelect = document.getElementById('app-select');
const platformSelect = document.getElementById('platform-select');
const deploymentSelect = document.getElementById('deployment-select');

const releasesTbody = document.getElementById('releases-tbody');
const resultsCount = document.getElementById('results-count');
const toast = document.getElementById('toast');

// Initialize Dashboard
async function init() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect');

  if (!userToken) {
    showLoginOverlay();
    return;
  }

  try {
    // Verify token and fetch user details
    const meRes = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    
    if (!meRes.ok) {
      logout();
      return;
    }
    
    const meData = await meRes.json();
    currentUser = meData.user;
    
    if (redirect) {
      window.location.href = redirect;
      return;
    }
    
    hideLoginOverlay();
    showUserProfile();

    // Fetch dashboard summary
    const res = await fetch('/api/dashboard-summary', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (!res.ok) throw new Error('Failed to fetch summary');
    
    const data = await res.json();
    summaryData = data.summary;
    
    updateStats();
    populateDropdowns();
    setupListeners();
    setupAuthListeners();
    setupTokenListeners();
  } catch (error) {
    console.error('Initialization failed:', error);
  }
}

// Update top statistics cards
function updateStats() {
  statApps.textContent = summaryData.apps.length;
  statReleases.textContent = summaryData.totalReleases;
  statPlatforms.textContent = summaryData.platforms.length || 0;
}

// Populate dropdown filters dynamically
function populateDropdowns() {
  // Clear existing options
  appSelect.innerHTML = '<option value="">Select App</option>';
  platformSelect.innerHTML = '<option value="">Select Platform</option>';
  deploymentSelect.innerHTML = '<option value="">Select Deployment</option>';

  // Populate Apps
  summaryData.apps.forEach(app => {
    const opt = document.createElement('option');
    opt.value = app;
    opt.textContent = app;
    appSelect.appendChild(opt);
  });

  // Populate Platforms
  summaryData.platforms.forEach(plat => {
    const opt = document.createElement('option');
    opt.value = plat;
    opt.textContent = plat === 'ios' ? 'iOS' : 'Android';
    platformSelect.appendChild(opt);
  });

  // Populate Deployments
  summaryData.deployments.forEach(dep => {
    const opt = document.createElement('option');
    opt.value = dep;
    opt.textContent = dep;
    deploymentSelect.appendChild(opt);
  });

  // Pre-select first item if exists to improve UX
  if (summaryData.apps.length > 0) {
    appSelect.value = summaryData.apps[0];
  }
  if (summaryData.platforms.length > 0) {
    platformSelect.value = summaryData.platforms[0];
  }
  if (summaryData.deployments.length > 0) {
    deploymentSelect.value = 'Staging'; // Default select Staging if available
    if (!summaryData.deployments.includes('Staging') && summaryData.deployments.length > 0) {
      deploymentSelect.value = summaryData.deployments[0];
    }
  }
  
  // Trigger initial fetch of table data
  fetchReleases();
}

// Listen to filter selection changes
function setupListeners() {
  appSelect.removeEventListener('change', fetchReleases);
  platformSelect.removeEventListener('change', fetchReleases);
  deploymentSelect.removeEventListener('change', fetchReleases);
  
  appSelect.addEventListener('change', fetchReleases);
  platformSelect.addEventListener('change', fetchReleases);
  deploymentSelect.addEventListener('change', fetchReleases);
}

// Fetch and display release history table
async function fetchReleases() {
  const app = appSelect.value;
  const platform = platformSelect.value;
  const deployment = deploymentSelect.value;

  if (!app || !platform || !deployment) {
    releasesTbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">Please select Application, Platform, and Deployment to view releases.</td>
      </tr>
    `;
    resultsCount.textContent = '0 releases found';
    return;
  }

  try {
    releasesTbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">Loading releases...</td>
      </tr>
    `;

    const url = `/api/releases?appName=${encodeURIComponent(app)}&platform=${platform}&deploymentName=${deployment}`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (!res.ok) throw new Error('Failed to fetch releases');

    const data = await res.json();
    const releases = data.releases || [];

    renderReleasesTable(releases);
  } catch (error) {
    console.error('Failed to fetch releases:', error);
    releasesTbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state" style="color: var(--color-danger)">Error loading releases. Check server logs.</td>
      </tr>
    `;
  }
}

// Render release rows in the table
function renderReleasesTable(releases) {
  resultsCount.textContent = `${releases.length} releases found`;

  if (releases.length === 0) {
    releasesTbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-state">No releases deployed for this configuration. Use CLI to upload.</td>
      </tr>
    `;
    return;
  }

  releasesTbody.innerHTML = '';
  
  releases.forEach(rel => {
    const tr = document.createElement('tr');
    
    const sizeStr = formatBytes(rel.size);
    const dateStr = new Date(rel.createdAt).toLocaleString();
    const shortHash = rel.packageHash.substring(0, 10);
    const mandatoryClass = rel.isMandatory ? 'yes' : 'no';
    const mandatoryText = rel.isMandatory ? 'Yes' : 'No';

    tr.innerHTML = `
      <td><strong>${escapeHtml(rel.appVersion)}</strong></td>
      <td>
        <div class="hash-cell" onclick="copyToClipboard('${escapeHtml(rel.packageHash)}')">
          <span>${escapeHtml(shortHash)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </div>
      </td>
      <td><span class="mandatory-badge ${mandatoryClass}">${mandatoryText}</span></td>
      <td>${sizeStr}</td>
      <td>${dateStr}</td>
      <td>${escapeHtml(rel.description || '—')}</td>
      <td>
        <a href="${rel.downloadPath}" class="action-btn" title="Download ZIP package" download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </a>
      </td>
    `;
    
    releasesTbody.appendChild(tr);
  });
}

// Copy package SHA256 hash to clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}

// Helper: Format bytes to KB/MB
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Auth UI helpers
function showLoginOverlay() {
  const loginOverlay = document.getElementById('login-overlay');
  loginOverlay.style.display = 'flex';
  
  const loginForm = document.getElementById('login-form');
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error-msg');
    
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Login failed');
      }
      
      const data = await res.json();
      localStorage.setItem('token', data.token);
      userToken = data.token;
      
      errorMsg.style.display = 'none';
      
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect');
      if (redirect) {
        window.location.href = redirect;
      } else {
        init();
      }
    } catch (err) {
      errorMsg.textContent = err.message || 'Invalid username or password.';
      errorMsg.style.display = 'block';
    }
  };
}

function hideLoginOverlay() {
  const loginOverlay = document.getElementById('login-overlay');
  loginOverlay.style.display = 'none';
}

function showUserProfile() {
  const userProfilePanel = document.getElementById('user-profile-panel');
  const usernameDisplay = document.getElementById('username-display');
  const roleBadge = document.getElementById('role-badge');
  
  usernameDisplay.textContent = currentUser.username;
  roleBadge.textContent = currentUser.role;
  
  userProfilePanel.style.display = 'flex';
}

function setupAuthListeners() {
  const logoutBtn = document.getElementById('logout-btn');

  const newLogoutBtn = logoutBtn.cloneNode(true);
  logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
  newLogoutBtn.addEventListener('click', logout);
}

function logout() {
  localStorage.removeItem('token');
  userToken = null;
  currentUser = null;

  // Reset to dashboard section
  showSection('dashboard');
  const userProfilePanel = document.getElementById('user-profile-panel');
  userProfilePanel.style.display = 'none';
  
  // Reset select elements
  appSelect.innerHTML = '<option value="">Select App</option>';
  platformSelect.innerHTML = '<option value="">Select Platform</option>';
  deploymentSelect.innerHTML = '<option value="">Select Deployment</option>';
  releasesTbody.innerHTML = `
    <tr>
      <td colspan="7" class="empty-state">Please select Application, Platform, and Deployment to view releases.</td>
    </tr>
  `;
  resultsCount.textContent = '0 releases found';
  
  // Reset statistics cards
  statApps.textContent = '0';
  statReleases.textContent = '0';
  statPlatforms.textContent = '0';
  
  showLoginOverlay();
}

// ─── Section Navigation ───────────────────────────────
function showSection(name) {
  // Update nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navEl = document.getElementById(`nav-${name}`);
  if (navEl) navEl.classList.add('active');

  const dashboardSection = document.getElementById('section-dashboard');
  const tokensSection    = document.getElementById('section-tokens');

  if (name === 'dashboard') {
    if (dashboardSection) dashboardSection.style.display = '';
    if (tokensSection) tokensSection.style.display = 'none';
  } else if (name === 'tokens') {
    if (dashboardSection) dashboardSection.style.display = 'none';
    if (tokensSection) tokensSection.style.display = '';
    loadTokens();
  }
}

// ─── Token Management ────────────────────────────────

async function loadTokens() {
  const tbody = document.getElementById('tokens-tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" class="empty-state">Loading...</td></tr>`;
  document.getElementById('tokens-new-banner').style.display = 'none';

  try {
    const res = await fetch('/api/tokens', {
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (!res.ok) throw new Error('Failed to fetch tokens');
    const data = await res.json();
    renderTokensTable(data.tokens || []);
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state" style="color:var(--color-danger)">Error loading tokens.</td></tr>`;
  }
}

function maskToken(token) {
  if (!token || token.length < 10) return '••••••••••••';
  return token.substring(0, 6) + '••••••••••••' + token.substring(token.length - 4);
}

function renderTokensTable(tokens) {
  const tbody = document.getElementById('tokens-tbody');
  if (tokens.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No tokens yet. Click "New Token" to create one.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  tokens.forEach(t => {
    const tr = document.createElement('tr');
    const dateStr = new Date(t.createdAt).toLocaleString();
    tr.innerHTML = `
      <td><span class="token-masked">${escapeHtml(maskToken(t.token))}</span></td>
      <td>${dateStr}</td>
      <td>
        <button class="btn-delete-token" data-id="${t.id}" title="Revoke token">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </td>
    `;
    tr.querySelector('.btn-delete-token').addEventListener('click', () => confirmDeleteToken(t.id));
    tbody.appendChild(tr);
  });
}

async function createNewToken() {
  const btn = document.getElementById('create-token-btn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  try {
    const res = await fetch('/api/tokens', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error('Failed to create token');
    const data = await res.json();

    // Show the new token banner (one-time reveal)
    const banner = document.getElementById('tokens-new-banner');
    const input  = document.getElementById('tokens-new-value');
    input.value = data.token;
    banner.style.display = 'block';

    // Reload the list
    await loadTokens();
    // Re-show banner (loadTokens hides it)
    banner.style.display = 'block';
    input.value = data.token;

    showToast('Token created! Copy it now — it won\'t be shown again.');
  } catch (err) {
    console.error(err);
    showToast('Failed to create token.', true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Token`;
  }
}

function confirmDeleteToken(tokenId) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal">
      <h3>Revoke Token?</h3>
      <p>This token will be permanently deleted and any CLI using it will lose access immediately.</p>
      <div class="confirm-modal-actions">
        <button class="btn-modal-cancel" id="modal-cancel-btn">Cancel</button>
        <button class="btn-modal-delete" id="modal-delete-btn">Revoke</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#modal-cancel-btn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#modal-delete-btn').addEventListener('click', async () => {
    overlay.remove();
    await deleteToken(tokenId);
  });
}

async function deleteToken(tokenId) {
  try {
    const res = await fetch(`/api/tokens/${tokenId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    if (!res.ok) throw new Error('Delete failed');
    showToast('Token revoked.');
    loadTokens();
  } catch (err) {
    console.error(err);
    showToast('Failed to revoke token.', true);
  }
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.style.background = isError ? 'var(--color-danger)' : 'var(--color-success)';
  toast.style.boxShadow  = isError
    ? '0 10px 30px rgba(239,68,68,0.3)'
    : '0 10px 30px rgba(16,185,129,0.3)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

function setupTokenListeners() {
  const createBtn = document.getElementById('create-token-btn');
  if (createBtn) {
    const newBtn = createBtn.cloneNode(true);
    createBtn.parentNode.replaceChild(newBtn, createBtn);
    newBtn.addEventListener('click', createNewToken);
  }

  const copyBtn = document.getElementById('tokens-copy-btn');
  if (copyBtn) {
    const newCopyBtn = copyBtn.cloneNode(true);
    copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
    newCopyBtn.addEventListener('click', () => {
      const val = document.getElementById('tokens-new-value').value;
      if (!val) return;
      navigator.clipboard.writeText(val).then(() => showToast('Token copied!'));
    });
  }
}

// Run init on load
window.addEventListener('DOMContentLoaded', init);
