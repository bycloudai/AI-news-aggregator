// DOM Elements
const newsFeed = document.getElementById('news-feed');
const loading = document.getElementById('loading');
const emptyState = document.getElementById('empty-state');
const refreshBtn = document.getElementById('refresh-btn');
const manageSourcesBtn = document.getElementById('manage-sources-btn');
const sourcesModal = document.getElementById('sources-modal');
const closeModalBtn = document.getElementById('close-modal');
const addSourceForm = document.getElementById('add-source-form');
const blogSourcesEl = document.getElementById('blog-sources');
const twitterSourcesEl = document.getElementById('twitter-sources');
const lastUpdatedEl = document.getElementById('last-updated');
const newsCountEl = document.getElementById('news-count');

// State
let news = [];
let sources = { blogs: [], twitter: [] };

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadNews();
  loadSources();
  setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
  refreshBtn.addEventListener('click', refreshNews);
  manageSourcesBtn.addEventListener('click', () => openModal());
  closeModalBtn.addEventListener('click', () => closeModal());
  sourcesModal.addEventListener('click', (e) => {
    if (e.target === sourcesModal) closeModal();
  });
  addSourceForm.addEventListener('submit', handleAddSource);
  
  // Show/hide handle field based on source type
  document.getElementById('source-type').addEventListener('change', (e) => {
    const handleInput = document.getElementById('source-handle');
    handleInput.style.display = e.target.value === 'twitter' ? 'block' : 'none';
  });
}

// Load cached news
async function loadNews() {
  try {
    const response = await fetch('/api/news');
    const data = await response.json();
    
    news = data.news || [];
    renderNews();
    
    if (data.lastUpdated) {
      updateLastUpdated(data.lastUpdated);
    }
  } catch (error) {
    console.error('Error loading news:', error);
    showEmptyState();
  }
}

// Refresh news from sources
async function refreshNews() {
  refreshBtn.disabled = true;
  refreshBtn.innerHTML = '<span class="btn-icon">↻</span> Refreshing...';
  
  try {
    const response = await fetch('/api/news/refresh', { method: 'POST' });
    const data = await response.json();
    
    news = data.news || [];
    renderNews();
    updateLastUpdated(data.lastUpdated);
  } catch (error) {
    console.error('Error refreshing news:', error);
    alert('Failed to refresh news. Please try again.');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.innerHTML = '<span class="btn-icon">↻</span> Refresh';
  }
}

// Render news items
function renderNews() {
  loading.style.display = 'none';
  
  if (news.length === 0) {
    showEmptyState();
    return;
  }
  
  emptyState.style.display = 'none';
  
  // Remove existing news items (keep loading and empty state)
  const existingItems = newsFeed.querySelectorAll('.news-item');
  existingItems.forEach(item => item.remove());
  
  // Add news items
  news.forEach(item => {
    const newsEl = createNewsElement(item);
    newsFeed.appendChild(newsEl);
  });
  
  newsCountEl.textContent = `${news.length} items`;
}

// Create a news item element
function createNewsElement(item) {
  const el = document.createElement('div');
  el.className = 'news-item';
  
  const badgeClass = item.sourceType === 'twitter' ? 'twitter' : 'blog';
  const sourceName = item.sourceType === 'twitter' && item.handle 
    ? item.handle 
    : item.source;
  
  el.innerHTML = `
    <span class="news-source-badge ${badgeClass}">${sourceName}</span>
    <a href="${item.url}" target="_blank" rel="noopener" class="news-title" title="${escapeHtml(item.title)}">
      ${escapeHtml(item.title)}
    </a>
    <span class="news-time">${formatDate(item.date)}</span>
  `;
  
  return el;
}

// Show empty state
function showEmptyState() {
  loading.style.display = 'none';
  emptyState.style.display = 'block';
  newsCountEl.textContent = '0 items';
}

// Update last updated timestamp
function updateLastUpdated(timestamp) {
  const date = new Date(timestamp);
  lastUpdatedEl.textContent = `Last updated: ${date.toLocaleString()}`;
}

// Load sources
async function loadSources() {
  try {
    const response = await fetch('/api/sources');
    sources = await response.json();
    renderSources();
  } catch (error) {
    console.error('Error loading sources:', error);
  }
}

// Render sources in modal
function renderSources() {
  blogSourcesEl.innerHTML = sources.blogs.map(source => createSourceElement(source)).join('');
  twitterSourcesEl.innerHTML = sources.twitter.map(source => createSourceElement(source)).join('');
  
  // Add event listeners for toggles and delete buttons
  document.querySelectorAll('.source-toggle').forEach(toggle => {
    toggle.addEventListener('change', handleToggleSource);
  });
  
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', handleDeleteSource);
  });
}

// Create source element HTML
function createSourceElement(source) {
  const handleDisplay = source.handle ? `<span class="source-handle">${source.handle}</span>` : '';
  const isPlaceholder = source.url === 'PLACEHOLDER_RSS_URL' || source.url === 'PLACEHOLDER_URL';
  
  return `
    <div class="source-item" data-id="${source.id}">
      <div class="source-info">
        <span class="source-name">${escapeHtml(source.name)}</span>
        ${handleDisplay}
        ${isPlaceholder ? '<span class="source-handle">(needs RSS URL)</span>' : ''}
      </div>
      <div class="source-actions">
        <label class="toggle">
          <input type="checkbox" class="source-toggle" data-id="${source.id}" ${source.enabled ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-delete" data-id="${source.id}" title="Delete source">🗑</button>
      </div>
    </div>
  `;
}

// Handle adding a new source
async function handleAddSource(e) {
  e.preventDefault();
  
  const type = document.getElementById('source-type').value;
  const name = document.getElementById('source-name').value;
  const url = document.getElementById('source-url').value;
  const handle = document.getElementById('source-handle').value;
  
  try {
    const response = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, name, url, handle })
    });
    
    if (response.ok) {
      addSourceForm.reset();
      await loadSources();
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to add source');
    }
  } catch (error) {
    console.error('Error adding source:', error);
    alert('Failed to add source');
  }
}

// Handle toggling a source
async function handleToggleSource(e) {
  const id = e.target.dataset.id;
  const enabled = e.target.checked;
  
  try {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
  } catch (error) {
    console.error('Error toggling source:', error);
    e.target.checked = !enabled; // Revert on error
  }
}

// Handle deleting a source
async function handleDeleteSource(e) {
  const id = e.target.dataset.id;
  
  if (!confirm('Are you sure you want to delete this source?')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/sources/${id}`, { method: 'DELETE' });
    
    if (response.ok) {
      await loadSources();
    } else {
      alert('Failed to delete source');
    }
  } catch (error) {
    console.error('Error deleting source:', error);
    alert('Failed to delete source');
  }
}

// Modal functions
function openModal() {
  sourcesModal.classList.add('active');
  loadSources();
}

function closeModal() {
  sourcesModal.classList.remove('active');
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateString) {
  // Use current date if no date provided
  const date = dateString ? new Date(dateString) : new Date();
  if (isNaN(date.getTime())) {
    const now = new Date();
    return formatDateObj(now);
  }
  return formatDateObj(date);
}

function formatDateObj(date) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const month = months[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  
  return `${month} ${day}, ${year}`;
}
