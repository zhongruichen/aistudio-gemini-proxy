/**
 * Gemini Proxy Monitor
 * Logic for data fetching, UI updates, and interactions.
 */

// State
let autoRefresh = true;
let currentTab = 'all';
let requestLogs = [];
let filteredLogs = [];
let currentPage = 1;
let pageSize = 15;
let searchQuery = '';
let analyticsLogs = [];
let connectionDetailsCache = {};
let serverStartTime = null;
let chartInstances = {};
let latestStats = null;
let analyticsMetric = 'cost';
let responseViewMode = 'preview';
let requestViewMode = 'preview';
let currentRequestBody = null;
let currentResponseBody = null;
let filterStartDate = null;
let filterEndDate = null;
let analyticsStartDate = null;
let analyticsEndDate = null;
let currentSection = 'dashboard';

// Gallery State
let currentGalleryTab = 'request';
let galleryImages = [];
let currentGalleryPage = 1;
let galleryPageSize = 24;
let galleryStartDate = null;
let galleryEndDate = null;
let gallerySearchQuery = '';

// Real-time Throughput Data
let throughputTimes = [];
let throughputValues = [];
const MAX_THROUGHPUT_POINTS = 60;
let lastTotalTokens = 0;
let lastCheckTime = Date.now();

const HEARTBEAT_WARN_MS = 30000;
const HEARTBEAT_DEAD_MS = 60000;

// Terminal State
let terminalPaused = false;
const MAX_TERMINAL_LINES = 100;
let logEventSource = null;

// --- Initialization ---

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavigation();
  initCharts();
  initTerminal();

  // Event Listeners
  const autoRefreshToggle = document.getElementById('auto-refresh');
  if (autoRefreshToggle) {
    autoRefreshToggle.addEventListener('change', (e) => {
      autoRefresh = e.target.checked;
    });
  }

  loadConfig();
  updateStrategyDescription();
  refreshAll();

  setInterval(() => {
    if (autoRefresh) {
      refreshAll();
    }
    updateUptime();
  }, 3000);
});

// --- Navigation ---

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const section = item.dataset.section;
      if (section === 'proxy-web') {
        try {
          const res = await fetchJson('/get-proxy-url');
          if (res.url) {
            window.open(res.url, '_blank');
          } else {
            alert('未找到代理网页链接 (proxy-config.txt)');
          }
        } catch (e) {
          console.error(e);
          alert('获取链接失败');
        }
        return;
      }
      if (section) {
        switchSection(section);
      }
    });
  });
}

function switchSection(sectionId) {
  currentSection = sectionId;
  
  // Update Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionId);
  });

  // Update View
  document.querySelectorAll('.view-section').forEach(el => {
    el.classList.remove('active');
  });
  const target = document.getElementById(`view-${sectionId}`);
  if (target) {
    target.classList.add('active');
  }
  
  // Update Title
  const titleMap = {
    'dashboard': '仪表盘',
    'terminal': '实时终端',
    'analytics': '数据分析',
    'logs': '请求日志',
    'connections': '连接管理',
    'gallery': '图片库',
    'settings': '系统设置'
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titleMap[sectionId] || 'Monitor';

  // Resize charts if entering analytics or dashboard
  if (sectionId === 'analytics' || sectionId === 'dashboard') {
    setTimeout(resizeCharts, 100);
  }
  
  if (sectionId === 'gallery') {
    rebuildImageIndex(true);
  }
}

// --- Gallery Logic ---

let galleryTotal = 0;
// galleryPageSize moved to top

function switchGalleryTab(tab) {
  currentGalleryTab = tab;
  currentGalleryPage = 1;
  refreshGallery();
}

async function refreshGallery() {
  const grid = document.getElementById('gallery-grid');
  if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">加载中...</div>';

  try {
    const params = new URLSearchParams({
      page: currentGalleryPage,
      pageSize: galleryPageSize,
      type: currentGalleryTab
    });
    
    if (galleryStartDate) params.append('startDate', galleryStartDate);
    if (galleryEndDate) params.append('endDate', galleryEndDate);
    if (gallerySearchQuery) params.append('search', gallerySearchQuery);

    const res = await fetchJson(`/gallery-images?${params.toString()}`);
    galleryImages = res.items;
    galleryTotal = res.total;
    
    renderGallery();
  } catch (error) {
    console.error('Failed to load gallery images:', error);
    if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">加载失败</div>';
  }
}

function setGalleryDatePreset(preset) {
  applyDatePreset('gallery-start-date', 'gallery-end-date', preset);
  onGalleryDateFilterChange();
}

function onGalleryDateFilterChange() {
  galleryStartDate = document.getElementById('gallery-start-date').value || null;
  galleryEndDate = document.getElementById('gallery-end-date').value || null;
  currentGalleryPage = 1;
  refreshGallery();
}

function onGallerySearchInput() {
  gallerySearchQuery = document.getElementById('gallery-search').value.trim().toLowerCase();
  currentGalleryPage = 1;
  refreshGallery();
}

function onGalleryPageSizeChange() {
  galleryPageSize = Number(document.getElementById('gallery-page-size').value) || 24;
  currentGalleryPage = 1;
  refreshGallery();
}

function resetGalleryFilters() {
  document.getElementById('gallery-start-date').value = '';
  document.getElementById('gallery-end-date').value = '';
  document.getElementById('gallery-search').value = '';
  document.getElementById('gallery-page-size').value = '24';
  
  galleryStartDate = null;
  galleryEndDate = null;
  gallerySearchQuery = '';
  galleryPageSize = 24;
  currentGalleryPage = 1;
  
  refreshGallery();
}

async function rebuildImageIndex(silent = false) {
  if (!silent && !confirm('重建索引可能需要几分钟时间，确定要继续吗？')) return;
  
  const grid = document.getElementById('gallery-grid');
  if (grid && silent) {
      grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">正在更新索引...</div>';
  }

  try {
    const res = await fetchJson('/rebuild-image-index', { method: 'POST' });
    if (res.success) {
      if (!silent) alert(`索引重建完成，共找到 ${res.count} 张图片`);
      refreshGallery();
    } else {
      if (!silent) alert('索引重建失败');
      else console.error('索引重建失败');
    }
  } catch (e) {
    console.error(e);
    if (!silent) alert('请求失败');
  }
}

function changeGalleryPage(delta) {
  const maxPage = Math.ceil(galleryTotal / galleryPageSize) || 1;
  const newPage = currentGalleryPage + delta;
  if (newPage >= 1 && newPage <= maxPage) {
    currentGalleryPage = newPage;
    refreshGallery();
  }
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  const pagination = document.getElementById('gallery-pagination');
  if (!grid) return;

  const maxPage = Math.ceil(galleryTotal / galleryPageSize) || 1;
  
  if (pagination) {
    if (galleryTotal > 0) {
      pagination.style.display = 'flex';
      const start = (currentGalleryPage - 1) * galleryPageSize + 1;
      const end = Math.min(currentGalleryPage * galleryPageSize, galleryTotal);
      document.getElementById('gallery-pagination-info').textContent = `显示 ${start}-${end} 共 ${galleryTotal} 张`;
      document.getElementById('btn-gallery-prev').disabled = currentGalleryPage <= 1;
      document.getElementById('btn-gallery-next').disabled = currentGalleryPage >= maxPage;
    } else {
      pagination.style.display = 'none';
    }
  }

  if (galleryImages.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">暂无图片</div>';
    return;
  }

  grid.innerHTML = galleryImages.map(img => {
    const timeStr = formatTime(img.timestamp);
    const modelName = normalizeModelName(img.model);
    // Use the new image serving endpoint
    const imgSrc = `/gallery-image/${img.requestId}/${img.type}/${img.index}`;
    
    return `
      <div class="gallery-item">
        <div class="gallery-image-container" onclick="openLightbox('${imgSrc}', '${img.requestId}', '${img.type}', '${img.model}', '${img.timestamp}')">
          <img src="${imgSrc}" class="gallery-image" loading="lazy" alt="Gallery Image">
        </div>
        <div class="gallery-meta">
          <div class="gallery-meta-row">
            <span>时间</span>
            <span class="gallery-meta-val">${timeStr}</span>
          </div>
          <div class="gallery-meta-row">
            <span>模型</span>
            <span class="gallery-meta-val">${modelName}</span>
          </div>
          <div class="gallery-meta-row">
            <span>ID</span>
            <span class="gallery-meta-val" style="cursor:pointer; color:var(--primary);" onclick="viewRequestDetail('${img.requestId}')">${img.requestId.substring(0, 8)}...</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Lightbox ---

function openLightbox(src, requestId, type, model, timestamp) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-image');
  const timeEl = document.getElementById('lightbox-time');
  const modelEl = document.getElementById('lightbox-model');
  const typeEl = document.getElementById('lightbox-type');
  const idEl = document.getElementById('lightbox-id');
  const downloadBtn = document.getElementById('lightbox-download');

  if (!modal || !img) return;

  img.src = src;
  timeEl.textContent = formatTime(Number(timestamp));
  modelEl.textContent = normalizeModelName(model);
  typeEl.textContent = type === 'request' ? '上传 (Request)' : '响应 (Response)';
  idEl.textContent = requestId;
  idEl.dataset.requestId = requestId; // Store for click handler
  
  downloadBtn.href = src;
  downloadBtn.download = `gemini-image-${requestId}-${type}.png`;

  modal.classList.add('open');
}

function closeLightbox(event) {
  if (event) event.stopPropagation();
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.remove('open');
}

function viewRequestDetailFromLightbox() {
  const idEl = document.getElementById('lightbox-id');
  if (idEl && idEl.dataset.requestId) {
    closeLightbox();
    viewRequestDetail(idEl.dataset.requestId);
  }
}

// --- Theme Management ---

function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  updateThemeIcon(newTheme);
  renderModelAnalytics(analyticsLogs);
}

function updateThemeIcon(theme) {
  const sunIcon = document.getElementById('icon-sun');
  const moonIcon = document.getElementById('icon-moon');
  if (sunIcon && moonIcon) {
    if (theme === 'light') {
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    } else {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    }
  }
}

// --- Data Fetching & Refresh ---

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function refreshAll() {
  try {
    const [, , , , analytics] = await Promise.all([
      refreshPoolStatus(),
      refreshStats(),
      refreshConnections(),
      refreshRequestLogs(false),
      refreshAnalyticsLogs(false),
      refreshQuotaOverview()
    ]);
    displayRequestLogs();
    updateActivityFeed();
    renderModelAnalytics(analytics || analyticsLogs);
    setServiceStatus('服务运行中', true);
  } catch (error) {
    console.error('刷新数据失败:', error);
    setServiceStatus('连接服务器失败', false);
    logToTerminal('ERROR', `Connection failed: ${error.message}`);
  }
}

function setServiceStatus(text, ok = true) {
  const el = document.getElementById('service-status');
  if (el) {
    el.className = ok ? 'status-pill' : 'status-pill error';
    const span = el.querySelector('span:last-child');
    if (span) span.textContent = text;
  }
}

async function refreshPoolStatus() {
  const data = await fetchJson('/pool-stats');
  animateValue('pool-total', data.total ?? 0);
  animateValue('pool-active', data.active ?? 0);
  animateValue('pool-connecting', data.connecting ?? 0);
  animateValue('pool-closed', data.closed ?? 0);
  animateValue('pool-error', data.error ?? 0);
  animateValue('pool-total-requests', data.totalRequests ?? 0);
  animateValue('active-connections', data.active ?? 0);
  return data;
}

let quotaResetTimer = null;

async function refreshQuotaOverview() {
  const data = await fetchJson('/quota-overview');
  window.quotaConfig = data.config; // 保存配置到全局变量
  renderQuotaOverview(data.overview);
  startResetCountdown(data.nextResetTime, data.serverTime);
  return data;
}

function startResetCountdown(targetTime, serverTime) {
  if (quotaResetTimer) clearInterval(quotaResetTimer);
  
  const el = document.getElementById('quota-reset-countdown');
  if (!el) return;

  const offset = Date.now() - serverTime;
  const target = targetTime + offset;

  const update = () => {
    const now = Date.now();
    const diff = target - now;
    if (diff <= 0) {
      el.textContent = '00:00:00';
      refreshQuotaOverview(); // Refresh when time is up
      return;
    }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  
  update();
  quotaResetTimer = setInterval(update, 1000);
}

function renderQuotaOverview(overview) {
  const container = document.getElementById('quota-overview-grid');
  if (!container) return;

  if (!overview || Object.keys(overview).length === 0) {
    container.innerHTML = '<div class="empty-state">暂无额度数据</div>';
    return;
  }

  container.innerHTML = Object.entries(overview).map(([groupId, data]) => {
    const totalLimit = data.totalLimit || 0;
    const totalUsed = data.totalUsed || 0;
    const remaining = Math.max(0, totalLimit - totalUsed);
    const percent = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
    let color = 'var(--success)';
    if (percent > 80) color = 'var(--warning)';
    if (percent >= 100) color = 'var(--danger)';

    return `
      <div class="stat-card" style="padding: 16px;" title="额度为预估值，可能会有小幅波动">
        <div class="stat-label" style="font-size: 12px; margin-bottom: 4px; display:flex; justify-content:space-between;">
            <span>${groupId.replace('group_', '').replace(/_/g, '-').toUpperCase()}</span>
            <span style="cursor:help;">ℹ️</span>
        </div>
        <div class="stat-value" style="font-size: 20px; color: ${color};">${formatNumber(remaining)} <span style="font-size: 12px; color: var(--text-muted);">剩余 / ${formatNumber(totalLimit)} 总共</span></div>
        <div class="progress-bar" style="height: 6px; background: rgba(255,255,255,0.1); margin-top: 8px; border-radius: 3px; overflow: hidden;">
          <div style="width: ${percent}%; height: 100%; background: ${color}; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function refreshStats() {
  const stats = await fetchJson('/request-stats');
  latestStats = stats;
  serverStartTime = Date.now() - (stats.uptime || 0);

  animateValue('total-requests', stats.totalRequests || 0);
  
  const modelCalls = getModelCallSummary(stats.modelStats || {});
  animateValue('total-model-calls', modelCalls.total);
  animateValue('model-success-calls', modelCalls.success);
  animateValue('model-error-calls', modelCalls.error);
  
  animateValue('prompt-tokens', stats.totalPromptTokens || 0);
  animateValue('completion-tokens', stats.totalCompletionTokens || 0);
  animateValue('total-tokens', stats.totalTokens || 0);
  updateText('total-cost', formatUsd(stats.totalCostUsd || 0));

  // Update Throughput
  const now = Date.now();
  const currentTotalTokens = stats.totalTokens || 0;
  
  if (lastTotalTokens > 0) {
    const timeDiff = (now - lastCheckTime) / 1000; // seconds
    if (timeDiff > 0) {
      const tokenDiff = currentTotalTokens - lastTotalTokens;
      const tps = Math.max(0, Math.round(tokenDiff / timeDiff));
      updateThroughputChart(now, tps);
    }
  }
  lastTotalTokens = currentTotalTokens;
  lastCheckTime = now;

  const period = stats.periodUsage || {};
  const updatePeriodStats = (prefix, data) => {
    animateValue(`${prefix}-calls`, data.totalCalls || 0);
    animateValue(`${prefix}-tokens`, data.totalTokens || 0);
    updateText(`${prefix}-cost`, formatUsd(data.totalCostUsd || 0));
  };

  updatePeriodStats('daily', period.today || {});
  
  // Update main dashboard daily stats
  animateValue('daily-calls-main', period.today?.totalCalls || 0);
  updateText('daily-cost-main', formatUsd(period.today?.totalCostUsd || 0));
  updatePeriodStats('yesterday', period.yesterday || {});
  updatePeriodStats('weekly', period.week || {});
  updatePeriodStats('last-week', period.lastWeek || {});
  updatePeriodStats('monthly', period.month || {});
  updatePeriodStats('last-month', period.lastMonth || {});

  const successRate = stats.successRate ?? (stats.totalRequests
    ? (stats.successRequests / stats.totalRequests) * 100
    : 0);
  updateText('success-rate', `${successRate.toFixed(1)}%`);

  const avgResponse = stats.avgResponseTime ?? 0;
  updateText('avg-response', `${Math.round(avgResponse)}ms`);

  animateValue('rate-limit-errors', stats.rateLimitErrors ?? 0);
  
  updateUptime();
  renderModelStats(stats.modelStats || {});
  return stats;
}

async function refreshConnections() {
  const connections = await fetchJson('/connection-details');
  displayConnections(connections);
  return connections;
}

async function refreshRequestLogs(shouldRender = true) {
  const params = new URLSearchParams();
  if (filterStartDate) params.append('startDate', filterStartDate);
  if (filterEndDate) params.append('endDate', filterEndDate);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson(`/request-logs${query}`);
  
  // Removed manual terminal feeding in favor of SSE stream

  requestLogs = Array.isArray(data) ? data : [];
  if (shouldRender) {
    displayRequestLogs();
    updateActivityFeed();
  }
  return data;
}

async function refreshAnalyticsLogs(shouldRender = true) {
  const params = new URLSearchParams();
  if (analyticsStartDate) params.append('startDate', analyticsStartDate);
  if (analyticsEndDate) params.append('endDate', analyticsEndDate);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await fetchJson(`/request-logs${query}`);
  analyticsLogs = Array.isArray(data) ? data : [];
  if (shouldRender) {
    renderModelAnalytics(analyticsLogs);
  }
  return data;
}

// --- UI Helpers ---

function updateText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function animateValue(id, end, duration = 800) {
  const obj = document.getElementById(id);
  if (!obj) return;
  
  // Handle "K" / "M" formatting if needed, but for now assume raw numbers for animation
  // If the element has non-numeric content, skip animation or parse it
  let start = parseInt(obj.textContent.replace(/,/g, '').replace(/[^0-9]/g, ''), 10);
  if (isNaN(start)) start = 0;
  
  // If change is small, just update
  if (start === end) return;

  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);
    obj.textContent = formatNumber(value);
    if (progress < 1) {
      window.requestAnimationFrame(step);
    } else {
      obj.textContent = formatNumber(end);
      // Trigger glitch effect on change
      obj.classList.remove('glitch-text');
      void obj.offsetWidth; // trigger reflow
      obj.classList.add('glitch-text');
      obj.setAttribute('data-text', formatNumber(end));
    }
  };
  window.requestAnimationFrame(step);
}

function formatNumber(num) {
  const n = Number(num) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function formatUsd(num) {
  const n = Number(num) || 0;
  if (n >= 1) return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function formatDuration(ms) {
  if (ms <= 0) return '已过期';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}小时${minutes.toString().padStart(2, '0')}分`;
  if (minutes > 0) return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

function formatTime(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '-';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return '-';
  }
}

function updateUptime() {
  if (!serverStartTime) return;
  const seconds = Math.floor((Date.now() - serverStartTime) / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  updateText('uptime', parts.join(' '));
}

// --- Terminal Logic ---

function initTerminal() {
  if (logEventSource) {
    logEventSource.close();
  }

  logToTerminal('INFO', 'Connecting to real-time log stream...');
  
  logEventSource = new EventSource('/monitor/logs');
  
  logEventSource.onmessage = (event) => {
    try {
      const log = JSON.parse(event.data);
      logToTerminal(log.level, log.message, log.timestamp);
    } catch (e) {
      console.error('Error parsing log event', e);
    }
  };
  
  logEventSource.onerror = () => {
    if (logEventSource.readyState === EventSource.CLOSED) {
        logToTerminal('WARN', 'Log stream disconnected. Reconnecting in 5s...');
        setTimeout(initTerminal, 5000);
    }
  };
}

function logToTerminal(level, message, timestamp = null) {
  if (terminalPaused) return;
  
  const terminal = document.getElementById('terminal-window');
  if (!terminal) return;

  let tsStr;
  if (timestamp) {
      const d = new Date(timestamp);
      tsStr = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}.${d.getMilliseconds().toString().padStart(3,'0')}`;
  } else {
      const now = new Date();
      tsStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0')}`;
  }
  
  const line = document.createElement('div');
  line.className = 'terminal-line';
  line.innerHTML = `<span class="ts">[${tsStr}]</span> <span class="level ${level}">${level}</span> <span class="msg">${escapeHtml(message)}</span>`;
  
  terminal.appendChild(line);
  
  // Auto scroll
  terminal.scrollTop = terminal.scrollHeight;
  
  // Limit lines
  while (terminal.children.length > MAX_TERMINAL_LINES) {
    terminal.removeChild(terminal.firstChild);
  }
}

function clearTerminal() {
  const terminal = document.getElementById('terminal-window');
  if (terminal) terminal.innerHTML = '';
}

function toggleTerminalPause() {
  terminalPaused = !terminalPaused;
  const btn = document.getElementById('term-pause-btn');
  if (btn) {
    btn.textContent = terminalPaused ? '继续' : '暂停';
    btn.classList.toggle('active', terminalPaused);
  }
}

// --- Connections UI ---

function displayConnections(connections) {
  const container = document.getElementById('connections-list');
  if (!container) return;
  
  connectionDetailsCache = {};

  if (!connections || connections.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无活跃的 WebSocket 连接</div>';
    return;
  }

  container.innerHTML = connections.map((conn) => {
    connectionDetailsCache[conn.id] = conn.displayName || conn.id;
    const successRate = conn.requestCount > 0
      ? Math.round((conn.successCount / conn.requestCount) * 100)
      : 0;
    const heartbeat = getHeartbeatStatus(conn);

    // Render Quota Progress Bars
    const quotas = conn.quota || {};
    const quotaList = Object.entries(quotas).map(([groupId, q]) => {
        const used = q.used || 0;
        const limit = q.limit || 100;
        const percent = Math.min(100, (used / limit) * 100);
        let color = 'var(--success)';
        let statusText = `${used}/${limit}`;
        
        if (q.status === 'exhausted') {
            color = 'var(--danger)';
            statusText = '耗尽';
        } else if (q.status === 'cooldown') {
            color = 'var(--warning)';
            statusText = '冷却';
        } else if (percent > 80) {
            color = 'var(--warning)';
        }

        // 获取该组包含的模型列表
        let modelsList = '未知模型';
        let displayName = groupId.replace('group_', '').replace(/_/g, '-').toUpperCase();
        let resetTarget = 'unknown';
        
        if (window.quotaConfig && window.quotaConfig.groups && window.quotaConfig.groups[groupId]) {
            const models = window.quotaConfig.groups[groupId].models;
            modelsList = models.join('\n');
            // 使用第一个模型名称作为显示名称，更直观
            if (models.length > 0) {
                displayName = models[0].toUpperCase();
                if (models.length > 1) {
                    displayName += ' +';
                }
                resetTarget = models[0];
            }
        }
        
        return `
            <div class="quota-row" style="margin-top: 6px;" title="包含模型:\n${modelsList}\n\n已用: ${used} / 上限: ${limit}">
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); margin-bottom:2px;">
                    <span style="font-family:var(--font-mono); display:flex; align-items:center;">
                        ${displayName}
                        <button class="btn btn-xxs ghost btn-reset-model" onclick="clearCooldown('${conn.id}', '${resetTarget}')" title="重置此模型组状态">↺</button>
                    </span>
                    <span>${statusText}</span>
                </div>
                <div class="progress-bar" style="height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden;">
                    <div style="width: ${percent}%; height: 100%; background: ${color}; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `;
    }).join('');

    let statusBadge = '';
    if (conn.disabled) {
        statusBadge = '<span class="badge warn">已禁用</span>';
    } else if (conn.status === 'rate_limited') {
        statusBadge = '<span class="badge warn">429 限速</span>';
    } else if (conn.isConnected) {
        statusBadge = '<span class="badge success">活跃</span>';
    } else {
        statusBadge = '<span class="badge error">断开</span>';
    }

    return `
      <div class="connection-card ${conn.disabled ? 'disabled' : ''} ${conn.status === 'rate_limited' ? 'rate_limited' : ''}">
        <div class="conn-header">
          <div class="conn-title">
            <span style="width:8px; height:8px; background:${conn.isConnected ? 'var(--success)' : 'var(--danger)'}; border-radius:50%; box-shadow: 0 0 8px ${conn.isConnected ? 'var(--success)' : 'var(--danger)'};"></span>
            ${conn.displayName || conn.id}
            ${statusBadge}
          </div>
          <button class="btn btn-xs ${conn.disabled ? 'primary' : 'ghost'}" onclick="toggleConnection('${conn.id}', ${conn.disabled ? 'true' : 'false'})">
            ${conn.disabled ? '启用' : '禁用'}
          </button>
        </div>
        <div class="conn-heartbeat">
          <div class="hb-left">
            <span class="hb-dot" style="background:${heartbeat.color}; box-shadow: 0 0 8px ${heartbeat.color};"></span>
            <span>${heartbeat.label}</span>
          </div>
          <div class="hb-meta">
            <span>${heartbeat.sinceText}</span>
            ${heartbeat.latencyText ? `<span class="hb-latency" style="margin-left:8px; color:var(--text-muted);">${heartbeat.latencyText}</span>` : ''}
          </div>
        </div>
        <div class="conn-stats">
          <div class="conn-stat-item"><span>总请求</span><strong>${conn.requestCount || 0}</strong></div>
          <div class="conn-stat-item"><span>成功</span><strong>${conn.successCount || 0}</strong></div>
          <div class="conn-stat-item"><span>失败</span><strong>${conn.errorCount || 0}</strong></div>
          <div class="conn-stat-item"><span>429</span><strong>${conn.rateLimitCount || 0}</strong></div>
          <div class="conn-stat-item"><span>成功率</span><strong>${successRate}%</strong></div>
          <div class="conn-stat-item"><span>最近</span><strong>${conn.lastUsed ? new Date(conn.lastUsed).toLocaleTimeString() : '-'}</strong></div>
        </div>
        <div class="conn-quotas" style="margin-top:12px; padding-top:8px; border-top:1px solid var(--border-color);">
          <div class="conn-section-title" style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">额度状态</div>
          ${quotaList || '<div class="empty-state small">暂无额度信息</div>'}
          <button class="btn btn-xs ghost" style="margin-top:8px; width:100%;" onclick="clearCooldown('${conn.id}', 'all')">重置状态</button>
        </div>
      </div>
    `;
  }).join('');
}

function getHeartbeatStatus(conn) {
  const now = Date.now();
  const last = Number(conn.lastHeartbeat);
  const latency = Number(conn.heartbeatLatency);
  // 修复：Number(null) 为 0，会导致计算出巨大的 elapsed (1970年至今)，需确保 last > 0
  const hasHeartbeat = Number.isFinite(last) && last > 0;
  const elapsed = hasHeartbeat ? now - last : null;
  const latencyText = Number.isFinite(latency) ? `${Math.round(Math.max(latency, 0))}ms` : null;

  if (!conn.isConnected) {
    return {
      label: '已断开',
      color: 'var(--danger)',
      sinceText: hasHeartbeat ? `${formatDuration(Math.max(elapsed || 0, 1))}前` : '无心跳',
      latencyText
    };
  }

  if (!hasHeartbeat) {
    return {
      label: '等待心跳',
      color: 'var(--warning)',
      sinceText: '未收到',
      latencyText: null
    };
  }

  let color = 'var(--success)';
  let label = '心跳正常';
  if (elapsed > HEARTBEAT_DEAD_MS) {
    color = 'var(--danger)';
    label = '心跳超时';
  } else if (elapsed > HEARTBEAT_WARN_MS) {
    color = 'var(--warning)';
    label = '心跳延迟';
  }

  return {
    label,
    color,
    sinceText: `${formatDuration(Math.max(elapsed, 1))}前`,
    latencyText
  };
}

async function toggleConnection(connectionId, currentlyDisabled) {
  try {
    await fetchJson('/toggle-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, enable: currentlyDisabled })
    });
    refreshConnections();
    logToTerminal('INFO', `Connection ${connectionId} ${currentlyDisabled ? 'enabled' : 'disabled'}`);
  } catch (error) {
    console.error('切换连接失败:', error);
    alert('切换连接状态失败');
    logToTerminal('ERROR', `Failed to toggle connection ${connectionId}: ${error.message}`);
  }
}

async function clearCooldown(connectionId, model) {
  try {
    await fetchJson('/clear-cooldown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId, model })
    });
    refreshConnections();
    logToTerminal('INFO', `Cleared cooldown for ${connectionId} (${model})`);
  } catch (err) {
    console.error('解除冷却失败', err);
    logToTerminal('ERROR', `Failed to clear cooldown: ${err.message}`);
  }
}

// --- Logs UI ---

function updateActivityFeed() {
  const container = document.getElementById('activity-feed');
  if (!container) return;

  const now = Date.now();
  const tenMinutesAgo = now - 10 * 60 * 1000;

  // Filter logs: keep ONLY processing logs AND filter out "zombie" requests (older than 10 mins)
  const activeLogs = requestLogs.filter(log => {
    if (log.status !== 'processing') return false;
    const logTime = new Date(log.timestamp).getTime();
    return logTime > tenMinutesAgo;
  });

  // Use the first 20 logs from filtered list
  const recentLogs = activeLogs.slice(0, 20);

  if (recentLogs.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 20px; text-align: center; color: var(--text-muted);">等待请求...</div>';
    return;
  }

  container.innerHTML = recentLogs.map(log => {
    let statusClass = 'success';
    if (log.status === 'rate-limited') statusClass = 'rate-limited';
    else if (log.status !== 'success') statusClass = 'error';

    const time = formatTime(log.timestamp).split(' ')[1]; // HH:mm:ss
    const model = normalizeModelName(log.model, log.path);
    const tokens = log.totalTokens || (log.usage ? log.usage.total_tokens : 0) || 0;
    const cost = log.costUsd || (log.usage ? log.usage.costUsd : 0) || 0;

    return `
      <div class="activity-item ${statusClass}">
        <div class="activity-info">
          <div class="activity-model">${model}</div>
          <div class="activity-meta">${tokens} tokens · ${formatUsd(cost)}</div>
        </div>
        <div class="activity-time">${time}</div>
      </div>
    `;
  }).join('');
}

function displayRequestLogs(shouldFilter = true) {
  const tbody = document.getElementById('request-logs');
  if (!tbody) return;
  
  if (shouldFilter) {
    filteredLogs = requestLogs.filter((log) => {
      // Tab filter
      if (currentTab === 'success' && log.status !== 'success') return false;
      if (currentTab === 'processing' && log.status !== 'processing') return false;
      if (currentTab === 'error' && (log.status === 'success' || log.status === 'processing')) return false;
      
      // Search filter
      if (searchQuery) {
        const searchStr = [
          log.requestId,
          log.model,
          log.path,
          String(log.statusCode || '')
        ].join(' ').toLowerCase();
        if (!searchStr.includes(searchQuery)) return false;
      }
      return true;
    });
  }

  const total = filteredLogs.length;
  const maxPage = Math.ceil(total / pageSize) || 1;
  if (currentPage > maxPage) currentPage = maxPage;
  
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageItems = filteredLogs.slice(start, end);

  // Update Pagination UI
  const paginationEl = document.getElementById('pagination');
  if (paginationEl) {
    if (total > 0) {
      paginationEl.style.display = 'flex';
      document.getElementById('pagination-info').textContent = `显示 ${start + 1}-${end} 共 ${total} 条`;
      document.getElementById('btn-prev').disabled = currentPage <= 1;
      document.getElementById('btn-next').disabled = currentPage >= maxPage;
    } else {
      paginationEl.style.display = 'none';
    }
  }

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state" style="text-align:center; padding: 40px; color: var(--text-muted);">暂无请求日志</td></tr>';
    return;
  }

  tbody.innerHTML = pageItems.map((log) => {
    let statusBadge = '';
    const codeText = log.statusCode != null ? String(log.statusCode) : '';
    if (log.status === 'success') statusBadge = '<span class="badge success">Success</span>';
    else if (log.status === 'rate-limited' || codeText === '429') statusBadge = '<span class="badge warn">429</span>';
    else if (log.status === 'processing') statusBadge = '<span class="badge info">Processing</span>';
    else statusBadge = `<span class="badge error">${codeText || 'Error'}</span>`;
    const statusCodeLabel = codeText && log.status === 'success' ? `<div style="color:var(--text-muted); font-size:11px;">${codeText}</div>` : '';
    
    const shortId = log.requestId ? log.requestId.substring(0, 8) + '...' : '-';
    const path = log.path || '-';
    const modelName = normalizeModelName(log.model, log.path);
    const promptTokens = log.promptTokens ?? log.prompt_tokens ?? (log.usage && log.usage.prompt_tokens) ?? '-';
    const completionTokens = log.completionTokens ?? log.completion_tokens ?? (log.usage && log.usage.completion_tokens) ?? '-';
    const totalTokens = log.totalTokens ?? log.total_tokens ?? (log.usage && log.usage.total_tokens) ?? '-';
    const tokensText = `${promptTokens} / ${completionTokens} / ${totalTokens}`;
    const costUsd = log.costUsd ?? (log.usage && log.usage.costUsd) ?? null;
    const costText = costUsd != null ? formatUsd(costUsd) : '-';

    return `
      <tr>
        <td style="color:var(--text-muted); font-size:13px; white-space:nowrap;">${formatTime(log.timestamp)}</td>
        <td>
            <div style="font-family:var(--font-mono); font-size:13px; font-weight:600; color:var(--primary); cursor:pointer; display:inline-block;" onclick="copyText('${log.requestId}')" title="点击复制 ID">${shortId}</div>
            <div style="color:var(--text-muted); font-size:12px; margin-top:2px;">${path}</div>
        </td>
        <td><span class="badge neutral" style="font-family:var(--font-mono);">${modelName}</span></td>
        <td><div style="display:flex; flex-direction:column; gap:2px;">${statusBadge}${statusCodeLabel}</div></td>
        <td style="font-family:var(--font-mono);">${log.responseTime ? log.responseTime + 'ms' : '-'}</td>
        <td style="font-size:13px; font-family:var(--font-mono);">${tokensText}</td>
        <td style="font-family:var(--font-mono); font-weight:600; color:var(--success);">${costText}</td>
        <td><button class="btn ghost btn-xs" onclick="viewRequestDetail('${log.requestId}')">详情</button></td>
      </tr>
    `;
  }).join('');
}

function switchTab(tab) {
  currentTab = tab;
  currentPage = 1;
  displayRequestLogs();
}

function onSearchInput() {
  searchQuery = document.getElementById('log-search').value.trim().toLowerCase();
  currentPage = 1;
  displayRequestLogs();
}

function changePage(delta) {
  const maxPage = Math.ceil(filteredLogs.length / pageSize) || 1;
  const newPage = currentPage + delta;
  if (newPage >= 1 && newPage <= maxPage) {
    currentPage = newPage;
    displayRequestLogs(false);
  }
}

async function clearRequestLogs() {
  if (!confirm('确认清空日志？')) return;
  try {
    await fetchJson('/clear-logs', { method: 'POST' });
    requestLogs = [];
    displayRequestLogs();
    logToTerminal('INFO', 'Logs cleared by user.');
  } catch (error) {
    console.error('清空日志失败:', error);
    alert('清空日志失败');
  }
}

function resetLogFilters() {
  const startEl = document.getElementById('filter-start-date');
  const endEl = document.getElementById('filter-end-date');
  const searchEl = document.getElementById('log-search');

  if (startEl) startEl.value = '';
  if (endEl) endEl.value = '';
  if (searchEl) searchEl.value = '';

  filterStartDate = null;
  filterEndDate = null;
  searchQuery = '';
  
  refreshRequestLogs();
}

async function exportLogs() {
  const params = new URLSearchParams();
  if (filterStartDate) params.append('startDate', filterStartDate);
  if (filterEndDate) params.append('endDate', filterEndDate);
  
  const url = `/export-logs?${params.toString()}`;
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Export failed');
    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `gemini-proxy-logs-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
    logToTerminal('INFO', 'Logs exported successfully.');
  } catch (error) {
    console.error('导出失败:', error);
    alert('导出日志失败');
    logToTerminal('ERROR', `Log export failed: ${error.message}`);
  }
}

// --- Model Stats UI ---

function renderModelStats(modelStats) {
  const tbody = document.getElementById('model-stats');
  if (!tbody) return;

  const entries = Object.entries(modelStats || {});
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无数据</td></tr>';
    return;
  }

  const normalizedStats = {};
  entries.forEach(([model, data]) => {
    const name = normalizeModelName(model);
    if (name === 'unknown') return;
    if (!normalizedStats[name]) {
      normalizedStats[name] = {
        total: 0,
        success: 0,
        error: 0,
        totalTime: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0
      };
    }
    normalizedStats[name].total += data.total || 0;
    normalizedStats[name].success += data.success || 0;
    normalizedStats[name].error += data.error || 0;
    normalizedStats[name].totalTime += data.totalTime || 0;
    normalizedStats[name].promptTokens += data.promptTokens || 0;
    normalizedStats[name].completionTokens += data.completionTokens || 0;
    normalizedStats[name].totalTokens += data.totalTokens || 0;
    normalizedStats[name].totalCostUsd += data.totalCostUsd || 0;
  });

  tbody.innerHTML = Object.entries(normalizedStats).map(([name, data]) => {
    const total = data.total || 0;
    const success = data.success || 0;
    const error = data.error || 0;
    const successRate = total ? ((success / total) * 100).toFixed(1) : '0.0';
    const avgTime = success ? Math.round((data.totalTime || 0) / success) : 0;
    const promptTokens = data.promptTokens || 0;
    const completionTokens = data.completionTokens || 0;
    const totalTokens = data.totalTokens || (promptTokens + completionTokens);
    const tokensText = `${formatNumber(promptTokens)} / ${formatNumber(completionTokens)} / ${formatNumber(totalTokens)}`;
    const cost = data.totalCostUsd != null ? formatUsd(data.totalCostUsd) : '-';
    return `
      <tr>
        <td><span style="color: var(--primary); font-family:var(--font-mono);">${name}</span></td>
        <td>${total}</td>
        <td><span style="color:var(--success)">${success}</span> / <span style="color:var(--danger)">${error}</span></td>
        <td>${avgTime}ms</td>
        <td>${successRate}%</td>
        <td>${tokensText}</td>
        <td>${cost}</td>
      </tr>
    `;
  }).join('');
}

// --- Charts ---

function initCharts() {
  if (!window.echarts) return;
  ['usage-distribution', 'usage-trend', 'call-share', 'call-ranking', 'error-dist', 'latency-dist'].forEach((key) => {
    const el = document.getElementById(`chart-${key}`);
    if (el) {
      chartInstances[key] = echarts.init(el);
    }
  });

  initThroughputChart();

  document.querySelectorAll('.chart-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.chart;
      document.querySelectorAll('.chart-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.dataset.chart === target);
      });
      resizeCharts();
    });
  });

  window.addEventListener('resize', resizeCharts);
}

function resizeCharts() {
  Object.values(chartInstances).forEach((chart) => chart && chart.resize());
}

function initThroughputChart() {
  const el = document.getElementById('chart-throughput');
  if (!el) return;
  
  chartInstances['throughput'] = echarts.init(el);
  const styles = getChartStyles();
  
  // Initialize with empty data
  const now = Date.now();
  throughputTimes = [];
  throughputValues = [];
  for (let i = 0; i < MAX_THROUGHPUT_POINTS; i++) {
    const t = new Date(now - (MAX_THROUGHPUT_POINTS - i) * 1000);
    throughputTimes.push([
        t.getHours(),
        (t.getMinutes() < 10 ? '0' : '') + t.getMinutes(),
        (t.getSeconds() < 10 ? '0' : '') + t.getSeconds()
    ].join(':'));
    throughputValues.push(0);
  }

  const option = {
    grid: { left: '20px', right: '20px', top: '20px', bottom: '20px', containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(5, 8, 16, 0.9)',
      borderColor: styles.palette[0],
      borderWidth: 1,
      padding: [10, 15],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 14 },
      formatter: function (params) {
        params = params[0];
        return `<div style="font-family:${styles.font}; font-weight:bold; font-size:14px; margin-bottom:4px; color:${styles.muted}">${params.name}</div>
                <div style="color:${styles.palette[0]}; font-size:18px; font-weight:bold; text-shadow: 0 0 10px ${adjustOpacity(styles.palette[0], 0.5)}">${params.value} <span style="font-size:12px; opacity:0.8">Tokens/s</span></div>`;
      },
      axisPointer: {
        animation: false,
        lineStyle: {
          color: styles.palette[0],
          type: 'dashed',
          width: 1,
          shadowBlur: 5,
          shadowColor: styles.palette[0]
        }
      }
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: throughputTimes,
      splitLine: { show: false },
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14,
        interval: 9,
        rotate: 0,
        showMaxLabel: true
      }
    },
    yAxis: {
      type: 'value',
      boundaryGap: [0, '100%'],
      splitLine: { lineStyle: { color: styles.grid, type: 'dashed', opacity: 0.3 } },
      axisLabel: { color: styles.muted, fontFamily: styles.font, fontSize: 14 },
      minInterval: 1,
      min: 0
    },
    series: [{
      name: 'Throughput',
      type: 'line',
      showSymbol: false,
      hoverAnimation: false,
      data: throughputValues,
      smooth: true,
      lineStyle: {
        color: styles.palette[0],
        width: 3,
        shadowColor: styles.palette[0],
        shadowBlur: 15
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{
          offset: 0, color: adjustOpacity(styles.palette[0], 0.5)
        }, {
          offset: 1, color: adjustOpacity(styles.palette[0], 0)
        }])
      }
    }]
  };

  chartInstances['throughput'].setOption(option);
}

function updateThroughputChart(timestamp, tps) {
  const chart = chartInstances['throughput'];
  if (!chart) return;

  const t = new Date(timestamp);
  const timeStr = [
      t.getHours(),
      (t.getMinutes() < 10 ? '0' : '') + t.getMinutes(),
      (t.getSeconds() < 10 ? '0' : '') + t.getSeconds()
  ].join(':');

  throughputTimes.shift();
  throughputTimes.push(timeStr);
  
  throughputValues.shift();
  throughputValues.push(tps);

  chart.setOption({
    xAxis: {
      data: throughputTimes
    },
    series: [{
      data: throughputValues
    }]
  });
}

function getChartStyles() {
  const styles = getComputedStyle(document.documentElement);
  return {
    text: styles.getPropertyValue('--text-main').trim() || '#e6f1ff',
    muted: styles.getPropertyValue('--text-muted').trim() || '#94a3b8',
    grid: styles.getPropertyValue('--border-color').trim() || 'rgba(0, 243, 255, 0.2)',
    panel: styles.getPropertyValue('--bg-card').trim() || 'rgba(16, 20, 35, 0.6)',
    bg: 'transparent',
    font: 'Rajdhani, sans-serif',
    palette: [
      '#00f3ff', // Cyan (Primary)
      '#bc13fe', // Purple (Secondary)
      '#ff0055', // Pink/Red (Accent)
      '#00ff9d', // Green (Success)
      '#ffea00', // Yellow (Warning)
      '#00d9ff', // Light Blue (Info)
      '#ff2a6d', // Red (Danger)
      '#7000ff', // Deep Purple
      '#00ffcc', // Bright Green
      '#ff0099', // Hot Pink
      '#ffff00', // Bright Yellow
      '#00ccff'  // Bright Cyan
    ]
  };
}

function adjustOpacity(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderEmptyChart(chart, styles, message = '暂无数据') {
  if (!chart) return;
  chart.clear();
  chart.setOption({
    title: {
      text: message,
      left: 'center',
      top: 'middle',
      textStyle: { color: styles.muted, fontSize: 16 }
    }
  });
}

function getLogTokens(log) {
  const promptTokens = Number(
    log.promptTokens ??
    log.prompt_tokens ??
    (log.usage ? log.usage.prompt_tokens : null)
  );
  const completionTokens = Number(
    log.completionTokens ??
    log.completion_tokens ??
    (log.usage ? log.usage.completion_tokens : null)
  );
  let totalTokens = Number(
    log.totalTokens ??
    log.total_tokens ??
    (log.usage ? log.usage.total_tokens : null)
  );
  if (!Number.isFinite(totalTokens)) {
    const safePrompt = Number.isFinite(promptTokens) ? promptTokens : 0;
    const safeCompletion = Number.isFinite(completionTokens) ? completionTokens : 0;
    totalTokens = safePrompt + safeCompletion;
  }
  return Number.isFinite(totalTokens) ? totalTokens : 0;
}

function getLogCost(log) {
  const costVal = Number(
    log.costUsd ??
    log.totalCostUsd ??
    log.cost ??
    (log.usage ? log.usage.costUsd : null)
  );
  return Number.isFinite(costVal) ? costVal : 0;
}

function buildAnalyticsDataset(logs = [], stats = latestStats) {
  const modelCounts = {};
  const modelCosts = {};
  const modelTokens = {};
  const dailyCost = {};
  const dailyTokens = {};
  const dailyCount = {};
  const errorCounts = {};
  const latencies = [];

  logs.forEach((log) => {
    const status = (log.status || '').toLowerCase();
    const model = normalizeModelName(log.model, log.path);
    
    if (status !== 'success') {
        const errorType = log.statusCode === 429 || status === 'rate-limited' ? '429 Rate Limit' : (log.statusCode ? `HTTP ${log.statusCode}` : 'Unknown Error');
        errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
    } else {
        if (log.responseTime) {
            latencies.push(log.responseTime);
        }
    }

    if (status !== 'success') return;
    if (model === 'unknown' || model === 'models-list') return;
    const ts = log.timestamp ? new Date(log.timestamp) : null;
    const dayKey = ts
      ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}`
      : null;
    const tokens = getLogTokens(log);
    const costVal = getLogCost(log);

    modelCounts[model] = (modelCounts[model] || 0) + 1;
    modelCosts[model] = (modelCosts[model] || 0) + costVal;
    modelTokens[model] = (modelTokens[model] || 0) + tokens;

    if (dayKey) {
      if (!dailyCost[dayKey]) dailyCost[dayKey] = {};
      if (!dailyTokens[dayKey]) dailyTokens[dayKey] = {};
      if (!dailyCount[dayKey]) dailyCount[dayKey] = {};
      dailyCost[dayKey][model] = (dailyCost[dayKey][model] || 0) + costVal;
      dailyTokens[dayKey][model] = (dailyTokens[dayKey][model] || 0) + tokens;
      dailyCount[dayKey][model] = (dailyCount[dayKey][model] || 0) + 1;
    }
  });

  const dates = Object.keys(dailyCount).sort();
  const timelineModels = new Set(dates.flatMap((d) => Object.keys(dailyCount[d] || {})));
  const models = new Set([
    ...timelineModels,
    ...Object.keys(modelCounts),
    ...Object.keys(modelTokens),
    ...Object.keys(modelCosts)
  ]);
  const orderedModels = Array.from(models).sort((a, b) => {
    const countA = modelCounts[a] ?? 0;
    const countB = modelCounts[b] ?? 0;
    const tokenA = modelTokens[a] ?? 0;
    const tokenB = modelTokens[b] ?? 0;
    const costA = modelCosts[a] ?? 0;
    const costB = modelCosts[b] ?? 0;
    return (costB || tokenB || countB) - (costA || tokenA || countA);
  });

  const totalCost = Object.values(modelCosts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const totalCalls = Object.values(modelCounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const totalTokens = Object.values(modelTokens).reduce((sum, v) => sum + (Number(v) || 0), 0);

  return {
    modelCounts,
    modelCosts,
    modelTokens,
    dailyCost,
    dailyTokens,
    dailyCount,
    dates,
    models: orderedModels,
    totalCost,
    totalCalls,
    totalTokens,
    errorCounts,
    latencies
  };
}

function renderModelAnalytics(logs) {
  if (!window.echarts || Object.keys(chartInstances).length === 0) return;
  const analytics = buildAnalyticsDataset(logs || []);
  const styles = getChartStyles();
  renderUsageDistribution(analytics, styles, analyticsMetric);
  renderUsageTrend(analytics, styles, analyticsMetric);
  renderCallShare(analytics, styles, analyticsMetric);
  renderCallRanking(analytics, styles, analyticsMetric);
  renderErrorDistribution(analytics, styles);
  renderLatencyDistribution(analytics, styles);
}

function setAnalyticsMetric(metric) {
  analyticsMetric = metric;
  renderModelAnalytics(analyticsLogs);
}

function getMetricTitle(chartKey, metric) {
  if (chartKey === 'usage-distribution') {
    if (metric === 'calls') return '模型调用次数分布图';
    if (metric === 'tokens') return '模型tokens消耗分布图';
    return '模型消耗费用分布图';
  }
  if (chartKey === 'usage-trend') {
    if (metric === 'calls') return '模型调用次数趋势图';
    if (metric === 'tokens') return '模型tokens消耗趋势图';
    return '模型费用消耗趋势图';
  }
  if (chartKey === 'call-share') {
    if (metric === 'calls') return '模型调用次数占比图';
    if (metric === 'tokens') return '模型tokens消耗占比图';
    return '模型费用消耗占比图';
  }
  if (chartKey === 'call-ranking') {
    if (metric === 'calls') return '模型调用次数排行图';
    if (metric === 'tokens') return '模型tokens消耗排行图';
    return '模型费用消耗排行图';
  }
  return '';
}

function getMetricSource(analytics, metric) {
  if (metric === 'tokens') {
    return {
      total: analytics.totalTokens || 0,
      model: analytics.modelTokens || {},
      daily: analytics.dailyTokens || {},
      unit: 'Tokens'
    };
  }
  if (metric === 'calls') {
    return {
      total: analytics.totalCalls || 0,
      model: analytics.modelCounts || {},
      daily: analytics.dailyCount || {},
      unit: '次'
    };
  }
  return {
    total: analytics.totalCost || 0,
    model: analytics.modelCosts || {},
    daily: analytics.dailyCost || {},
    unit: 'USD'
  };
}

function formatMetricValue(metric, value) {
  const val = Number(value) || 0;
  if (metric === 'cost') return formatUsd(val);
  if (metric === 'tokens') return `${formatNumber(val)} Tokens`;
  return `${formatNumber(val)} 次`;
}

function formatMetricAxis(metric, value) {
  const val = Number(value) || 0;
  if (metric === 'cost') return formatUsd(val);
  return formatNumber(val);
}

function normalizeMetricValue(metric, value) {
  const val = Number(value) || 0;
  if (metric === 'cost') return Number(val.toFixed(6));
  return Math.round(val);
}

function getOrderedModelsByMetric(analytics, metric) {
  const source = getMetricSource(analytics, metric).model || {};
  return Object.keys(source).sort((a, b) => (source[b] || 0) - (source[a] || 0));
}

function updateChartTitle(chartKey, metric) {
  const title = getMetricTitle(chartKey, metric);
  const el = document.querySelector(`.chart-panel[data-chart="${chartKey}"] .chart-panel-title`);
  if (el && title) el.textContent = title;
}

function renderUsageDistribution(analytics, styles, metric) {
  const chart = chartInstances['usage-distribution'];
  const summary = document.getElementById('summary-usage-distribution');
  if (!chart) return;

  updateChartTitle('usage-distribution', metric);
  const metricSource = getMetricSource(analytics, metric);
  const models = getOrderedModelsByMetric(analytics, metric);
  if (summary) {
    summary.textContent = `总计：${formatMetricValue(metric, metricSource.total)}`;
  }

  if (!analytics.dates.length || !models.length) {
    renderEmptyChart(chart, styles, '暂无带时间戳的日志');
    return;
  }

  const source = metricSource.daily;
  const xData = analytics.dates.map((d) => d.slice(5));

  const series = models.map((model, idx) => {
    const color = styles.palette[idx % styles.palette.length];
    return {
      name: model,
      type: 'bar',
      stack: 'usage',
      emphasis: { focus: 'series' },
      barMaxWidth: 36,
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: color },
          { offset: 1, color: adjustOpacity(color, 0.1) }
        ]),
        shadowBlur: 15,
        shadowColor: adjustOpacity(color, 0.5)
      },
      data: analytics.dates.map((d) => {
        const val = Number(source[d]?.[model] ?? 0);
        return normalizeMetricValue(metric, val);
      })
    };
  }).filter((s) => s.data.some((v) => v > 0));

  if (!series.length) {
    renderEmptyChart(chart, styles, '暂无可用数据');
    return;
  }

  chart.setOption({
    title: { show: false },
    color: styles.palette,
    tooltip: {
      trigger: 'axis',
      backgroundColor: styles.panel,
      borderColor: styles.palette[0],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } },
      valueFormatter: (val) => formatMetricValue(metric, val)
    },
    legend: {
      top: 0,
      textStyle: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14,
        textShadowColor: styles.palette[0],
        textShadowBlur: 3
      }
    },
    grid: { left: '4%', right: '2%', bottom: '8%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: xData,
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14
      }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: { color: styles.muted, fontFamily: styles.font, formatter: (val) => formatMetricAxis(metric, val) },
      splitLine: { lineStyle: { color: styles.grid, type: 'dashed', opacity: 0.3 } }
    },
    series
  });
}

function renderUsageTrend(analytics, styles, metric) {
  const chart = chartInstances['usage-trend'];
  const summary = document.getElementById('summary-usage-trend');
  if (!chart) return;

  updateChartTitle('usage-trend', metric);
  const metricSource = getMetricSource(analytics, metric);
  const models = getOrderedModelsByMetric(analytics, metric);
  if (summary) {
    const lastDate = analytics.dates[analytics.dates.length - 1];
    const lastValue = lastDate
      ? models.reduce((sum, model) => {
          return sum + (Number(metricSource.daily[lastDate]?.[model] ?? 0));
        }, 0)
      : 0;
    summary.textContent = `最近一天：${formatMetricValue(metric, lastValue)}`;
  }

  if (!analytics.dates.length || !models.length) {
    renderEmptyChart(chart, styles, '暂无带时间戳的日志');
    return;
  }

  const source = metricSource.daily;
  const xData = analytics.dates.map((d) => d.slice(5));

  const series = models.map((model, idx) => {
    const color = styles.palette[idx % styles.palette.length];
    return {
      name: model,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 8,
      itemStyle: {
        color: color,
        borderColor: styles.bg,
        borderWidth: 2,
        shadowColor: color,
        shadowBlur: 10
      },
      lineStyle: { width: 4, shadowColor: color, shadowBlur: 20 },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: adjustOpacity(color, 0.6) },
          { offset: 1, color: adjustOpacity(color, 0.0) }
        ])
      },
      data: analytics.dates.map((d) => {
        const val = Number(source[d]?.[model] ?? 0);
        return normalizeMetricValue(metric, val);
      })
    };
  }).filter((s) => s.data.some((v) => v > 0));

  if (!series.length) {
    renderEmptyChart(chart, styles, '暂无可用数据');
    return;
  }

  chart.setOption({
    title: { show: false },
    color: styles.palette,
    tooltip: {
      trigger: 'axis',
      backgroundColor: styles.panel,
      borderColor: styles.palette[0],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 },
      valueFormatter: (val) => formatMetricValue(metric, val)
    },
    legend: {
      top: 0,
      textStyle: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14,
        textShadowColor: styles.palette[0],
        textShadowBlur: 3
      }
    },
    grid: { left: '4%', right: '2%', bottom: '8%', top: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: xData,
      boundaryGap: false,
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14
      }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: { color: styles.muted, fontFamily: styles.font, formatter: (val) => formatMetricAxis(metric, val) },
      splitLine: { lineStyle: { color: styles.grid, type: 'dashed', opacity: 0.3 } }
    },
    series
  });
}

function renderCallShare(analytics, styles, metric) {
  const chart = chartInstances['call-share'];
  const summary = document.getElementById('summary-call-share');
  const listEl = document.getElementById('chart-call-share-list');
  if (!chart) return;

  updateChartTitle('call-share', metric);
  const metricSource = getMetricSource(analytics, metric);

  if (summary) {
    summary.textContent = `总计：${formatMetricValue(metric, metricSource.total)}`;
  }

  const entries = Object.entries(metricSource.model || {}).filter(([, v]) => v > 0);
  if (!entries.length) {
    if (listEl) {
      listEl.innerHTML = '<div class="empty-state">暂无数据</div>';
    }
    renderEmptyChart(chart, styles, '暂无调用记录');
    return;
  }

  const data = entries.sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  const totalValue = data.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  if (listEl) {
    listEl.innerHTML = data.map((item, idx) => {
      const value = Number(item.value) || 0;
      const percent = totalValue > 0 ? (value / totalValue) * 100 : 0;
      const color = styles.palette[idx % styles.palette.length];
      return `
        <div class="chart-list-item">
          <span class="chart-list-color" style="background:${color};"></span>
          <div class="chart-list-content">
            <div class="chart-list-name" style="font-size: 16px; text-shadow: 0 0 8px ${color}, 0 0 15px ${adjustOpacity(color, 0.5)}; font-weight: 700;">${escapeHtml(item.name)}</div>
            <div class="chart-list-meta" style="font-size: 13px; opacity: 0.8;">${formatMetricValue(metric, value)} (${percent.toFixed(2)}%)</div>
          </div>
        </div>
      `;
    }).join('');
  }

  chart.setOption({
    title: { show: false },
    color: styles.palette,
    tooltip: {
      trigger: 'item',
      backgroundColor: styles.panel,
      borderColor: styles.palette[0],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 },
      valueFormatter: (val) => formatMetricValue(metric, val)
    },
    legend: { show: false },
    series: [{
      type: 'pie',
      radius: ['50%', '75%'],
      center: ['50%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderColor: styles.bg,
        borderWidth: 2,
        borderRadius: 4,
        shadowBlur: 20,
        shadowColor: 'rgba(0,0,0,0.6)'
      },
      label: { show: false },
      labelLine: { show: false },
      data
    }]
  });
}

function renderCallRanking(analytics, styles, metric) {
  const chart = chartInstances['call-ranking'];
  const summary = document.getElementById('summary-call-ranking');
  if (!chart) return;

  updateChartTitle('call-ranking', metric);
  const metricSource = getMetricSource(analytics, metric);

  const entries = Object.entries(metricSource.model || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (summary) {
    summary.textContent = entries.length
      ? `Top ${entries.length} 模型，总计 ${formatMetricValue(metric, metricSource.total)}`
      : 'Top 排行：--';
  }

  if (!entries.length) {
    renderEmptyChart(chart, styles, '暂无调用记录');
    return;
  }

  const names = entries.map(([name]) => name);
  const values = entries.map(([, value]) => value);

  chart.setOption({
    title: { show: false },
    color: styles.palette,
    tooltip: {
      trigger: 'axis',
      backgroundColor: styles.panel,
      borderColor: styles.palette[0],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,0.05)' } },
      valueFormatter: (val) => formatMetricValue(metric, val)
    },
    grid: { left: '26%', right: '6%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: styles.muted, fontFamily: styles.font, fontSize: 14, formatter: (val) => formatMetricAxis(metric, val) },
      splitLine: { lineStyle: { color: styles.grid, type: 'dashed', opacity: 0.3 } },
      axisLine: { lineStyle: { color: styles.grid } }
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        color: styles.text,
        fontFamily: styles.font,
        fontSize: 15,
        fontWeight: 'bold',
        textShadowColor: styles.palette[0],
        textShadowBlur: 5
      },
      axisLine: { lineStyle: { color: styles.grid } }
    },
    series: [{
      type: 'bar',
      barWidth: 16,
      data: values.map((val) => normalizeMetricValue(metric, val)),
      itemStyle: {
        borderRadius: [0, 4, 4, 0],
        color: (params) => {
          const color = styles.palette[params.dataIndex % styles.palette.length];
          return new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: adjustOpacity(color, 0.2) },
            { offset: 1, color: color }
          ]);
        },
        shadowBlur: 10,
        shadowColor: 'rgba(0,0,0,0.5)'
      }
    }]
  });
}

function renderErrorDistribution(analytics, styles) {
  const chart = chartInstances['error-dist'];
  const summary = document.getElementById('summary-error-dist');
  if (!chart) return;

  const entries = Object.entries(analytics.errorCounts || {});
  const totalErrors = entries.reduce((sum, [, v]) => sum + v, 0);

  if (summary) {
    summary.textContent = `总计：${totalErrors} 次错误`;
  }

  if (!entries.length) {
    renderEmptyChart(chart, styles, '暂无错误记录');
    return;
  }

  const data = entries.sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));

  chart.setOption({
    title: { show: false },
    color: ['#ff4500', '#ffd700', '#dc143c'], // Use reddish/warning colors explicitly
    tooltip: {
      trigger: 'item',
      backgroundColor: styles.panel,
      borderColor: styles.palette[2],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 },
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      top: '5%',
      textStyle: {
        color: styles.muted,
        fontFamily: styles.font,
        fontSize: 14,
        textShadowColor: styles.palette[2],
        textShadowBlur: 3
      }
    },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['50%', '60%'],
      itemStyle: {
        borderRadius: 4,
        borderColor: styles.bg,
        borderWidth: 2,
        shadowBlur: 20,
        shadowColor: 'rgba(0,0,0,0.6)'
      },
      label: { color: styles.text, fontFamily: styles.font },
      data
    }]
  });
}

function renderLatencyDistribution(analytics, styles) {
  const chart = chartInstances['latency-dist'];
  const summary = document.getElementById('summary-latency-dist');
  if (!chart) return;

  const latencies = analytics.latencies || [];
  if (!latencies.length) {
    if (summary) summary.textContent = '平均：--';
    renderEmptyChart(chart, styles, '暂无响应时间数据');
    return;
  }

  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  if (summary) summary.textContent = `平均：${avg}ms`;

  // Create histogram bins
  const bins = [0, 500, 1000, 2000, 5000, 10000];
  const binCounts = new Array(bins.length).fill(0);
  const binLabels = ['<500ms', '0.5-1s', '1-2s', '2-5s', '5-10s', '>10s'];

  latencies.forEach(l => {
    if (l < 500) binCounts[0]++;
    else if (l < 1000) binCounts[1]++;
    else if (l < 2000) binCounts[2]++;
    else if (l < 5000) binCounts[3]++;
    else if (l < 10000) binCounts[4]++;
    else binCounts[5]++;
  });

  chart.setOption({
    title: { show: false },
    color: [styles.palette[5]],
    tooltip: {
      trigger: 'axis',
      backgroundColor: styles.panel,
      borderColor: styles.palette[5],
      textStyle: { color: styles.text, fontFamily: styles.font, fontSize: 16 }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: binLabels,
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: { color: styles.muted, fontFamily: styles.font, fontSize: 14 }
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: styles.grid } },
      axisLabel: { color: styles.muted, fontFamily: styles.font, fontSize: 14 },
      splitLine: { lineStyle: { color: styles.grid, type: 'dashed', opacity: 0.3 } }
    },
    series: [{
      data: binCounts,
      type: 'bar',
      barWidth: '60%',
      itemStyle: {
        borderRadius: [4, 4, 0, 0],
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: styles.palette[5] },
          { offset: 1, color: adjustOpacity(styles.palette[5], 0.1) }
        ]),
        shadowBlur: 15,
        shadowColor: adjustOpacity(styles.palette[5], 0.6)
      }
    }]
  });
}

// --- Config & Details ---

async function loadConfig() {
  try {
    const config = await fetchJson('/get-config');
    const strategyEl = document.getElementById('system-message-strategy');
    if (strategyEl && config.systemMessageStrategy) {
      strategyEl.value = config.systemMessageStrategy;
    }
    const prefixEl = document.getElementById('system-message-prefix');
    if (prefixEl && typeof config.systemMessageLabelPrefix === 'boolean') {
      prefixEl.checked = config.systemMessageLabelPrefix;
    }
    const excludeBase64El = document.getElementById('exclude-base64-logs');
    if (excludeBase64El && typeof config.excludeBase64InLogs === 'boolean') {
      excludeBase64El.checked = config.excludeBase64InLogs;
    }
    const enablePseudoStreamEl = document.getElementById('enable-pseudo-stream-models');
    if (enablePseudoStreamEl && typeof config.enablePseudoStreamModels === 'boolean') {
      enablePseudoStreamEl.checked = config.enablePseudoStreamModels;
    }

    // Fake Streaming Config
    if (config.fakeStreaming) {
      const fsChunk = document.getElementById('fake-streaming-chunk-size');
      const fsDelay = document.getElementById('fake-streaming-delay');
      
      if (fsChunk) fsChunk.value = config.fakeStreaming.chunkSize || 25;
      if (fsDelay) fsDelay.value = config.fakeStreaming.delay || 2;
    }

    updateStrategyDescription();
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}

async function updateConfig() {
  const strategy = document.getElementById('system-message-strategy').value;
  const labelPrefix = document.getElementById('system-message-prefix').checked;
  const excludeBase64 = document.getElementById('exclude-base64-logs').checked;
  const enablePseudoStream = document.getElementById('enable-pseudo-stream-models').checked;
  
  // Fake Streaming
  const fsChunk = parseInt(document.getElementById('fake-streaming-chunk-size').value, 10) || 25;
  const fsDelay = parseInt(document.getElementById('fake-streaming-delay').value, 10) || 2;

  const statusEl = document.getElementById('config-status');
  try {
    const result = await fetchJson('/update-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemMessageStrategy: strategy,
        systemMessageLabelPrefix: labelPrefix,
        excludeBase64InLogs: excludeBase64,
        enablePseudoStreamModels: enablePseudoStream,
        fakeStreaming: {
          enabled: false, // 强制禁用全局开关，仅通过后缀触发
          chunkSize: fsChunk,
          delay: fsDelay
        }
      })
    });
    statusEl.textContent = result.success ? '已保存' : '保存失败';
    statusEl.style.color = result.success ? 'var(--success)' : 'var(--danger)';
    logToTerminal('INFO', `Config updated: Strategy=${strategy}, FakeStreamingParams=${fsChunk}/${fsDelay}`);
  } catch (error) {
    console.error('更新配置失败:', error);
    statusEl.textContent = '保存失败';
    statusEl.style.color = 'var(--danger)';
    logToTerminal('ERROR', `Config update failed: ${error.message}`);
  } finally {
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  }
}

const STRATEGY_DESCRIPTIONS = {
  'none': {
    title: '默认：仅作为系统指令 (Standard)',
    desc: '这是 Gemini API 的标准行为。提取请求中所有的 System 消息，将其放入 system_instruction 字段。',
    behavior: 'System 消息不会出现在对话历史 (contents) 中，而是作为独立的系统指令传递给模型。',
    example_in:  '[System] "你是猫"\n[User]   "叫一声"',
    example_out: 'system_instruction: "你是猫"\ncontents: [User] "叫一声"',
    note: '如果模型不支持 system_instruction 参数，这些 System 消息可能会被忽略。'
  },
  'convert-all-to-user': {
    title: '全部转为用户消息 (All to User)',
    desc: '将所有的 System 消息都强制转换为 User 消息。',
    behavior: 'System 消息将作为普通的对话内容保留在对话历史 (contents) 中，模型会将其视为用户说的话。',
    example_in:  '[System] "你是猫"\n[User]   "叫一声"',
    example_out: 'system_instruction: (空)\ncontents: [User] "你是猫", [User] "叫一声"',
    note: '适用于不支持 system_instruction 的模型（如部分旧版模型），或者你希望 System 提示词作为对话上下文的一部分。'
  },
  'merge-first': {
    title: '首部合并为系统指令 (Merge First)',
    desc: '智能合并对话开头的连续 System 消息，后续的 System 消息转为 User 消息。',
    behavior: '对话最开始的连续 System 消息会被合并（用换行符连接）成一条 system_instruction。一旦出现 User 消息，之后的所有 System 消息都会被转换为 User 消息，以保留上下文顺序。',
    example_in:  '[System] "设定A"\n[System] "设定B"\n[User]   "你好"\n[System] "补充设定C"',
    example_out: 'system_instruction: "设定A\\n设定B"\ncontents: [User] "你好", [User] "补充设定C"',
    note: '推荐策略。既能利用 system_instruction 的权重，又能防止因对话中间插入 System 消息而导致的信息丢失或报错。'
  },
  'merge-first-parts': {
    title: '首部保留为系统指令 (Merge First Parts)',
    desc: '与“首部合并”类似，但保留原始消息结构（不合并文本）。',
    behavior: '对话最开始的连续 System 消息会作为 system_instruction 的多个 part 保留。后续机制与“首部合并”一致。',
    example_in:  '[System] "设定A"\n[System] "设定B"\n[User]   "你好"',
    example_out: 'system_instruction: ["设定A", "设定B"]\ncontents: [User] "你好"',
    note: '保留了原始的 System 消息分块结构，适合对 System 消息结构有特殊要求的场景。'
  },
  'merge-all': {
    title: '全部合并为系统指令 (Merge All)',
    desc: '提取对话中所有的 System 消息，按顺序合并为一条 System 指令。',
    behavior: '无论 System 消息出现在对话的什么位置，都会被提取出来，用换行符连接后放入 system_instruction。原位置的 System 消息会被移除。',
    example_in:  '[System] "设定A"\n[User]   "你好"\n[System] "设定B"',
    example_out: 'system_instruction: "设定A\\n设定B"\ncontents: [User] "你好"',
    note: '适合希望强制所有 System 消息生效，且不介意破坏原有对话顺序（System 消息被提权）的场景。'
  }
};

function applyFakeStreamPreset(chunk, delay) {
  const chunkEl = document.getElementById('fake-streaming-chunk-size');
  const delayEl = document.getElementById('fake-streaming-delay');
  if (chunkEl) chunkEl.value = chunk;
  if (delayEl) delayEl.value = delay;
}

function updateStrategyDescription() {
  const strategyEl = document.getElementById('system-message-strategy');
  if (!strategyEl) return;
  const strategy = strategyEl.value;
  const container = document.getElementById('strategy-description');
  const info = STRATEGY_DESCRIPTIONS[strategy] || STRATEGY_DESCRIPTIONS['none'];

  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-2" style="gap: 24px;">
      <div>
        <div style="margin-bottom: 16px;">
          <div style="font-weight: 600; font-size: 16px; color: var(--primary); margin-bottom: 6px;">${info.title}</div>
          <div style="color: var(--text-muted); font-size: 14px; line-height: 1.5;">${info.desc}</div>
        </div>

        <div style="margin-bottom: 16px;">
          <div style="font-size: 13px; font-weight: 600; color: var(--text-dim); margin-bottom: 6px; text-transform: uppercase;">处理逻辑</div>
          <div style="font-size: 14px; line-height: 1.6; color: var(--text-main);">${info.behavior}</div>
        </div>

        <div style="font-size: 13px; color: var(--warning); display: flex; gap: 8px; align-items: flex-start; background: var(--warning-dim); padding: 12px; border-radius: 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-top: 2px; flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>${info.note}</span>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; flex: 1; display: flex; flex-direction: column;">
          <div style="padding: 8px 12px; background: var(--bg-dim); border-bottom: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">输入 (Input)</div>
          <div style="padding: 12px; flex: 1; background: var(--bg-dimmer);">
            <pre style="margin: 0; font-family: var(--font-mono); font-size: 13px; color: var(--text-main); white-space: pre-wrap;">${info.example_in}</pre>
          </div>
        </div>
        <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; flex: 1; display: flex; flex-direction: column;">
          <div style="padding: 8px 12px; background: var(--bg-dim); border-bottom: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">输出 (Output)</div>
          <div style="padding: 12px; flex: 1; background: var(--bg-dimmer);">
            <pre style="margin: 0; font-family: var(--font-mono); font-size: 13px; color: var(--success); white-space: pre-wrap;">${info.example_out}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function viewRequestDetail(requestId) {
  try {
    const detail = await fetchJson(`/request-detail/${encodeURIComponent(requestId)}`);
    updateText('detail-request-id', detail.requestId || '-');
    updateText('detail-path', detail.path || '-');
    updateText('detail-model', normalizeModelName(detail.model, detail.path) || '-');
    updateText('detail-connection', detail.connectionId ? (connectionDetailsCache[detail.connectionId] || detail.connectionId) : '-');
    updateText('detail-status', detail.status || '-');
    updateText('detail-response-time', detail.responseTime ? `${detail.responseTime}ms` : '-');

    const tokensText = [
      `${detail.promptTokens ?? (detail.usage?.prompt_tokens ?? '-')}`,
      `${detail.completionTokens ?? (detail.usage?.completion_tokens ?? '-')}`,
      `${detail.totalTokens ?? (detail.usage?.total_tokens ?? '-')}`
    ].join(' / ');
    updateText('detail-tokens', tokensText);

    const costUsd = detail.costUsd ?? (detail.usage?.costUsd ?? null);
    updateText('detail-cost', costUsd != null ? formatUsd(costUsd) : '-');

    requestViewMode = 'preview';
    currentRequestBody = detail.requestBody;
    const requestRawEl = document.getElementById('request-raw');
    if (requestRawEl) requestRawEl.innerHTML = formatJson(currentRequestBody, true);
    renderRequestView();
    
    responseViewMode = 'preview';
    currentResponseBody = detail.responseBody;
    document.getElementById('response-raw').innerHTML = formatJson(currentResponseBody, true);
    renderResponseView();

    document.getElementById('detail-modal').classList.add('open');
  } catch (error) {
    console.error('获取详情失败:', error);
    alert('获取请求详情失败');
  }
}

function closeDetailModal(event) {
  if (event) event.stopPropagation();
  document.getElementById('detail-modal').classList.remove('open');
}

function setResponseViewMode(mode) {
  responseViewMode = mode;
  renderResponseView();
}

function setRequestViewMode(mode) {
  requestViewMode = mode;
  renderRequestView();
}

function toggleReasoning() {
  const el = document.getElementById('preview-reasoning');
  if (el) el.classList.toggle('collapsed');
}

function renderResponseView() {
  const rawEl = document.getElementById('response-raw');
  const previewEl = document.getElementById('response-preview');
  const toggle = document.getElementById('response-view-toggle');
  const previewMain = document.getElementById('preview-main');
  const previewReasoning = document.getElementById('preview-reasoning');

  if (toggle) {
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === responseViewMode);
    });
  }

  if (!currentResponseBody) {
    if (rawEl) rawEl.textContent = '暂无';
  }

  if (responseViewMode === 'raw') {
    if (rawEl) rawEl.classList.remove('hidden');
    if (previewEl) previewEl.classList.add('hidden');
  } else {
    if (rawEl) rawEl.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('hidden');
  }

  if (responseViewMode === 'preview') {
    const previewData = buildPreviewData(currentResponseBody);
    if (previewMain) previewMain.innerHTML = renderMarkdown(previewData.content || '暂无');
    if (previewReasoning) previewReasoning.innerHTML = renderMarkdown(previewData.reasoning || '暂无');
  }
}

function renderRequestView() {
  const rawEl = document.getElementById('request-raw');
  const previewEl = document.getElementById('request-preview');
  const toggle = document.getElementById('request-view-toggle');
  const previewReq = document.getElementById('preview-request');

  if (toggle) {
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === requestViewMode);
    });
  }

  if (!currentRequestBody) {
    if (rawEl) rawEl.textContent = '暂无';
  }

  if (requestViewMode === 'raw') {
    if (rawEl) rawEl.classList.remove('hidden');
    if (previewEl) previewEl.classList.add('hidden');
  } else {
    if (rawEl) rawEl.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('hidden');
  }

  if (requestViewMode === 'preview') {
    renderRequestBlocks(previewReq, currentRequestBody);
  }
}

// --- Helpers ---

function normalizeModelName(model, path = '') {
  const lowerPath = (path || '').toLowerCase();
  const lowerModel = (model || '').toLowerCase().trim();
  const isListPath = /^\/?v1(beta)?\/models(?:\/?$|\?.*)$/i.test(lowerPath);

  if (isListPath || lowerModel === 'models-list') return 'models-list';
  if (!lowerModel || lowerModel === 'unknown') return 'unknown';
  return model || 'unknown';
}

function getModelCallSummary(modelStats = {}) {
  const summary = { total: 0, success: 0, error: 0 };
  Object.entries(modelStats).forEach(([model, data]) => {
    const normalized = normalizeModelName(model);
    if (normalized === 'models-list') return;
    summary.total += Number(data?.total || 0);
    summary.success += Number(data?.success || 0);
    summary.error += Number(data?.error || 0);
  });
  return summary;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制到剪贴板');
    }).catch(err => console.error('Copy failed', err));
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('已复制到剪贴板');
  }
}

function showToast(message) {
  let toast = document.getElementById('toast-msg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-msg';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

async function copyCurrent(type) {
  try {
    let text = '';
    if (type === 'request') {
      if (requestViewMode === 'raw') {
        const el = document.getElementById('request-raw');
        text = el ? el.textContent : '';
      } else {
        text = buildRequestPreview(currentRequestBody);
      }
    } else if (type === 'response') {
      if (responseViewMode === 'raw') {
        const el = document.getElementById('response-raw');
        text = el ? el.textContent : '';
      } else {
        const previewData = buildPreviewData(currentResponseBody);
        text = `${previewData.content || ''}\n\n---\nReasoning:\n${previewData.reasoning || ''}`;
      }
    }

    text = text || '暂无内容';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    alert('已复制');
  } catch (error) {
    console.error('复制失败', error);
    alert('复制失败');
  }
}

async function copyAsCurl() {
  if (!currentRequestBody) {
    alert('无请求体');
    return;
  }
  
  const detail = await fetchJson(`/request-detail/${encodeURIComponent(document.getElementById('detail-request-id').textContent)}`);
  
  let curl = `curl -X POST "${window.location.origin}${detail.path || '/v1/chat/completions'}" \\\n`;
  curl += `  -H "Content-Type: application/json" \\\n`;
  curl += `  -d '${JSON.stringify(detail.requestBody)}'`;
  
  copyText(curl);
  alert('cURL 已复制');
}

function formatDateInput(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekStartDate(date) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = base.getDay();
  const diffToMonday = (day + 6) % 7;
  base.setDate(base.getDate() - diffToMonday);
  return base;
}

function applyDatePreset(startId, endId, preset) {
  const startEl = document.getElementById(startId);
  const endEl = document.getElementById(endId);
  if (!startEl || !endEl) return;

  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start = new Date(end);

  if (preset === 'week') {
    start = getWeekStartDate(end);
  } else if (preset === 'month') {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else if (preset !== 'today') {
    return;
  }

  startEl.value = formatDateInput(start);
  endEl.value = formatDateInput(end);
}

function setAnalyticsDatePreset(preset) {
  applyDatePreset('analytics-start-date', 'analytics-end-date', preset);
  onAnalyticsDateFilterChange();
}

function setRequestDatePreset(preset) {
  applyDatePreset('filter-start-date', 'filter-end-date', preset);
  onDateFilterChange();
}

function onDateFilterChange() {
  filterStartDate = document.getElementById('filter-start-date').value || null;
  filterEndDate = document.getElementById('filter-end-date').value || null;
  refreshRequestLogs();
}

function onAnalyticsDateFilterChange() {
  analyticsStartDate = document.getElementById('analytics-start-date').value || null;
  analyticsEndDate = document.getElementById('analytics-end-date').value || null;
  refreshAnalyticsLogs();
}

function clearAnalyticsDateFilter() {
  const startEl = document.getElementById('analytics-start-date');
  const endEl = document.getElementById('analytics-end-date');
  if (startEl) startEl.value = '';
  if (endEl) endEl.value = '';
  analyticsStartDate = null;
  analyticsEndDate = null;
  refreshAnalyticsLogs();
}

// --- Parsing & Formatting ---

function safeParseJson(text) {
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); }
  catch (e) {
    try {
      let fixed = text
        .replace(/[\r\n]+/g, '\\n')
        .replace(/\t/g, '\\t');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

function normalizeLogPayload(payload) {
  if (payload === null || payload === undefined) return payload;
  
  if (typeof payload === 'string') {
    let parsed = safeParseJson(payload);
    if (typeof parsed === 'string') {
      const parsedAgain = safeParseJson(parsed);
      if (parsedAgain !== null) parsed = parsedAgain;
    }
    if (parsed !== null) return normalizeLogPayload(parsed);
    
    const sseParsed = parseSsePayload(payload);
    if (sseParsed !== null) {
      return {
        streamedContent: payload,
        streamedContentParsed: sseParsed
      };
    }
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(normalizeLogPayload);
  }

  if (typeof payload === 'object') {
    const copy = { ...payload };
    for (const key of Object.keys(copy)) {
      copy[key] = normalizeLogPayload(copy[key]);
    }

    if (typeof copy.streamedContent === 'string') {
      const sseParsed = parseSsePayload(copy.streamedContent);
      if (sseParsed !== null) {
        copy.streamedContentParsed = sseParsed;
      }
    }
    return copy;
  }

  return payload;
}

function parseSsePayload(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  
  const parsed = [];
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    const json = safeParseJson(payload);
    if (json !== null) parsed.push(json);
  }
  
  if (parsed.length === 0) return null;
  return parsed.length === 1 ? parsed[0] : parsed;
}

function formatJson(data, highlight = false) {
  if (data === undefined || data === null) return '暂无';
  const normalized = normalizeLogPayload(data);
  let jsonStr = '';

  if (typeof normalized !== 'string') {
    try { jsonStr = JSON.stringify(normalized, null, 2); }
    catch { jsonStr = String(normalized); }
  } else {
    data = normalized;
    const parsed = safeParseJson(data);
    if (parsed !== null) {
      jsonStr = JSON.stringify(parsed, null, 2);
    } else {
      const sseParsed = parseSsePayload(data);
      if (sseParsed !== null) {
        jsonStr = JSON.stringify(sseParsed, null, 2);
      } else {
        jsonStr = data;
      }
    }
  }
  
  if (highlight) {
    return syntaxHighlight(jsonStr);
  }
  return jsonStr;
}

function syntaxHighlight(json) {
  if (typeof json !== 'string') return json;
  json = json.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

function buildPreviewData(body) {
  if (!body) return { content: '暂无', reasoning: '' };

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
       const parsed = safeParseJson(body);
       if (parsed) body = parsed;
    }
  }

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
       const parsed = safeParseJson(body);
       if (parsed) {
         if (Array.isArray(parsed)) {
            const msgs = extractRequestMessages(parsed);
            if (msgs.length > 0) {
                return {
                    content: msgs.map(m => `**${m.role}**: ${m.content}`).join('\n\n'),
                    reasoning: ''
                };
            }
         }
         return { content: JSON.stringify(parsed, null, 2), reasoning: '' };
       }
    }
    return { content: body, reasoning: '' };
  }

  if (typeof body === 'object') {
    if (Array.isArray(body)) {
      const msgs = extractRequestMessages(body);
      if (msgs.length > 0) {
        return {
          content: msgs.map(m => `**${m.role}**: ${m.content}`).join('\n\n'),
          reasoning: ''
        };
      }
    }

    let content = body.content || '';
    let reasoning = body.streamedReasoning || '';

    if (!content && typeof body.streamedContent === 'string') {
      const parsed = parseGeminiSseLines(body.streamedContent.split('\n'));
      if (parsed.content) content = parsed.content;
      if (parsed.reasoning && !reasoning) reasoning = parsed.reasoning;
    }

    if (!reasoning && Array.isArray(body.chunks)) {
      reasoning = body.chunks
        .map((c) => c?.choices?.[0]?.delta?.reasoning || c?.choices?.[0]?.message?.reasoning_content || '')
        .filter(Boolean)
        .join('\n');
    }

    if (!content && Array.isArray(body.chunks)) {
      content = body.chunks
        .map((c) => c?.choices?.[0]?.delta?.content || c?.choices?.[0]?.message?.content || '')
        .filter(Boolean)
        .join('');
    }

    if (!content && Array.isArray(body.choices)) {
      content = body.choices
        .map((c) => c?.message?.content || c?.text || '')
        .filter(Boolean)
        .join('');
      reasoning = body.choices
        .map((c) => c?.message?.reasoning_content || c?.message?.reasoning || '')
        .filter(Boolean)
        .join('');
    }

    if (!content && Array.isArray(body.candidates)) {
      const candidate = body.candidates[0];
      if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
         candidate.content.parts.forEach(p => {
           if (p.thought) {
             reasoning += (reasoning ? '\n' : '') + (p.text || '');
           } else if (p.inlineData) {
             content += `\n![${p.inlineData.mimeType || 'image'}](data:${p.inlineData.mimeType};base64,${p.inlineData.data})\n`;
           } else {
             content += (p.text || '');
           }
         });
      }
    }

    if (!content) {
      const lines = [];
      if (Array.isArray(body.rawSse)) {
        lines.push(...body.rawSse);
      }
      if (lines.length) {
        const parsed = parseGeminiSseLines(lines);
        if (parsed.content) content = parsed.content;
        if (parsed.reasoning) reasoning = parsed.reasoning;
      }
    }

    if (!content) {
      try {
        content = JSON.stringify(body, null, 2);
      } catch {
        content = String(body);
      }
    }

    if (typeof content === 'string') {
         const trimmed = content.trim();
         if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
             const parsed = safeParseJson(content);
             if (parsed) {
                 content = JSON.stringify(parsed, null, 2);
             }
         }
    }

    return { content, reasoning };
  }

  return { content: String(body), reasoning: '' };
}

function parseGeminiSseLines(lines) {
  const contentParts = [];
  const reasoningParts = [];
  lines.forEach((line) => {
    const trimmed = (line || '').trim();
    if (!trimmed) return;
    let jsonString = trimmed;
    if (trimmed.startsWith('data: ')) {
      jsonString = trimmed.substring(6).trim();
    }
    if (!jsonString || jsonString === '[DONE]') return;
    try {
      const chunk = JSON.parse(jsonString);
      const cand = chunk.candidates?.[0];
      const parts = cand?.content?.parts;
      if (Array.isArray(parts)) {
        parts.forEach((p) => {
          if (p.inlineData) {
            contentParts.push(`\n![${p.inlineData.mimeType || 'image'}](data:${p.inlineData.mimeType};base64,${p.inlineData.data})\n`);
          } else if (p.text) {
            if (p.thought === true) reasoningParts.push(p.text);
            else contentParts.push(p.text);
          }
        });
      }
    } catch {
      // ignore parse errors
    }
  });
  return {
    content: contentParts.filter(Boolean).join(''),
    reasoning: reasoningParts.filter(Boolean).join('')
  };
}

function extractRequestMessages(body) {
  const messages = [];
  const add = (role, content) => {
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && (trimmed.endsWith('}') || trimmed.endsWith(']'))) {
        const parsed = safeParseJson(content);
        if (parsed) {
          const inner = extractRequestMessages(parsed);
          if (inner.length > 0 && !(inner.length === 1 && inner[0].role === 'MESSAGE')) {
            inner.forEach(m => messages.push(m));
            return;
          }
        }
      }
    }
    
    messages.push({
      role: (role || 'unknown').toString().toUpperCase(),
      content: content || ''
    });
  };

  if (!body) return messages;

  if (typeof body === 'string') {
    const parsed = safeParseJson(body);
    if (parsed) return extractRequestMessages(parsed);
    add('MESSAGE', body);
    return messages;
  }

  if (Array.isArray(body)) {
    body.forEach((item) => {
      if (item && typeof item === 'object') {
        let content = '';
        if (Array.isArray(item.parts)) {
            content = item.parts.map(p => p.text || JSON.stringify(p)).join('\n');
        } else {
            content = item.content || item.mainText || item.text || item.message || '';
            if (typeof content === 'object') {
                content = JSON.stringify(content, null, 2);
            }
        }
        add(item.role, content);
      } else {
        add('MESSAGE', String(item));
      }
    });
    return messages;
  }

  if (typeof body === 'object') {
    if (Array.isArray(body.messages)) {
      body.messages.forEach((m) => {
        let content = m.content;
        if (Array.isArray(content)) {
          content = content.map(c => {
            if (c.type === 'text') return c.text;
            if (c.type === 'image_url') {
                const url = c.image_url?.url || '';
                return `![Image](${url})`;
            }
            return JSON.stringify(c);
          }).join('\n');
        }
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
          const tools = m.tool_calls.map(tc => {
            const args = tc.function?.arguments || '';
            return `[ToolCall: ${tc.function?.name}(${args})]`;
          }).join('\n');
          content = (content ? content + '\n' : '') + tools;
        }
        add(m.role, content);
      });
    }
    if (body.system_instruction || body.systemInstruction) {
      const sys = body.system_instruction || body.systemInstruction;
      const parts = sys.parts || [];
      const text = parts.map(p => p.text || '').join('\n');
      if (text) add('SYSTEM', text);
    }

    if (Array.isArray(body.contents)) {
      body.contents.forEach((c) => {
        const parts = c.parts || [];
        let handledAsTunneled = false;
        if (parts.length === 1 && parts[0] && Array.isArray(parts[0].text)) {
          parts[0].text.forEach((item) => {
            if (item && typeof item === 'object') {
              const role = item.role || c.role;
              const content = item.mainText || item.text || item.content || '';
              if (content) add(role, content);
            }
          });
          handledAsTunneled = true;
        }

        if (!handledAsTunneled) {
          const text = parts.map((p) => {
            if (typeof p.text === 'string') return p.text;
            if (p.inlineData) {
              return `\n![${p.inlineData.mimeType || 'image'}](data:${p.inlineData.mimeType};base64,${p.inlineData.data})\n`;
            }
            if (p.text && typeof p.text === 'object') {
               if (Array.isArray(p.text)) {
                   return p.text.map(item => item.mainText || item.text || item.content || JSON.stringify(item)).join('\n');
               }
               return p.text.mainText || p.text.text || p.text.content || JSON.stringify(p.text);
            }
            return '';
          }).filter(Boolean).join('\n');
          if (text) add(c.role, text);
        }
      });
    }
    if (Array.isArray(body.prompt)) {
      body.prompt.forEach((p) => {
        const text = (p.parts || []).map((pt) => pt.text || '').filter(Boolean).join('\n');
        add(p.role, text);
      });
    }
    if (messages.length === 0 && body.role && body.content) {
      add(body.role, body.content);
    }
    if (messages.length === 0) {
      add('MESSAGE', (() => { try { return JSON.stringify(body, null, 2); } catch { return String(body); } })());
    }
    return messages;
  }

  add('MESSAGE', String(body));
  return messages;
}

function renderRequestBlocks(container, body) {
  if (!container) return;
  container.innerHTML = '';
  const messages = extractRequestMessages(body);
  if (!messages.length) {
    container.textContent = '暂无';
    return;
  }
  messages.forEach((msg) => {
    const block = document.createElement('div');
    block.className = 'msg-block';
    const role = document.createElement('div');
    role.className = 'msg-role';
    role.textContent = msg.role || 'UNKNOWN';
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = renderMarkdown(msg.content || '');
    block.appendChild(role);
    block.appendChild(content);
    container.appendChild(block);
  });
}

function buildRequestPreview(body) {
  const messages = extractRequestMessages(body);
  if (!messages.length) return '暂无';
  return messages.map(m => `${m.role}: ${m.content || ''}`).join('\n');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>');
}

function renderMarkdown(text) {
  if (!text) return '暂无';
  let content = String(text);
  
  content = content.replace(/\\\\n/g, '\n');
  content = content.replace(/\\n/g, '\n');
  content = content.replace(/\\r/g, '');
  content = content.replace(/\\t/g, '  ');
  content = content.replace(/\n/g, '___NEWLINE___');

  let escaped = escapeHtml(content);
  escaped = escaped.replace(/___NEWLINE___/g, '<br>');
  
  const parts = escaped.split(/(```[\s\S]*?```)/g);
  
  return parts.map(part => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        return `<pre><code class="language-${match[1]}">${match[2]}</code></pre>`;
      }
      return part;
    }
    return part
      .replace(/^### (.*$)/gm, '<h4>$1</h4>')
      .replace(/^## (.*$)/gm, '<h4>$1</h4>')
      .replace(/^# (.*$)/gm, '<h4>$1</h4>')
      .replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
        return `
          <div style="position: relative; display: inline-block; margin: 8px 0;">
            <img src="${src}" alt="${alt}" style="max-width: 100%; max-height: 400px; height: auto; border-radius: 4px; object-fit: contain; display: block;" />
            <a href="${src}" download="image-${Date.now()}.png" class="btn btn-xs ghost" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.6); color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-decoration: none; backdrop-filter: blur(4px);" title="下载图片" target="_blank">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </a>
          </div>
        `;
      })
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }).join('');
}
