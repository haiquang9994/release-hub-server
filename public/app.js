// State management
let summaryData = {
  totalReleases: 0,
  apps: [],
  platforms: [],
  deployments: [],
  recentReleases: []
};

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
  try {
    const res = await fetch('/api/dashboard-summary');
    if (!res.ok) throw new Error('Failed to fetch summary');
    
    const data = await res.json();
    summaryData = data.summary;
    
    updateStats();
    populateDropdowns();
    setupListeners();
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
    const res = await fetch(url);
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
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
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

// Run init on load
window.addEventListener('DOMContentLoaded', init);
