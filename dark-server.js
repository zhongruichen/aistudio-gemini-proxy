// --- START OF FILE dark-server.js (Enhanced Version with Connection Pool) ---

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');
const cors = require('cors');
const { exec } = require('child_process');
const pinyin = require('tiny-pinyin');

class LoggingService {
  constructor(serviceName = 'ProxyServer') {
    this.serviceName = serviceName;
    this.listeners = [];
    this.colors = {
      reset: "\x1b[0m",
      bright: "\x1b[1m",
      dim: "\x1b[2m",
      underscore: "\x1b[4m",
      blink: "\x1b[5m",
      reverse: "\x1b[7m",
      hidden: "\x1b[8m",
      
      fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
        gray: "\x1b[90m",
        crimson: "\x1b[38;5;196m",
        orange: "\x1b[38;5;208m",
        purple: "\x1b[38;5;129m",
        pink: "\x1b[38;5;213m",
        gold: "\x1b[38;5;220m",
        ice: "\x1b[38;5;51m",
      },
      bg: {
        black: "\x1b[40m",
        red: "\x1b[41m",
        green: "\x1b[42m",
        yellow: "\x1b[43m",
        blue: "\x1b[44m",
        magenta: "\x1b[45m",
        cyan: "\x1b[46m",
        white: "\x1b[47m"
      }
    };

    this.icons = {
      info: 'ℹ️ ',
      success: '✅',
      warn: '⚠️ ',
      error: '❌',
      debug: '🐛',
      rocket: '🚀',
      fire: '🔥',
      star: '⭐',
      lock: '🔒',
      key: '🔑',
      network: '🌐',
      server: '🖥️ ',
      time: '⏱️ ',
      robot: '🤖',
      brain: '🧠',
      zap: '⚡',
      chart: '📊'
    };
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  _emit(level, message) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message
    };
    this.listeners.forEach(cb => {
      try { cb(logEntry); } catch (e) { console.error('Error in log listener:', e); }
    });
  }

  // RGB Color Helper
  rgb(r, g, b) {
    return `\x1b[38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m`;
  }

  // Gradient Text Helper
  gradient(text, startColor, endColor) {
    const steps = text.length;
    let result = '';
    for (let i = 0; i < steps; i++) {
      const r = startColor.r + (endColor.r - startColor.r) * (i / (steps - 1 || 1));
      const g = startColor.g + (endColor.g - startColor.g) * (i / (steps - 1 || 1));
      const b = startColor.b + (endColor.b - startColor.b) * (i / (steps - 1 || 1));
      result += this.rgb(r, g, b) + text[i];
    }
    return result + this.colors.reset;
  }

  _formatMessage(level, message, color = null) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
    
    let levelColor = '';
    let icon = '';
    let levelLabel = level;

    if (color) {
      levelColor = color;
    } else {
      switch(level) {
        case 'INFO':
          levelColor = this.colors.fg.cyan;
          icon = this.icons.info;
          break;
        case 'ERROR':
          levelColor = this.colors.fg.red;
          icon = this.icons.error;
          break;
        case 'WARN':
          levelColor = this.colors.fg.yellow;
          icon = this.icons.warn;
          break;
        case 'DEBUG':
          levelColor = this.colors.fg.gray;
          icon = this.icons.debug;
          break;
        case 'SUCCESS':
          levelColor = this.colors.fg.green;
          icon = this.icons.success;
          break;
        default:
          levelColor = this.colors.fg.white;
      }
    }

    // 美化格式: [TIME] ICON LEVEL [SERVICE] MESSAGE
    const gray = this.colors.fg.gray;
    const reset = this.colors.reset;
    const bright = this.colors.bright;
    const magenta = this.colors.fg.magenta;
    
    // 使用更紧凑和现代的格式
    const prefix = `${gray}${timeStr}${reset} ${icon} ${levelColor}${bright}${levelLabel.padEnd(7)}${reset} ${magenta}│${reset}`;
    return `${prefix} ${message}`;
  }

  info(message) {
    console.log(this._formatMessage('INFO', message));
    this._emit('INFO', message);
  }

  success(message) {
    console.log(this._formatMessage('SUCCESS', message, this.colors.fg.green));
    this._emit('INFO', message);
  }

  error(message) {
    console.error(this._formatMessage('ERROR', message));
    this._emit('ERROR', message);
  }

  warn(message) {
    console.warn(this._formatMessage('WARN', message));
    this._emit('WARN', message);
  }

  debug(message) {
    console.debug(this._formatMessage('DEBUG', message));
    this._emit('DEBUG', message);
  }
  
  raw(message) {
    console.log(message);
  }
}

class MessageQueue extends EventEmitter {
  constructor(timeoutMs = 600000) {
    super();
    this.messages = [];
    this.waitingResolvers = [];
    this.defaultTimeout = timeoutMs;
    this.closed = false;
  }

  enqueue(message) {
    if (this.closed) return;

    if (this.waitingResolvers.length > 0) {
      const resolver = this.waitingResolvers.shift();
      if (resolver && resolver.timeoutId) {
        clearTimeout(resolver.timeoutId);
      }
      resolver.resolve(message);
    } else {
      this.messages.push(message);
    }
  }

  async dequeue(timeoutMs = this.defaultTimeout) {
    if (this.closed) {
      throw new Error('Queue is closed');
    }

    return new Promise((resolve, reject) => {
      if (this.messages.length > 0) {
        resolve(this.messages.shift());
        return;
      }

      const resolver = { resolve, reject };
      this.waitingResolvers.push(resolver);

      const timeoutId = setTimeout(() => {
        const index = this.waitingResolvers.indexOf(resolver);
        if (index !== -1) {
          this.waitingResolvers.splice(index, 1);
          reject(new Error('Queue timeout'));
        }
      }, timeoutMs);

      resolver.timeoutId = timeoutId;
    });
  }

  close() {
    this.closed = true;
    this.waitingResolvers.forEach(resolver => {
      clearTimeout(resolver.timeoutId);
      resolver.reject(new Error('Queue closed'));
    });
    this.waitingResolvers = [];
    this.messages = [];
  }
}

// 新增：额度管理器类
class QuotaManager {
  constructor(logger) {
    this.logger = logger;
    this.config = {};
    this.modelToGroupMap = new Map();
    this.stateFile = path.join(process.cwd(), 'quota-state.json');
    this.configFile = path.join(process.cwd(), 'quota-config.json');
    this.quotaState = {}; // { connectionId: { groupId: { used: 0, limit: 100, status: 'active', last429: 0, rateLimitCount: 0 } } }
    this.loadConfig();
    this.loadState();
    
    // 定时保存状态 (每分钟)
    setInterval(() => this.saveState(), 60 * 1000);
    // 定时检查重置 (每分钟)
    setInterval(() => this.checkReset(), 60 * 1000);
  }

  loadConfig() {
    try {
      if (fs.existsSync(this.configFile)) {
        const data = fs.readFileSync(this.configFile, 'utf8');
        this.config = JSON.parse(data);
        this._buildModelMap();
        this.logger.success('额度配置已加载');
      } else {
        this.logger.warn('未找到额度配置文件，使用默认配置');
        this.config = { groups: {}, default: { limit: 50 } };
      }
    } catch (e) {
      this.logger.error(`加载额度配置失败: ${e.message}`);
    }
  }

  _buildModelMap() {
    this.modelToGroupMap.clear();
    if (this.config.groups) {
      for (const [groupId, groupConfig] of Object.entries(this.config.groups)) {
        if (Array.isArray(groupConfig.models)) {
          for (const model of groupConfig.models) {
            this.modelToGroupMap.set(model, groupId);
          }
        }
      }
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.quotaState = JSON.parse(data);
        this.logger.success('额度状态已加载');
      }
    } catch (e) {
      this.logger.warn(`加载额度状态失败: ${e.message}`);
      this.quotaState = {};
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.quotaState, null, 2));
    } catch (e) {
      this.logger.error(`保存额度状态失败: ${e.message}`);
    }
  }

  getGroup(model) {
    const group = this.modelToGroupMap.get(model);
    if (group) return group;

    // models-list 不应消耗默认额度，归类为 system (未定义组，不计费)
    if (model === 'models-list') return 'system';

    return 'default';
  }

  getGroupConfig(groupId) {
    return this.config.groups?.[groupId] || this.config.default || { limit: 50 };
  }

  // 获取下一次重置时间 (太平洋时间 00:00)
  getNextResetTime() {
    const now = new Date();
    const ptString = now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
    const ptDate = new Date(ptString);
    ptDate.setDate(ptDate.getDate() + 1);
    ptDate.setHours(0, 0, 0, 0);
    const diff = ptDate.getTime() - new Date(ptString).getTime();
    return Date.now() + diff;
  }

  checkReset() {
    // 简单实现：如果当前时间超过了记录的重置时间，或者跨天了
    // 这里使用 getNextResetTime 计算出的时间点作为参考
    // 实际上，我们可以在每次 getQuota 时检查是否需要重置
    // 为了简化，我们遍历所有状态，如果发现 lastResetTime 不是今天(PT)，则重置
    
    const now = new Date();
    const ptString = now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
    const ptDate = new Date(ptString);
    const todayPT = `${ptDate.getFullYear()}-${ptDate.getMonth()+1}-${ptDate.getDate()}`;

    let resetCount = 0;
    for (const connId in this.quotaState) {
      for (const groupId in this.quotaState[connId]) {
        const state = this.quotaState[connId][groupId];
        if (state.lastResetDate !== todayPT) {
          state.used = 0;
          state.status = 'active';
          state.rateLimitCount = 0;
          state.lastResetDate = todayPT;
          resetCount++;
        }
      }
    }
    if (resetCount > 0) {
      const c = this.logger.colors;
      const icons = this.logger.icons || {};
      this.logger.info(`${icons.time || ''} 已重置 ${c.fg.cyan}${resetCount}${c.reset} 个额度组状态 (PT: ${todayPT})`);
      this.saveState();
    }
  }

  // 初始化连接的额度状态
  initConnectionQuota(connectionId) {
    if (!this.quotaState[connectionId]) {
      this.quotaState[connectionId] = {};
    }
    // 预填充所有已知组
    const allGroups = Object.keys(this.config.groups || {}).concat(['default']);
    const now = new Date();
    const ptString = now.toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
    const ptDate = new Date(ptString);
    const todayPT = `${ptDate.getFullYear()}-${ptDate.getMonth()+1}-${ptDate.getDate()}`;

    for (const groupId of allGroups) {
      if (!this.quotaState[connectionId][groupId]) {
        const config = this.getGroupConfig(groupId);
        this.quotaState[connectionId][groupId] = {
          used: 0,
          limit: config.limit,
          status: 'active',
          last429: 0,
          rateLimitCount: 0,
          lastResetDate: todayPT
        };
      }
    }
  }
  
  // 移除连接状态
  removeConnection(connectionId) {
      // 选择不移除，保留历史状态以便重连恢复
      // if (this.quotaState[connectionId]) {
      //     delete this.quotaState[connectionId];
      // }
  }

  // 记录使用
  recordUsage(connectionId, model) {
    const groupId = this.getGroup(model);
    this.initConnectionQuota(connectionId);
    const state = this.quotaState[connectionId][groupId];
    if (state) {
      state.used++;
      // 动态额度调整：如果超过上限且未报错，自动提升上限 (保守调整 +1)
      if (state.used > state.limit && state.status === 'active') {
          state.limit = state.used + 1;
      }
    }
  }

  // 处理 429
  handleRateLimit(connectionId, model) {
    const groupId = this.getGroup(model);
    this.initConnectionQuota(connectionId);
    const state = this.quotaState[connectionId][groupId];
    if (!state) return;

    const now = Date.now();
    // 1小时内重置计数器
    if (now - state.last429 > 60 * 60 * 1000) {
      state.rateLimitCount = 0;
    }
    
    state.rateLimitCount++;
    state.last429 = now;

    // 修正：如果触发 429，说明之前的动态调整可能过高了，或者确实耗尽了
    // 将 limit 修正为当前 used 值（因为显然已经发不出去了）
    if (state.used < state.limit) {
        state.limit = state.used;
    }

    if (state.rateLimitCount === 1) {
      // Level 1: 冷却 1 分钟
      state.status = 'cooldown';
      state.cooldownEnd = now + 60 * 1000;
      const c = this.logger.colors;
      this.logger.warn(`[Quota] 连接 ${c.fg.yellow}${connectionId}${c.reset} 组 ${c.fg.cyan}${groupId}${c.reset} 触发首次 429，冷却 1 分钟`);
    } else {
      // Level 2: 耗尽
      state.status = 'exhausted';
      state.cooldownEnd = this.getNextResetTime();
      // state.used = state.limit; // 不需要手动填满，因为上面已经 clamp 了 limit
      const c = this.logger.colors;
      this.logger.warn(`[Quota] 连接 ${c.fg.yellow}${connectionId}${c.reset} 组 ${c.fg.cyan}${groupId}${c.reset} 确认耗尽，冷却至次日`);
    }
    this.saveState();
  }

  // 检查是否可用
  isAvailable(connectionId, model) {
    const groupId = this.getGroup(model);
    // 如果没有初始化，视为可用（会在使用时初始化）
    if (!this.quotaState[connectionId] || !this.quotaState[connectionId][groupId]) return true;
    
    const state = this.quotaState[connectionId][groupId];
    if (state.status === 'exhausted') {
        // 检查是否已过重置时间
        if (Date.now() > state.cooldownEnd) {
            state.status = 'active';
            state.used = 0;
            return true;
        }
        return false;
    }
    if (state.status === 'cooldown') {
        if (Date.now() > state.cooldownEnd) {
            state.status = 'active';
            return true;
        }
        return false;
    }
    return true;
  }
  
  // 获取连接的剩余额度 (用于智能路由)
  getRemaining(connectionId, model) {
      const groupId = this.getGroup(model);
      if (!this.quotaState[connectionId] || !this.quotaState[connectionId][groupId]) return 100; // 默认值
      const state = this.quotaState[connectionId][groupId];
      return Math.max(0, state.limit - state.used);
  }
  
  // 获取所有状态 (用于UI)
  getAllState() {
      return this.quotaState;
  }
  
  // 获取总览 (用于UI)
  getPoolOverview(activeConnectionIds = []) {
      const overview = {};
      const allGroups = Object.keys(this.config.groups || {}).concat(['default']);
      
      for (const groupId of allGroups) {
          overview[groupId] = { totalLimit: 0, totalUsed: 0, activeConnections: 0 };
      }
      
      // 只统计活跃连接的额度
      for (const connId of activeConnectionIds) {
          if (!this.quotaState[connId]) continue;
          
          for (const groupId in this.quotaState[connId]) {
              if (!overview[groupId]) continue;
              const state = this.quotaState[connId][groupId];
              overview[groupId].totalLimit += state.limit;
              overview[groupId].totalUsed += state.used;
              overview[groupId].activeConnections++;
          }
      }
      return overview;
  }
}

// 新增：WebSocket连接池类
class WebSocketPool extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      minConnections: 3,        // 最小连接数
      maxConnections: 10,       // 最大连接数
      cleanupInterval: 60000,     // 清理检查间隔（60秒）
      reconnectDelay: 5000,     // 重连延迟（5秒）
      connectionTimeout: 10000,  // 连接超时（10秒）
      historyRetentionMs: 24 * 60 * 60 * 1000, // 历史记录保留时长（24小时）
      ...config
    };
    
    this.quotaManager = new QuotaManager(logger); // 集成 QuotaManager
    
    this.connections = new Map(); // 存储所有连接 {id: {ws, status, lastUsed, requestCount}}
    this.clientHistory = new Map(); // 存储断开连接的客户端历史状态 {clientId: {stats, cooldowns, lastSeen}}
    this.connectionOrder = [];    // 连接顺序，用于生成友好名称
    this.roundRobinIndex = 0;     // 轮询索引
    this.messageQueues = new Map(); // 消息队列
    this.requestConnectionMap = new Map(); // 请求ID到连接ID的映射
    this.requestModelMap = new Map(); // 请求ID到模型的映射
    this.pendingRetries = new Map(); // 等待重试的请求
    this.isShuttingDown = false;
  }

  // 初始化连接池（不预创建连接，等待实际连接进来）
  async initialize() {
    const c = this.logger.colors;
    const icons = this.logger.icons || {};
    this.logger.info(`${icons.rocket || ''} 连接池初始化完成，等待WebSocket连接...`);
    this.logger.info(`${icons.info || ''} 配置：最小连接数=${c.fg.cyan}${this.config.minConnections}${c.reset}, 最大连接数=${c.fg.cyan}${this.config.maxConnections}${c.reset}`);
    
    // 定期清理过期的历史记录
    setInterval(() => this._cleanupHistory(), 60 * 60 * 1000);
  }

  _cleanupHistory() {
    const now = Date.now();
    let cleaned = 0;
    for (const [clientId, history] of this.clientHistory.entries()) {
      if (now - history.lastSeen > this.config.historyRetentionMs) {
        this.clientHistory.delete(clientId);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      const c = this.logger.colors;
      this.logger.info(`清理了 ${c.fg.cyan}${cleaned}${c.reset} 条过期的客户端历史记录`);
    }
  }

  _saveClientHistory(connectionInfo) {
    if (!connectionInfo || !connectionInfo.clientId) return;
    
    const history = {
      displayName: connectionInfo.displayName,
      requestCount: connectionInfo.requestCount || 0,
      successCount: connectionInfo.successCount || 0,
      errorCount: connectionInfo.errorCount || 0,
      rateLimitCount: connectionInfo.rateLimitCount || 0,
      cooldowns: connectionInfo.cooldowns || {},
      lastSeen: Date.now()
    };
    
    this.clientHistory.set(connectionInfo.clientId, history);
    this.logger.debug(`保存客户端历史记录: ${connectionInfo.clientId}`);
  }

  _restoreClientHistory(connectionInfo, clientId) {
    const history = this.clientHistory.get(clientId);
    if (!history) return false;

    // 恢复统计数据
    connectionInfo.requestCount = (connectionInfo.requestCount || 0) + history.requestCount;
    connectionInfo.successCount = (connectionInfo.successCount || 0) + history.successCount;
    connectionInfo.errorCount = (connectionInfo.errorCount || 0) + history.errorCount;
    connectionInfo.rateLimitCount = (connectionInfo.rateLimitCount || 0) + history.rateLimitCount;
    
    // 恢复并合并冷却数据
    const now = Date.now();
    connectionInfo.cooldowns = connectionInfo.cooldowns || {};
    if (history.cooldowns) {
      for (const [model, expiresAt] of Object.entries(history.cooldowns)) {
        if (expiresAt > now) {
          // 如果当前也有该模型的冷却，取较晚的时间
          const currentExpires = connectionInfo.cooldowns[model] || 0;
          connectionInfo.cooldowns[model] = Math.max(currentExpires, expiresAt);
        }
      }
    }

    // 恢复显示名称（如果当前是默认名称）
    if (connectionInfo.displayName && connectionInfo.displayName.startsWith('连接') && history.displayName) {
      connectionInfo.displayName = history.displayName;
    }

    const c = this.logger.colors;
    this.logger.success(`已恢复客户端 ${c.fg.cyan}${clientId}${c.reset} 的历史状态 (请求: ${history.requestCount}, 429: ${history.rateLimitCount})`);
    return true;
  }

  // 创建新连接槽位（仅在需要时创建）
  async createConnectionSlot() {
    if (this.connections.size >= this.config.maxConnections) {
      this.logger.warn('已达到最大连接数限制');
      return null;
    }

    const connectionId = this.generateConnectionId();
    const connectionInfo = {
      id: connectionId,
      ws: null,
      status: 'waiting',  // 等待实际连接
      lastUsed: Date.now(),
      requestCount: 0,
      reconnectAttempts: 0,
      created: Date.now()
    };

    this.connections.set(connectionId, connectionInfo);
    this.logger.debug(`创建连接槽位: ${connectionId}`);
    
    return connectionId;
  }


  // 接受WebSocket连接
  acceptConnection(ws, clientInfo) {
    if (this.connections.size >= this.config.maxConnections) {
      const address = clientInfo && clientInfo.address ? clientInfo.address : 'unknown';
      this.logger.warn(`连接池已满，拒绝连接: ${address}`);
      ws.close(1013, 'Connection pool full');
      return;
    }

    const connectionId = this.generateConnectionId();
    const connectionInfo = {
      id: connectionId,
      displayName: `连接${this.connectionOrder.length + 1}`,
      ws: ws,
      status: 'active',
      lastUsed: Date.now(),
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      disabled: false,  // 是否被禁用
      disabledReason: null,
      reconnectAttempts: 0,
      created: Date.now(),
      lastHeartbeat: null,
      heartbeatLatency: null,
      // cooldowns: {} // 移除旧的冷却字段，使用 QuotaManager
    };

    this.connections.set(connectionId, connectionInfo);
    this.connectionOrder.push(connectionId);
    
    // 初始化额度状态
    this.quotaManager.initConnectionQuota(connectionId);

    const c = this.logger.colors;
    const icons = this.logger.icons || {};
    this.logger.success(`${icons.rocket || ''} WebSocket连接已建立: ${c.bright}${connectionId}${c.reset} ${c.dim}(来自 ${clientInfo.address})${c.reset}`);
    this.logger.info(`${icons.chart || ''} 当前活跃连接数: ${c.fg.cyan}${this.getActiveConnectionCount()}${c.reset}`);

    // 设置连接事件处理
    ws.on('message', (data) => {
      const currentId = ws.currentConnectionId || connectionId;
      this.handleIncomingMessage(currentId, data.toString());
    });

    ws.currentConnectionId = connectionId; // 初始化 ID

    ws.on('close', () => {
      const currentId = ws.currentConnectionId || connectionId;
      this.handleConnectionClose(currentId, ws);
    });

    ws.on('error', (error) => {
      this.logger.error(`WebSocket连接错误 [${connectionId}]: ${error.message}`);
      this.handleConnectionError(connectionId, error);
    });

    this.emit('connectionAdded', connectionId);
  }

  // 处理接收到的消息
  handleIncomingMessage(connectionId, messageData) {
    try {
      const parsedMessage = JSON.parse(messageData);

      // 处理客户端信息（握手/签名）
      if (parsedMessage.event_type === 'client_info') {
        this.handleClientInfo(connectionId, parsedMessage);
        return;
      }

      // 心跳消息没有 request_id，单独处理避免误报
      if (parsedMessage.event_type === 'ping') {
        const ts = Number(parsedMessage.timestamp);
        const now = Date.now();
        // 将心跳日志提升为 INFO 以便排查，确认连接是否真的在发送心跳
        this.logger.info(`收到心跳 ping [连接: ${connectionId}], ts=${Number.isFinite(ts) ? ts : 'n/a'}`);
        const connectionInfo = this.connections.get(connectionId);
        if (connectionInfo) {
          connectionInfo.lastUsed = now;
          connectionInfo.lastHeartbeat = now;
          if (Number.isFinite(ts)) {
            connectionInfo.heartbeatLatency = Math.max(0, now - ts);
          }
          if (connectionInfo.ws && connectionInfo.ws.readyState === WebSocket.OPEN) {
            try {
              connectionInfo.ws.send(JSON.stringify({
                event_type: 'pong',
                timestamp: Number.isFinite(ts) ? ts : Date.now()
              }));
            } catch (err) {
              this.logger.warn(`发送pong响应失败 [连接: ${connectionId}]: ${err.message}`);
            }
          }
        }
        return;
      }

      const requestId = parsedMessage.request_id;

      if (!requestId) {
        this.logger.warn(`收到无效消息：缺少request_id [连接: ${connectionId}]`);
        return;
      }

      // 检查是否是429错误 (支持 error 事件和 response_headers 事件中的 429)
      const isRateLimit =
        (parsedMessage.event_type === 'error' && parsedMessage.status == 429) ||
        (parsedMessage.event_type === 'response_headers' && parsedMessage.status == 429);

      if (isRateLimit) {
        this.logger.warn(`收到429响应，尝试更换连接: ${requestId}`);
        this.handleRateLimitError(requestId, connectionId, parsedMessage);
        return;
      }

      const queue = this.messageQueues.get(requestId);
      if (queue) {
        this.routeMessage(parsedMessage, queue);
      } else {
        this.logger.warn(`收到未知请求ID的消息: ${requestId}`);
      }
    } catch (error) {
      this.logger.error(`解析WebSocket消息失败 [连接: ${connectionId}]`);
    }
  }

  // 处理客户端身份信息
  handleClientInfo(connectionId, message) {
    const { client_id, timestamp } = message;
    if (!client_id) return;

    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo) return;

    // 检查新ID是否已存在
    if (this.connections.has(client_id)) {
      // 顶号逻辑：如果ID已存在，踢掉旧连接
      this.logger.warn(`客户端ID冲突: ${client_id}，踢掉旧连接，允许新连接 ${connectionId} 上位`);
      
      const oldConn = this.connections.get(client_id);
      if (oldConn) {
        // 保存旧连接状态到历史记录，以便稍后恢复到新连接
        this._saveClientHistory(oldConn);

        // 1. 立即执行逻辑清理（传入旧ws以通过校验）
        // 注意：handleConnectionClose 内部也会调用 _saveClientHistory，但为了保险起见（防止时序问题），这里显式保存一次也无妨
        // 实际上 handleConnectionClose 会处理保存，所以这里主要负责关闭
        this.handleConnectionClose(client_id, oldConn.ws);
        
        // 2. 物理关闭旧连接（如果还开着）
        if (oldConn.ws && oldConn.ws.readyState !== WebSocket.CLOSED) {
          try {
            oldConn.ws.close(4000, 'Duplicate client ID');
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // 更新 ID
    const oldId = connectionId;
    const newId = client_id;

    // 1. 更新 Map
    this.connections.delete(oldId);
    connectionInfo.id = newId;
    connectionInfo.displayName = `客户端 ${client_id}`;
    connectionInfo.clientId = client_id;
    connectionInfo.clientTimestamp = timestamp;
    
    // 尝试恢复历史状态（无论是刚刚顶号保存的，还是之前断开保存的）
    this._restoreClientHistory(connectionInfo, client_id);
    
    // 迁移 QuotaManager 中的状态
    // 关键修复：如果 newId (持久化ID) 已存在历史状态，应优先保留历史状态，而不是被 oldId (临时ID) 的空状态覆盖
    if (this.quotaManager.quotaState[newId]) {
        // 如果新ID已有状态（说明是重启后恢复的持久化数据），直接使用它
        // 并清理旧的临时ID状态
        if (this.quotaManager.quotaState[oldId]) {
            delete this.quotaManager.quotaState[oldId];
        }
        this.logger.info(`[Quota] 恢复客户端 ${newId} 的持久化额度状态`);
    } else if (this.quotaManager.quotaState[oldId]) {
        // 如果新ID没有状态，则将旧ID的状态迁移过去（首次连接场景）
        this.quotaManager.quotaState[newId] = this.quotaManager.quotaState[oldId];
        delete this.quotaManager.quotaState[oldId];
    } else {
        // 都没有，初始化新的
        this.quotaManager.initConnectionQuota(newId);
    }
    this.quotaManager.saveState();

    this.connections.set(newId, connectionInfo);

    // 2. 更新 ws 对象上的引用
    if (connectionInfo.ws) {
      connectionInfo.ws.currentConnectionId = newId;
    }

    // 3. 更新 connectionOrder
    const orderIndex = this.connectionOrder.indexOf(oldId);
    if (orderIndex !== -1) {
      this.connectionOrder[orderIndex] = newId;
    }

    // 4. 更新 requestConnectionMap (如果有正在进行的请求)
    for (const [reqId, connId] of this.requestConnectionMap.entries()) {
      if (connId === oldId) {
        this.requestConnectionMap.set(reqId, newId);
      }
    }

    const c = this.logger.colors;
    this.logger.success(`连接身份已验证: ${c.fg.yellow}${oldId}${c.reset} -> ${c.fg.green}${newId}${c.reset} (Time: ${timestamp})`);
    this.emit('connectionRenamed', { oldId, newId });
  }

  // 处理429错误（速率限制）- 标记模型冷却并尝试换连接重试
  async handleRateLimitError(requestId, failedConnectionId, message = null) {
    const connectionInfo = this.connections.get(failedConnectionId);
    if (!connectionInfo) return;

    connectionInfo.rateLimitCount = (connectionInfo.rateLimitCount || 0) + 1;
    
    let model = this.requestModelMap.get(requestId) || null;
    if (!model && message && message.model) {
      model = message.model;
    }
    if (!model) {
      const pending = this.pendingRetries.get(requestId);
      try {
        const bodyObj = pending?.body ? JSON.parse(pending.body) : null;
        model = bodyObj?.model || null;
      } catch (_) {}
    }

    if (model) {
      // 使用 QuotaManager 处理 429
      this.quotaManager.handleRateLimit(failedConnectionId, model);
    }

    const pendingRequest = this.pendingRetries.get(requestId);
    const queue = this.messageQueues.get(requestId);
    const alternativeConnection = this.getHealthyConnection(model, [failedConnectionId]);

    if (pendingRequest && alternativeConnection) {
      const c = this.logger.colors;
      this.logger.info(`使用备用连接 ${c.fg.green}${alternativeConnection.id}${c.reset} 重试请求 ${c.fg.cyan}${requestId}${c.reset}`);
      this.requestConnectionMap.set(requestId, alternativeConnection.id);
      try {
        // 记录新连接的使用
        this.quotaManager.recordUsage(alternativeConnection.id, model);
        alternativeConnection.ws.send(JSON.stringify(pendingRequest));
        return;
      } catch (err) {
        this.logger.error(`备用连接重试失败: ${err.message}`);
      }
    }

    if (queue) {
      queue.enqueue({
        event_type: 'error',
        status: 429,
        message: 'Rate limited and no alternative connection available'
      });
    }
  }

  // 将后端返回的 WebSocket 消息分发到对应的队列
  routeMessage(message, queue) {
    const { event_type } = message;

    switch (event_type) {
      case 'response_headers':
      case 'chunk':
      case 'error':
        queue.enqueue(message);
        break;
      case 'stream_close':
        queue.enqueue({ type: 'STREAM_END' });
        break;
      default:
        this.logger.warn(`收到未知的事件类型: ${event_type}`);
    }
  }

  handleConnectionClose(connectionId, closedWs = null) {
    const connectionInfo = this.connections.get(connectionId);
    
    // 安全校验：如果指定了 closedWs，必须确保它就是当前记录的 ws
    // 防止 Race Condition：旧连接的 close 事件误删了已重命名的新连接
    if (connectionInfo && closedWs && connectionInfo.ws !== closedWs) {
      this.logger.debug(`忽略过期的连接关闭事件: ${connectionId} (WS不匹配)`);
      return;
    }

    if (connectionInfo) {
      // 保存状态到历史记录
      this._saveClientHistory(connectionInfo);

      connectionInfo.status = 'closed';
      connectionInfo.ws = null;
      const c = this.logger.colors;
      const icons = this.logger.icons || {};
      this.logger.warn(`${icons.warn || ''} 连接关闭: ${c.fg.yellow}${connectionId}${c.reset}`);
      this.connections.delete(connectionId);
      this.connectionOrder = this.connectionOrder.filter(id => id !== connectionId);
    }

    const affectedRequests = [];
    for (const [requestId, connId] of this.requestConnectionMap.entries()) {
      if (connId === connectionId) {
        affectedRequests.push(requestId);
      }
    }

    if (affectedRequests.length > 0) {
      this.logger.warn(`Connection ${connectionId} closed; handling ${affectedRequests.length} in-flight request(s).`);
    }

    affectedRequests.forEach((requestId) => {
      const pendingRequest = this.pendingRetries.get(requestId);
      const queue = this.messageQueues.get(requestId);
      const model = this.requestModelMap.get(requestId) || pendingRequest?.model || null;
      const alternativeConnection = this.getHealthyConnection(model, [connectionId]);

      if (pendingRequest && alternativeConnection) {
        this.requestConnectionMap.set(requestId, alternativeConnection.id);
        try {
          alternativeConnection.ws.send(JSON.stringify(pendingRequest));
          return;
        } catch (err) {
          this.logger.error(`Retry after connection close failed: ${err.message}`);
        }
      }

      if (queue) {
        queue.enqueue({
          event_type: 'error',
          status: 502,
          message: 'Connection closed and no alternative connection available'
        });
      } else {
        this.requestConnectionMap.delete(requestId);
        this.pendingRetries.delete(requestId);
        this.requestModelMap.delete(requestId);
      }
    });

    this.emit('connectionRemoved', connectionId);
  }

  // 处理连接错误
  handleConnectionError(connectionId, error) {
    const connectionInfo = this.connections.get(connectionId);
    if (connectionInfo) {
      connectionInfo.status = 'error';
      connectionInfo.lastError = error.message;
      if (connectionInfo.ws && connectionInfo.ws.readyState !== WebSocket.CLOSED && connectionInfo.ws.readyState !== WebSocket.CLOSING) {
        try {
          connectionInfo.ws.close();
        } catch (_) {
          // ignore close errors
        }
      }
    }
  }

  // 安排重连
  scheduleReconnect(connectionId) {
    const connectionInfo = this.connections.get(connectionId);
    if (!connectionInfo || connectionInfo.reconnectAttempts >= 3) {
      this.logger.warn(`连接 ${connectionId} 重连次数过多，放弃重连`);
      this.connections.delete(connectionId);
      
      // 不需要在这里补充连接
      return;
    }

    connectionInfo.reconnectAttempts++;
    const c = this.logger.colors;
    this.logger.info(`计划重连 ${c.fg.yellow}${connectionId}${c.reset}，第 ${c.fg.cyan}${connectionInfo.reconnectAttempts}${c.reset} 次尝试`);
    
    setTimeout(() => {
      if (this.connections.has(connectionId)) {
        connectionInfo.status = 'connecting';
        this.emit('reconnectAttempt', connectionId);
      }
    }, this.config.reconnectDelay);
  }


  // 选择一个健康的连接（可按模型/排除列表过滤）
  getHealthyConnection(model = null, excludeIds = []) {
    const now = Date.now();
    const activeConnections = Array.from(this.connections.values())
      .filter(conn => {
        if (conn.status !== 'active' || !conn.ws || conn.ws.readyState !== WebSocket.OPEN) return false;
        if (excludeIds.includes(conn.id)) return false;
        if (conn.disabled) return false;
        // 使用 QuotaManager 检查可用性
        if (model && !this.quotaManager.isAvailable(conn.id, model)) return false;
        return true;
      });

    if (activeConnections.length === 0) {
      return null;
    }

    // 智能路由：优先选择剩余额度最多的连接
    let selectedConnection = null;
    if (model) {
        activeConnections.sort((a, b) => {
            const remainingA = this.quotaManager.getRemaining(a.id, model);
            const remainingB = this.quotaManager.getRemaining(b.id, model);
            return remainingB - remainingA; // 降序
        });
        selectedConnection = activeConnections[0];
    } else {
        // 轮询挑选下一条连接
        this.roundRobinIndex = (this.roundRobinIndex + 1) % activeConnections.length;
        selectedConnection = activeConnections[this.roundRobinIndex];
    }

    selectedConnection.lastUsed = Date.now();
    selectedConnection.requestCount++;
    this.logger.debug(`选择连接 ${selectedConnection.id} (模型: ${model || 'none'})`);
    return selectedConnection;
  }

  // 清理和维护检查（移除了ping/pong健康检查）

  // 获取活跃连接数
  getActiveConnectionCount() {
    return Array.from(this.connections.values())
      .filter(conn => conn.status === 'active' && conn.ws && conn.ws.readyState === WebSocket.OPEN)
      .length;
  }

  // 检查是否有可用连接
  hasActiveConnections() {
    return this.getActiveConnectionCount() > 0;
  }

  // 创建消息队列
  createMessageQueue(requestId) {
    const queue = new MessageQueue();
    this.messageQueues.set(requestId, queue);
    return queue;
  }

  // 移除消息队列
  removeMessageQueue(requestId) {
    const queue = this.messageQueues.get(requestId);
    if (queue) {
      queue.close();
      this.messageQueues.delete(requestId);
    }
    this.requestConnectionMap.delete(requestId);
    this.pendingRetries.delete(requestId);
    this.requestModelMap.delete(requestId);
  }

  // 手动启用/禁用连接
  toggleConnection(connectionId, enable) {
    const connectionInfo = this.connections.get(connectionId);
    if (connectionInfo) {
      connectionInfo.disabled = !enable;
      if (enable) {
        connectionInfo.status = 'active';
        connectionInfo.disabledReason = null;
        this.logger.info(`连接 ${connectionInfo.displayName} 已手动启用`);
      } else {
        connectionInfo.status = 'disabled';
        connectionInfo.disabledReason = '手动禁用';
        this.logger.info(`连接 ${connectionInfo.displayName} 已手动禁用`);
      }
      return true;
    }
    return false;
  }
  
  // 获取连接详细信息
  getConnectionDetails() {
    const details = [];
    const quotaState = this.quotaManager.getAllState();
    
    for (const [id, info] of this.connections.entries()) {
      if (info.ws) {
        details.push({
          id: id,
          displayName: info.displayName,
          status: info.status,
          disabled: info.disabled,
          disabledReason: info.disabledReason,
          requestCount: info.requestCount,
          successCount: info.successCount,
          errorCount: info.errorCount,
          rateLimitCount: info.rateLimitCount,
          // 注入额度信息
          quota: quotaState[id] || {},
          created: info.created,
          lastUsed: info.lastUsed,
          lastHeartbeat: info.lastHeartbeat,
          heartbeatLatency: info.heartbeatLatency,
          isConnected: info.ws && info.ws.readyState === WebSocket.OPEN
        });
      }
    }
    return details;
  }

  // 手动清除指定连接的模型冷却（model === 'all' 清除全部）
  clearCooldown(connectionId, model) {
    // 适配 QuotaManager
    if (model === 'all') {
        this.quotaManager.initConnectionQuota(connectionId);
        const quotas = this.quotaManager.quotaState[connectionId];
        for (const groupId in quotas) {
            quotas[groupId].status = 'active';
            quotas[groupId].rateLimitCount = 0;
        }
        this.quotaManager.saveState();
        return true;
    } else {
        const groupId = this.quotaManager.getGroup(model);
        this.quotaManager.initConnectionQuota(connectionId);
        const state = this.quotaManager.quotaState[connectionId][groupId];
        if (state) {
            state.status = 'active';
            state.rateLimitCount = 0;
            this.quotaManager.saveState();
            return true;
        }
    }
    return false;
  }

  // 转发请求到健康的连接
  async forwardRequest(proxyRequest, model = null, excludeIds = []) {
    const connection = this.getHealthyConnection(model, excludeIds);
    if (!connection) {
      // 检查是否是因为所有活跃连接都处于冷却状态
      const activeConnections = Array.from(this.connections.values())
        .filter(conn => conn.status === 'active' && conn.ws && conn.ws.readyState === WebSocket.OPEN && !conn.disabled);
      
      if (activeConnections.length > 0 && model) {
         const unavailableConnections = activeConnections.filter(conn =>
            !this.quotaManager.isAvailable(conn.id, model)
         );
         
         // 如果所有活跃连接都不可用
         if (unavailableConnections.length === activeConnections.length) {
             throw new Error('当前请求模型在现有所有连接中使用额度到上限');
         }
      }

      throw new Error('没有可用的WebSocket连接');
    }
    
    // 记录请求与连接的映射关系
    this.requestConnectionMap.set(proxyRequest.request_id, connection.id);
    this.requestModelMap.set(proxyRequest.request_id, model || 'unknown');
    
    // 记录额度使用 (预扣除/计数)
    if (model) {
        this.quotaManager.recordUsage(connection.id, model);
    }
    
    // 保存请求信息用于可能的重试
    this.pendingRetries.set(proxyRequest.request_id, proxyRequest);
    
    connection.ws.send(JSON.stringify(proxyRequest));
    this.logger.debug(`请求 ${proxyRequest.request_id} 已发送到 ${connection.displayName || connection.id}`);
    
    return connection.id;
  }

  // 生成连接ID
  generateConnectionId() {
    return `conn_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // 关闭连接池
  shutdown() {
    this.isShuttingDown = true;
    const icons = this.logger.icons || {};
    this.logger.info(`${icons.warn || ''} 关闭连接池...`);
    
    for (const [id, connectionInfo] of this.connections.entries()) {
      if (connectionInfo.ws) {
        connectionInfo.ws.close();
      }
    }
    
    this.messageQueues.forEach(queue => queue.close());
    this.messageQueues.clear();
    this.connections.clear();
    this.clientHistory.clear(); // 清除历史记录
    this.connectionOrder = [];
    this.requestConnectionMap.clear();
    this.pendingRetries.clear();
    this.requestModelMap.clear();
  }

  // 获取连接池状态统计
  getPoolStats() {
    const stats = {
      total: this.connections.size,
      active: 0,
      connecting: 0,
      closed: 0,
      error: 0,
      disabled: 0,
      waiting: 0,
      totalRequests: 0
    };

    for (const connectionInfo of this.connections.values()) {
      const status = connectionInfo.status || 'unknown';
      stats[status] = (stats[status] || 0) + 1;
      stats.totalRequests += connectionInfo.requestCount || 0;
    }

    return stats;
  }
}

// 连接注册管理，封装连接池
class ConnectionRegistry extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.pool = new WebSocketPool(logger);
    this.pendingRequests = new Map(); // 存储待重试的请求
  }

  async initialize() {
    await this.pool.initialize();
  }

  addConnection(websocket, clientInfo) {
    this.pool.acceptConnection(websocket, clientInfo);
  }

  hasActiveConnections() {
    return this.pool.hasActiveConnections();
  }

  createMessageQueue(requestId) {
    return this.pool.createMessageQueue(requestId);
  }

  removeMessageQueue(requestId) {
    this.pool.removeMessageQueue(requestId);
    this.pendingRequests.delete(requestId);
  }

  async forwardRequest(proxyRequest, model = null) {
    try {
      const targetModel = model || proxyRequest.model || null;
      this.pendingRequests.set(proxyRequest.request_id, proxyRequest);
      await this.pool.forwardRequest(proxyRequest, targetModel);
    } catch (error) {
      throw error;
    }
  }

  async retryRequest(proxyRequest, connectionId) {
    this.logger.info(`重试请求 ${proxyRequest.request_id}`);
    try {
      const model = proxyRequest.model || null;
      await this.pool.forwardRequest(proxyRequest, model, connectionId ? [connectionId] : []);
    } catch (error) {
      this.logger.error(`重试请求失败: ${error.message}`);
    }
  }

  getPoolStats() {
    return this.pool.getPoolStats();
  }
  
  getConnectionDetails() {
    return this.pool.getConnectionDetails();
  }
  
  toggleConnection(connectionId, enable) {
    return this.pool.toggleConnection(connectionId, enable);
  }

  clearCooldown(connectionId, model) {
    return this.pool.clearCooldown(connectionId, model);
  }

  shutdown() {
    this.pool.shutdown();
  }
}

class RequestHandler {
  constructor(serverSystem, connectionRegistry, logger) {
    this.serverSystem = serverSystem;
    this.connectionRegistry = connectionRegistry;
    this.logger = logger;
  }

  _normalizeFunctionName(name) {
    if (!name) return '_unnamed_function';

    // 0. 中文转拼音
    if (pinyin.isSupported() && /[\u4e00-\u9fa5]/.test(name)) {
        name = pinyin.convertToPinyin(name, '', true); // true 表示移除声调
    }

    // 1. 替换非法字符
    let normalized = name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    // 2. 确保首字符合法 (必须是字母或下划线)
    if (!/^[a-zA-Z_]/.test(normalized)) {
      normalized = '_' + normalized;
    }
    // 3. 截断长度 (Gemini 限制 64 字符)
    if (normalized.length > 64) {
      normalized = normalized.substring(0, 64);
    }
    if (!normalized || normalized === '_') {
      normalized = '_unnamed_function';
    }
    return normalized;
  }

  // --- 新增辅助函数：参数类型反转 ---
  _reverseTransformValue(value) {
    if (typeof value !== 'string') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    
    // 尝试转换为数字 (排除空字符串、前导0但非0的情况以避免误判版本号等)
    if (value.trim() !== '' && !isNaN(Number(value))) {
        // 简单的整数或浮点数检查
        // 注意：'01' 会被 Number 转为 1，但通常我们希望保留 '01' 字符串
        // 这里只转换标准的数字格式
        if (!value.startsWith('0') || value === '0' || value.startsWith('0.')) {
             return Number(value);
        }
    }
    return value;
  }

  _reverseTransformArgs(args) {
    if (typeof args !== 'object' || args === null) return args;
    if (Array.isArray(args)) return args.map(item => this._reverseTransformArgs(item));
    
    const result = {};
    for (const key in args) {
        if (typeof args[key] === 'object') {
            result[key] = this._reverseTransformArgs(args[key]);
        } else {
            result[key] = this._reverseTransformValue(args[key]);
        }
    }
    return result;
  }

  // --- 新增辅助函数：Thought Signature 编解码 ---
  _encodeToolIdWithSignature(originalId, signature) {
      if (!signature) return originalId;
      // 使用自定义分隔符拼接，并对 signature 进行 base64 编码以确保安全
      const encodedSig = Buffer.from(signature).toString('base64');
      return `${originalId}__sig__${encodedSig}`;
  }

  _decodeToolIdAndSignature(encodedId) {
      if (!encodedId || typeof encodedId !== 'string') return { id: encodedId, signature: null };
      const parts = encodedId.split('__sig__');
      if (parts.length === 2) {
          try {
              const signature = Buffer.from(parts[1], 'base64').toString('utf-8');
              return { id: parts[0], signature };
          } catch (e) {
              return { id: encodedId, signature: null };
          }
      }
      return { id: encodedId, signature: null };
  }

  _resolveRef(ref, rootSchema) {
    if (!ref || !ref.startsWith('#/')) return null;
    const path = ref.substring(2).split('/');
    let current = rootSchema;
    for (const segment of path) {
        if (current && typeof current === 'object' && segment in current) {
            current = current[segment];
        } else {
            return null;
        }
    }
    return current;
  }

  _cleanSchemaForGemini(schema, rootSchema = null, visited = new Set()) {
    if (!schema || typeof schema !== 'object') return schema;
    if (!rootSchema) rootSchema = schema;
    if (visited.has(schema)) return schema;
    visited.add(schema);
    
    let result = {};

    // 处理 $ref
    if (schema.$ref) {
        const resolved = this._resolveRef(schema.$ref, rootSchema);
        if (resolved) {
            // 递归清理引用的 schema
            const cleanedResolved = this._cleanSchemaForGemini(resolved, rootSchema, visited);
            // 合并 resolved schema
            result = { ...cleanedResolved };
            // 当前 schema 的其他字段覆盖引用
            for (const key in schema) {
                if (key !== '$ref') {
                    result[key] = schema[key];
                }
            }
            // 更新 schema 引用以便后续处理
            schema = result;
            // 重置 result 以便后续逻辑处理合并后的 schema
            result = {};
        }
    }
    
    if (schema.allOf && Array.isArray(schema.allOf)) {
        for (const item of schema.allOf) {
            const cleanedItem = this._cleanSchemaForGemini(item, rootSchema, visited);
            if (cleanedItem.properties) {
                result.properties = { ...result.properties, ...cleanedItem.properties };
            }
            if (cleanedItem.required) {
                result.required = [...(result.required || []), ...cleanedItem.required];
            }
            for (const key in cleanedItem) {
                if (key !== 'properties' && key !== 'required') {
                    result[key] = cleanedItem[key];
                }
            }
        }
        for (const key in schema) {
            if (key !== 'allOf' && key !== 'properties' && key !== 'required') {
                result[key] = schema[key];
            } else if ((key === 'properties' || key === 'required') && !result[key]) {
                result[key] = schema[key];
            }
        }
    } else {
        // 如果之前处理过 $ref，result 可能已经有内容，需要合并
        result = { ...result, ...schema };
    }
    
    if (result.type) {
        let typeValue = result.type;
        if (Array.isArray(typeValue)) {
            typeValue = typeValue.find(t => t !== 'null') || typeValue[0];
        }
        const typeMap = {
            'string': 'STRING', 'number': 'NUMBER', 'integer': 'INTEGER',
            'boolean': 'BOOLEAN', 'array': 'ARRAY', 'object': 'OBJECT'
        };
        if (typeof typeValue === 'string' && typeMap[typeValue.toLowerCase()]) {
            result.type = typeMap[typeValue.toLowerCase()];
        }
    }
    
    if (result.type === 'ARRAY') {
        if (!result.items) {
            result.items = {};
        } else if (Array.isArray(result.items)) {
            const tupleTypes = result.items.map(i => i.type || 'any').join(', ');
            result.description = (result.description || '') + ` (Tuple: [${tupleTypes}])`;
            result.items = this._cleanSchemaForGemini(result.items[0], rootSchema, visited);
        } else {
            result.items = this._cleanSchemaForGemini(result.items, rootSchema, visited);
        }
    }
    
    if (result.anyOf) {
        const cleanedAnyOf = result.anyOf.map(i => this._cleanSchemaForGemini(i, rootSchema, visited));
        const isEnum = cleanedAnyOf.every(i => i.const !== undefined);
        if (isEnum) {
            result.type = 'STRING';
            result.enum = cleanedAnyOf.map(i => String(i.const));
        } else {
            const firstValid = cleanedAnyOf.find(i => i.type || i.enum);
            if (firstValid) Object.assign(result, firstValid);
        }
        delete result.anyOf;
    }
    
    if (result.default !== undefined) {
        result.description = (result.description || '') + ` (Default: ${JSON.stringify(result.default)})`;
        delete result.default;
    }
    
    const unsupported = [
        'title', '$schema', '$ref', 'strict', 'exclusiveMaximum', 'exclusiveMinimum',
        'additionalProperties', 'oneOf', 'allOf', '$defs', 'definitions', 'example',
        'examples', 'readOnly', 'writeOnly', 'const', 'additionalItems', 'contains',
        'patternProperties', 'dependencies', 'propertyNames', 'if', 'then', 'else',
        'contentEncoding', 'contentMediaType'
    ];
    unsupported.forEach(k => delete result[k]);
    
    if (result.properties) {
        const cleanedProps = {};
        for (const key in result.properties) {
            cleanedProps[key] = this._cleanSchemaForGemini(result.properties[key], rootSchema, visited);
        }
        result.properties = cleanedProps;
    }
    
    if (result.properties && !result.type) {
        result.type = 'OBJECT';
    }
    
    if (result.required && Array.isArray(result.required)) {
        result.required = [...new Set(result.required)];
    }
    
    return result;
  }

  _fixToolCallArgsTypes(args, schema) {
    if (!args || !schema || !schema.properties) return args;
    const fixed = { ...args };
    for (const key in args) {
        if (!schema.properties[key]) continue;
        const paramType = schema.properties[key].type;
        const value = args[key];
        let fixedValue = value;
        let changed = false;

        if (paramType === 'number' || paramType === 'integer') {
            if (typeof value === 'string') {
                const num = Number(value);
                if (!isNaN(num)) {
                    fixedValue = num;
                    changed = true;
                }
            }
        } else if (paramType === 'boolean') {
            if (typeof value === 'string') {
                if (['true', '1', 'yes'].includes(value.toLowerCase())) {
                    fixedValue = true;
                    changed = true;
                }
                if (['false', '0', 'no'].includes(value.toLowerCase())) {
                    fixedValue = false;
                    changed = true;
                }
            }
        } else if (paramType === 'string') {
            if (typeof value !== 'string') {
                fixedValue = String(value);
                changed = true;
            }
        }

        if (changed) {
            fixed[key] = fixedValue;
            this.logger.debug(`[ToolArgs] 修正参数类型: ${key} '${value}' -> ${fixedValue} (${paramType})`);
        }
    }
    return fixed;
  }

  _convertToolChoiceToToolConfig(toolChoice) {
    if (typeof toolChoice === 'string') {
        if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
        if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
        if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
    } else if (typeof toolChoice === 'object') {
        if (toolChoice.type === 'function' && toolChoice.function && toolChoice.function.name) {
            return {
                functionCallingConfig: {
                    mode: 'ANY',
                    allowedFunctionNames: [this._normalizeFunctionName(toolChoice.function.name)]
                }
            };
        }
    }
    return { functionCallingConfig: { mode: 'AUTO' } };
  }

  // 【功能增强】重写此函数以支持多模态内容、工具和高级消息处理
  _transformOpenAIToGemini(req) {
    const openaiBody = req.body;
    if (!openaiBody || !Array.isArray(openaiBody.messages)) {
      throw new Error('Invalid OpenAI request: "messages" must be an array');
    }
    // 从服务器系统配置中获取策略，默认为 'merge-first'
    const systemMessageStrategy = this.serverSystem.config.systemMessageStrategy || 'merge-first';
    const systemMessageLabelPrefix = this.serverSystem.config.systemMessageLabelPrefix === true;
    const systemMessageLabelText = '“system”：';

    const messages = JSON.parse(JSON.stringify(openaiBody.messages));
    const toolCallNameById = new Map();
    let warnedNonBase64Image = false;
    let systemInstruction = null;
    let finalMessages = [];

    const applySystemLabelPrefix = (content) => {
        if (!systemMessageLabelPrefix) return content;
        if (typeof content === 'string') {
            return `${systemMessageLabelText}${content}`;
        }
        if (Array.isArray(content)) {
            return content.map((part) => {
                if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
                    return { ...part, text: `${systemMessageLabelText}${part.text}` };
                }
                return part;
            });
        }
        return content;
    };

    const getSystemText = (content) => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            return content
                .filter(part => part && part.type === 'text' && typeof part.text === 'string')
                .map(part => part.text)
                .filter(Boolean)
                .join('\n');
        }
        return '';
    };

    const normalizeToolArgs = (args) => {
        if (args === undefined || args === null) return {};
        if (typeof args === 'object') return args;
        if (typeof args === 'string') {
            try {
                const parsed = JSON.parse(args);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (_) {
                return { _raw: args };
            }
        }
        return { _raw: String(args) };
    };

    const normalizeToolResponse = (content) => {
        if (content === undefined || content === null) return {};
        if (typeof content === 'string') {
            const trimmed = content.trim();
            if (trimmed) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed && typeof parsed === 'object') return parsed;
                } catch (_) {
                    return { content: content };
                }
            }
            return { content: content };
        }
        if (Array.isArray(content)) {
            const text = content
                .map(part => (part && typeof part === 'object' && typeof part.text === 'string') ? part.text : '')
                .filter(Boolean)
                .join('\n');
            return text ? { content: text } : {};
        }
        if (typeof content === 'object') {
            return content;
        }
        return { content: String(content) };
    };

    const buildContentParts = (content) => {
        if (Array.isArray(content)) {
            const parts = content.map(part => {
                if (part.type === 'text') {
                    return { text: part.text };
                }
                if (part.type === 'image_url') {
                    const url = part.image_url?.url;
                    if (!url) return null;
                    const match = url.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
                    if (match) {
                        return { inlineData: { mimeType: match[1], data: match[2] } };
                    }
                    if (!warnedNonBase64Image) {
                        warnedNonBase64Image = true;
                        this.logger.warn('Unsupported image_url detected (non-base64). Passing URL as text fallback.');
                    }
                    return { text: `[image_url] ${url}` };
                }
                return null;
            }).filter(p => p !== null);
            return parts;
        }
        if (typeof content === 'string') {
            return [{ text: content }];
        }
        return [];
    };

    const convertSystemToUser = (msg) => ({
        ...msg,
        role: 'user',
        content: applySystemLabelPrefix(msg.content)
    });

    const systemMessagesCount = messages.filter(msg => msg.role === 'system').length;
    const normalizedStrategy = ['none', 'merge-first', 'merge-first-parts', 'convert-all-to-user', 'merge-all', 'extract-all']
        .includes(systemMessageStrategy) ? systemMessageStrategy : 'merge-first';
    const isNoProcessing = normalizedStrategy === 'none';
    const isMergeFirstParts = normalizedStrategy === 'merge-first-parts';
    const isMergeFirst = normalizedStrategy === 'merge-first' || isMergeFirstParts;
    const isConvertAll = normalizedStrategy === 'convert-all-to-user';
    const isMergeAll = normalizedStrategy === 'merge-all';
    const isExtractAll = normalizedStrategy === 'extract-all';

    const getSystemTexts = (list) => list
        .filter(msg => msg.role === 'system')
        .map(msg => getSystemText(msg.content))
        .filter(Boolean);

    messages.forEach((msg) => {
        const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
        toolCalls.forEach((call) => {
            if (call && call.id && call.type === 'function' && call.function && call.function.name) {
                // 尝试解码 ID 以获取原始 ID (虽然这里主要用于 Map key，但保持一致性更好)
                const { id: originalId } = this._decodeToolIdAndSignature(call.id);
                toolCallNameById.set(call.id, call.function.name); // 保留原始完整 ID 作为 key
                toolCallNameById.set(originalId, call.function.name); // 也存一份原始 ID
            }
        });
    });

    if (systemMessagesCount === 0) {
        finalMessages = messages;
    } else if (isNoProcessing) {
        const systemTexts = getSystemTexts(messages);
        if (systemTexts.length > 0) {
            systemInstruction = { parts: systemTexts.map(text => ({ text })) };
        }
        finalMessages = messages.filter(msg => msg.role !== 'system');
    } else if (isMergeAll) {
        const systemTexts = getSystemTexts(messages);
        if (systemTexts.length > 0) {
            systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
        }
        finalMessages = messages.filter(msg => msg.role !== 'system');
    } else if (isExtractAll) {
        const systemTexts = getSystemTexts(messages);
        if (systemTexts.length > 0) {
            systemInstruction = { parts: systemTexts.map(text => ({ text })) };
        }
        finalMessages = messages.filter(msg => msg.role !== 'system');
    } else if (systemMessagesCount === 1) {
        const systemMsg = messages.find(msg => msg.role === 'system');
        const systemText = systemMsg ? getSystemText(systemMsg.content) : '';
        if (systemText) {
            systemInstruction = { parts: [{ text: systemText }] };
        }
        finalMessages = messages.filter(msg => msg.role !== 'system');
    } else {
        if (isMergeFirst) {
            const firstSystemBlockContent = [];
            let inFirstBlock = true;
            for (const msg of messages) {
                if (msg.role === 'system' && inFirstBlock) {
                    const text = getSystemText(msg.content);
                    if (text) firstSystemBlockContent.push(text);
                } else {
                    inFirstBlock = false;
                    if (msg.role === 'system') {
                        finalMessages.push(convertSystemToUser(msg));
                    } else {
                        finalMessages.push(msg);
                    }
                }
            }
            if (firstSystemBlockContent.length > 0) {
                if (isMergeFirstParts) {
                    systemInstruction = {
                        parts: firstSystemBlockContent.map(text => ({ text }))
                    };
                } else {
                    systemInstruction = { parts: [{ text: firstSystemBlockContent.join('\n\n') }] };
                }
            }
        } else if (isConvertAll) {
            finalMessages = messages.map(msg => msg.role === 'system' ? convertSystemToUser(msg) : msg);
        } else {
            finalMessages = messages;
        }
    }

    const geminiContents = finalMessages.map(message => {
        let parts = [];

        if (message.role === 'tool' || message.role === 'function') {
            // 解码 tool_call_id 以获取原始 ID 和 signature
            const { id: originalId, signature } = this._decodeToolIdAndSignature(message.tool_call_id);
            
            // 查找函数名：优先使用 message.name，其次通过 ID 查找
            const toolName = message.name || toolCallNameById.get(message.tool_call_id) || toolCallNameById.get(originalId) || originalId || 'tool';
            
            let responseContent = message.content;
            const responseParts = [];

            // Handle array content (text + images) for Computer Use screenshots or multimodal tool outputs
            if (Array.isArray(message.content)) {
                const textParts = [];
                message.content.forEach(part => {
                    if (part?.type === 'text' && typeof part.text === 'string') {
                        textParts.push(part.text);
                    } else if (part?.type === 'image_url' && part.image_url?.url) {
                        const url = part.image_url.url;
                        const match = url.match(/^data:(image\/(?:png|jpeg|webp));base64,(.*)$/);
                        if (match) {
                            responseParts.push({
                                inlineData: { mimeType: match[1], data: match[2] }
                            });
                        }
                    }
                });
                // Join text parts to form the response body (which might be JSON)
                responseContent = textParts.join('\n');
            }

            const functionResponse = {
                id: originalId, // 使用解码后的原始 ID
                name: toolName,
                response: normalizeToolResponse(responseContent)
            };

            // If we have images, add them to the 'parts' field of functionResponse
            // This is required for Gemini Computer Use to receive screenshots
            if (responseParts.length > 0) {
                functionResponse.parts = responseParts;
            }

            parts.push({ functionResponse });
        } else {
            parts = buildContentParts(message.content);
            if (message.role === 'assistant') {
                const toolCalls = Array.isArray(message.tool_calls)
                    ? message.tool_calls
                    : (message.function_call ? [{ type: 'function', function: message.function_call }] : []);
                toolCalls.forEach((call) => {
                    if (!call) return;
                    const fn = call.function || {};
                    if (!fn.name) return;
                    
                    const normalizedName = this._normalizeFunctionName(fn.name);
                    let args = normalizeToolArgs(fn.arguments ?? fn.args);
                    
                    // 尝试修正参数类型 (如果能找到对应的 schema)
                    if (req.toolSchemas && req.toolSchemas[normalizedName]) {
                        args = this._fixToolCallArgsTypes(args, { properties: req.toolSchemas[normalizedName].properties });
                    }
                    
                    parts.push({
                        functionCall: {
                            name: normalizedName,
                            args: args
                        }
                    });
                });
            }
        }

        if (!parts.length) {
            parts = [{ text: '' }];
        }

        return {
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: parts,
        };
    });

    const geminiTools = [];
    const functionDeclarations = [];
    let hasGoogleSearch = false;
    let computerUseConfig = null;

    // 保存工具 Schema 供后续参数修正使用
    req.toolSchemas = {};

    if (Array.isArray(openaiBody.tools)) {
        openaiBody.tools.forEach(tool => {
            // 1. Google Search
            if (tool?.type === 'function' && tool.function?.name === 'googleSearch') {
                hasGoogleSearch = true;
                return;
            }

            // 2. Computer Use Support
            if (tool?.computer_use) {
                computerUseConfig = tool.computer_use;
                return;
            }
            if (tool?.type === 'computer_use') {
                 computerUseConfig = tool.computer_use || { environment: 'ENVIRONMENT_BROWSER' };
                 return;
            }
            if (tool?.type === 'function' && (tool.function?.name === 'computerUse' || tool.function?.name === 'computer_use')) {
                 computerUseConfig = { environment: 'ENVIRONMENT_BROWSER' };
                 return;
            }

            // 3. Standard Functions
            if (tool?.type === 'function' && tool.function?.name) {
                const originalName = tool.function.name;
                const normalizedName = this._normalizeFunctionName(originalName);
                
                const declaration = {
                    name: normalizedName,
                    description: tool.function.description
                };
                
                if (tool.function.parameters) {
                    declaration.parameters = this._cleanSchemaForGemini(tool.function.parameters);
                    // 保存原始 Schema 用于参数修正
                    req.toolSchemas[normalizedName] = tool.function.parameters;
                }
                
                functionDeclarations.push(declaration);
            }
        });
    }

    if (functionDeclarations.length > 0) {
        geminiTools.push({ functionDeclarations });
    }
    if (hasGoogleSearch) {
        geminiTools.push({ googleSearch: {} });
    }
    if (computerUseConfig) {
        geminiTools.push({ computer_use: computerUseConfig });
    }

    const requestedCandidates = Number(openaiBody.n);
    let candidateCount;
    if (Number.isFinite(requestedCandidates) && requestedCandidates > 0) {
        candidateCount = Math.max(1, Math.floor(requestedCandidates));
        if (candidateCount > 1) {
            this.logger.warn(`OpenAI n=${candidateCount} not supported yet; using 1.`);
            candidateCount = 1;
        }
    }

    const generationConfig = {
        temperature: openaiBody.temperature,
        topP: openaiBody.top_p,
        topK: openaiBody.top_k,
        maxOutputTokens: openaiBody.max_completion_tokens || openaiBody.max_tokens,
        candidateCount: candidateCount,
        stopSequences: (openaiBody.stop && typeof openaiBody.stop === 'string') ? [openaiBody.stop] : openaiBody.stop,
        frequencyPenalty: openaiBody.frequency_penalty,
        presencePenalty: openaiBody.presence_penalty,
        seed: openaiBody.seed,
        ...(openaiBody.extra_body?.google || {}),
    };
    
    // 处理 response_format
    if (openaiBody.response_format) {
        if (openaiBody.response_format.type === 'json_object') {
            generationConfig.responseMimeType = 'application/json';
        } else if (openaiBody.response_format.type === 'json_schema' && openaiBody.response_format.json_schema?.schema) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema = this._cleanSchemaForGemini(openaiBody.response_format.json_schema.schema);
        } else if (openaiBody.response_format.type === 'text') {
            generationConfig.responseMimeType = 'text/plain';
        }
    }

    Object.keys(generationConfig).forEach(key => generationConfig[key] === undefined && delete generationConfig[key]);

    // 如果 contents 为空（例如仅有 system 消息且被提取），添加默认用户消息以避免 API 报错
    if (geminiContents.length === 0) {
        geminiContents.push({ role: 'user', parts: [{ text: ' ' }] });
    }

    const geminiBody = {
        contents: geminiContents,
        generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    };

    if (geminiTools.length > 0) {
        geminiBody.tools = geminiTools;
    }
    
    if (openaiBody.tool_choice) {
        geminiBody.toolConfig = this._convertToolChoiceToToolConfig(openaiBody.tool_choice);
    }
    if (systemInstruction) {
        geminiBody.system_instruction = systemInstruction;
    }

    const streaming = openaiBody.stream === true;
    req.isStreaming = streaming;

    // 伪流式传输逻辑：如果开启且请求流式，强制转为非流式请求，但保持 isStreaming=true 以便后续模拟
    // 修改：仅允许通过后缀触发，忽略全局配置的 enabled 状态
    const isFakeStreamingEnabled = req.forceFakeStreaming;
    if (streaming && isFakeStreamingEnabled) {
        req.isFakeStreaming = true;
        // 注意：这里不修改 req.isStreaming，因为我们需要它为 true 来触发 _handleResponse 中的流式处理分支
        // 但我们会修改 geminiPath 使用非流式接口
    }

    const rawModel = openaiBody.model || 'gemini-pro';
    // 再次确保去除后缀（虽然 processRequest 已经处理过，但为了安全起见）
    let normalizedModel = String(rawModel).replace(/^models\//, '').split(':')[0] || 'gemini-pro';
    const isBlacklisted = (name) => /computer-use|tts|audio|imagen|embedding/i.test(name);
    if (normalizedModel.endsWith('-伪流') && (normalizedModel.startsWith('gemini') || normalizedModel.startsWith('models/gemini')) && !isBlacklisted(normalizedModel)) {
        normalizedModel = normalizedModel.replace(/-伪流$/, '');
    }
    req.requestedModel = normalizedModel;
    
    // 如果是伪流式，强制使用 generateContent (非流式接口)
    const useStreamApi = streaming && !req.isFakeStreaming;
    const geminiPath = `/v1beta/models/${normalizedModel}:${useStreamApi ? 'streamGenerateContent' : 'generateContent'}`;

    return { geminiBody, geminiPath, streaming };
  }

  _applySystemMessageStrategyToGeminiBody(originalBody) {
    const systemMessageStrategy = this.serverSystem.config.systemMessageStrategy || 'merge-first';
    const systemMessageLabelPrefix = this.serverSystem.config.systemMessageLabelPrefix === true;
    const systemMessageLabelText = '“system”：';
    const normalizedStrategy = ['none', 'merge-first', 'merge-first-parts', 'convert-all-to-user', 'merge-all', 'extract-all']
      .includes(systemMessageStrategy) ? systemMessageStrategy : 'merge-first';
    const isNoProcessing = normalizedStrategy === 'none';
    const isMergeFirstParts = normalizedStrategy === 'merge-first-parts';
    const isMergeFirst = normalizedStrategy === 'merge-first' || isMergeFirstParts;
    const isConvertAll = normalizedStrategy === 'convert-all-to-user';
    const isMergeAll = normalizedStrategy === 'merge-all';
    const isExtractAll = normalizedStrategy === 'extract-all';

    if (!originalBody || typeof originalBody !== 'object') return originalBody;
    const body = JSON.parse(JSON.stringify(originalBody));
    if (!Array.isArray(body.contents)) return body;

    const contents = body.contents;
    const systemMessagesCount = contents.filter(msg => msg.role === 'system').length;
    if (systemMessagesCount === 0) return body;

    const getPartsText = (parts) => {
      if (!Array.isArray(parts)) return '';
      return parts
        .map(part => (part && typeof part.text === 'string') ? part.text : '')
        .filter(Boolean)
        .join('\n');
    };

    const applyPrefixToParts = (parts) => {
      if (!systemMessageLabelPrefix || !Array.isArray(parts)) return parts;
      return parts.map((part) => {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          return { ...part, text: `${systemMessageLabelText}${part.text}` };
        }
        return part;
      });
    };

    const convertSystemToUser = (msg) => ({
      ...msg,
      role: 'user',
      parts: applyPrefixToParts(msg.parts)
    });

    let finalContents = [];
    let systemTexts = [];

    if (isNoProcessing || isMergeAll || isExtractAll) {
      systemTexts = contents
        .filter(msg => msg.role === 'system')
        .map(msg => getPartsText(msg.parts))
        .filter(Boolean);
      finalContents = contents.filter(msg => msg.role !== 'system');
    } else if (systemMessagesCount === 1) {
      const systemMsg = contents.find(msg => msg.role === 'system');
      const text = systemMsg ? getPartsText(systemMsg.parts) : '';
      if (text) systemTexts = [text];
      finalContents = contents.filter(msg => msg.role !== 'system');
    } else {
      if (isMergeFirst) {
        const firstSystemBlockContent = [];
        let inFirstBlock = true;
        for (const msg of contents) {
          if (msg.role === 'system' && inFirstBlock) {
            const text = getPartsText(msg.parts);
            if (text) firstSystemBlockContent.push(text);
          } else {
            inFirstBlock = false;
            if (msg.role === 'system') {
              finalContents.push(convertSystemToUser(msg));
            } else {
              finalContents.push(msg);
            }
          }
        }
        systemTexts = firstSystemBlockContent;
      } else if (isConvertAll) {
        finalContents = contents.map(msg => msg.role === 'system' ? convertSystemToUser(msg) : msg);
      } else {
        finalContents = contents;
      }
    }

    body.contents = finalContents;

    if (systemTexts.length > 0) {
      const resolveExistingInstruction = () => {
        let instructionKey = 'system_instruction';
        let instruction = null;
        if (body.system_instruction !== undefined) {
          instructionKey = 'system_instruction';
          instruction = body.system_instruction;
        } else if (body.systemInstruction !== undefined) {
          instructionKey = 'systemInstruction';
          instruction = body.systemInstruction;
        }

        const existingTexts = [];
        if (typeof instruction === 'string') {
          existingTexts.push(instruction);
        } else if (instruction && Array.isArray(instruction.parts)) {
          instruction.parts.forEach((part) => {
            if (part && typeof part.text === 'string') existingTexts.push(part.text);
          });
        }

        return { instructionKey, existingTexts };
      };

      const { instructionKey, existingTexts } = resolveExistingInstruction();
      const combinedTexts = [...existingTexts, ...systemTexts].filter(Boolean);
      if (combinedTexts.length > 0) {
        const instruction = (isMergeFirstParts || isExtractAll)
          ? { parts: combinedTexts.map(text => ({ text })) }
          : { parts: [{ text: combinedTexts.join('\n\n') }] };
        body[instructionKey] = instruction;
        if (instructionKey === 'system_instruction' && body.systemInstruction !== undefined) {
          delete body.systemInstruction;
        } else if (instructionKey === 'systemInstruction' && body.system_instruction !== undefined) {
          delete body.system_instruction;
        }
      }
    }

    return body;
  }

  _transformGeminiModelsToOpenAI(geminiJSON) {
    this.logger.info(`[DEBUG] 开始转换模型列表。收到的原始JSON: ${geminiJSON}`); // 增加原始数据日志
    try {
      const geminiBody = JSON.parse(geminiJSON);
      if (!geminiBody.models) {
        this.logger.warn(`[DEBUG] 转换失败：JSON中没有找到 'models' 字段。`);
        return { object: "list", data: [] };
      }

      const openAIModels = [];
      geminiBody.models.forEach(model => {
          const baseId = model.name.replace('models/', '');
          const created = new Date(model.createTime || Date.now()).getTime() / 1000;
          
          // 原始模型
          openAIModels.push({
              id: baseId,
              object: "model",
              created: created,
              owned_by: "google"
          });

          // 伪流式模型副本
          const isBlacklisted = (name) => /computer-use|tts|audio|imagen|embedding/i.test(name);
          // 检查开关是否开启
          if (this.serverSystem.config.enablePseudoStreamModels && baseId.startsWith('gemini') && !isBlacklisted(baseId)) {
              openAIModels.push({
                  id: `${baseId}-伪流`,
                  object: "model",
                  created: created,
                  owned_by: "google"
              });
          }
      });

      this.logger.info(`[DEBUG] 成功转换了 ${openAIModels.length} 个模型 (含伪流副本)。`);
      return { object: "list", data: openAIModels };

    } catch (e) {
      // 【关键】捕获并打印JSON解析或处理过程中的任何错误
      this.logger.error(`[严重错误] 转换Gemini模型列表时发生错误: ${e.message}`);
      this.logger.error(`[严重错误] 导致错误的原始JSON内容: ${geminiJSON}`);
      return { object: "list", data: [] };
      }
    }

  _safeToNumber(value) {
      if (value === undefined || value === null) return null;
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
  }

  _mapUsageMetadataToOpenAI(usageMetadata) {
      if (!usageMetadata) return null;

      const promptTokens = this._safeToNumber(
          usageMetadata.prompt_tokens ??
          usageMetadata.promptTokenCount ??
          usageMetadata.inputTokenCount ??
          usageMetadata.inputTokens
      );
      const completionTokens = this._safeToNumber(
          usageMetadata.completion_tokens ??
          usageMetadata.candidatesTokenCount ??
          usageMetadata.outputTokenCount ??
          usageMetadata.outputTokens
      );
      let totalTokens = this._safeToNumber(
          usageMetadata.total_tokens ??
          usageMetadata.totalTokenCount
      );

      if (totalTokens === null && promptTokens !== null && completionTokens !== null) {
          totalTokens = promptTokens + completionTokens;
      }

      if (promptTokens === null && completionTokens === null && totalTokens === null) {
          return null;
      }

      const usage = {
          prompt_tokens: promptTokens ?? 0,
          completion_tokens: completionTokens ?? 0,
          total_tokens: totalTokens ?? ((promptTokens ?? 0) + (completionTokens ?? 0))
      };

      if (usageMetadata.promptTokensDetails) {
          usage.prompt_tokens_details = usageMetadata.promptTokensDetails;
      }
      if (usageMetadata.completionTokensDetails) {
          usage.completion_tokens_details = usageMetadata.completionTokensDetails;
      }

      return usage;
  }

  _sanitizeOpenAIUsageForClient(usage) {
      if (!usage || typeof usage !== 'object') {
          return usage;
      }
      // OpenAI 强类型校验要求 prompt_tokens_details 是对象，这里在返回给客户端前移除
      const sanitizedUsage = { ...usage };
      if ('prompt_tokens_details' in sanitizedUsage) {
          delete sanitizedUsage.prompt_tokens_details;
      }
      return sanitizedUsage;
  }

  _sanitizeOpenAIChunkForClient(chunk) {
      if (!chunk || typeof chunk !== 'object') {
          return chunk;
      }
      const sanitizedChunk = JSON.parse(JSON.stringify(chunk));
      if (sanitizedChunk.usage) {
          sanitizedChunk.usage = this._sanitizeOpenAIUsageForClient(sanitizedChunk.usage);
      }
      return sanitizedChunk;
  }

  // 【功能增强】重写此函数以支持工具调用响应和图片
  _transformGeminiChunkToOpenAIChunk(geminiChunk, reqId, created, model) {
      const candidate = geminiChunk.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const finishMap = {
          STOP: 'stop',
          MAX_TOKENS: 'length',
          SAFETY: 'content_filter',
          RECITATION: 'content_filter'
      };
      let choicesFinishReason = finishMap[candidate?.finishReason] || null;

      const contentParts = [];
      const reasoningParts = [];
      const toolCalls = [];

      parts.forEach((part, index) => {
          const toolCall = part?.toolCall || part?.functionCall;
          if (toolCall && toolCall.name) {
              // 1. 参数类型反转 (Reverse Transform)
              let rawArgs = toolCall.args ?? toolCall.arguments;
              // 如果是对象，尝试反转类型
              if (typeof rawArgs === 'object' && rawArgs !== null) {
                  rawArgs = this._reverseTransformArgs(rawArgs);
              }
              const argsString = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
              
              // 2. Thought Signature 编码
              const originalId = toolCall.id || `call_${reqId}_${index}`;
              const signature = part.thoughtSignature; // 提取 signature
              const encodedId = this._encodeToolIdWithSignature(originalId, signature);

              toolCalls.push({
                  index,
                  id: encodedId,
                  type: 'function',
                  function: {
                      name: toolCall.name,
                      arguments: argsString
                  }
              });
          } else if (part?.text) {
              if (part.thought === true) {
                  reasoningParts.push(part.text);
              } else {
                  contentParts.push(part.text);
              }
          } else if (part?.executableCode) {
              const lang = part.executableCode.language || 'python';
              const code = part.executableCode.code || '';
              contentParts.push(`\n\`\`\`${lang}\n${code}\n\`\`\`\n`);
          } else if (part?.codeExecutionResult) {
              const outcome = part.codeExecutionResult.outcome;
              const output = part.codeExecutionResult.output || '';
              const label = outcome === 'OUTCOME_OK' ? 'output' : 'error';
              contentParts.push(`\n\`\`\`${label}\n${output}\n\`\`\`\n`);
          } else if (part?.inlineData) {
              // 处理图片数据 - 将base64图片转换为markdown格式
              const mimeType = part.inlineData.mimeType || 'image/png';
              const base64Data = part.inlineData.data;
              contentParts.push(`![image](data:${mimeType};base64,${base64Data})`);
          }
      });

      const delta = {};
      if (contentParts.length) {
          delta.content = contentParts.join('');
      }
      if (reasoningParts.length) {
          delta.reasoning = reasoningParts.join('');
      }
      if (toolCalls.length) {
          delta.tool_calls = toolCalls;
      }

      // 3. Finish Reason 修正
      // 如果存在工具调用且原始结束原因为 STOP，强制设为 tool_calls
      if (toolCalls.length > 0 && candidate?.finishReason === 'STOP') {
          choicesFinishReason = 'tool_calls';
      }

      if (!Object.keys(delta).length && !choicesFinishReason) {
          return null;
      }

      const chunk = {
          id: reqId,
          object: "chat.completion.chunk",
          created: created,
          model: model,
          choices: [{
              index: 0,
              delta: delta,
              finish_reason: choicesFinishReason
          }]
      };

      const usage = this._mapUsageMetadataToOpenAI(geminiChunk.usageMetadata || geminiChunk.usage);
      if (usage) {
          chunk.usage = usage;
      }

      return chunk;
  }

  _transformGeminiCompletionToOpenAI(finalContent, reasoningContent, reqId, created, model, imageContent = null, finishReason = null, toolCalls = null) {
      const finishMap = {
          STOP: 'stop',
          MAX_TOKENS: 'length',
          SAFETY: 'content_filter',
          RECITATION: 'content_filter'
      };
      let mappedFinish = finishMap[finishReason] || 'stop';
      
      // Finish Reason 修正
      if (toolCalls && toolCalls.length > 0 && finishReason === 'STOP') {
          mappedFinish = 'tool_calls';
      }

      const message = {
          role: "assistant",
          content: finalContent
      };

      // 如果有图片内容，将其添加到消息中
      if (imageContent) {
          message.content = (message.content || '') + '\n' + imageContent;
      }

      if (reasoningContent) {
          message.reasoning_content = reasoningContent;
      }

      if (toolCalls && toolCalls.length) {
          message.tool_calls = toolCalls;
      }

      return {
          id: reqId,
          object: "chat.completion",
          created: created,
          model: model,
          choices: [{
              index: 0,
              message: message,
              finish_reason: mappedFinish
          }]
      };
  }

  _getOpenAIEndpoint(pathValue) {
    const normalized = (pathValue || '').replace(/\/+$/, '');
    if (normalized === '/v1/models') return 'models';
    if (normalized === '/v1/chat/completions') return 'chat';
    return null;
  }

  async processRequest(req, res) {
    // 过滤掉favicon等无关请求
    if (req.path === '/favicon.ico') {
      return res.status(404).send('Not Found');
    }
    
    const c = this.logger.colors;
    const icons = this.logger.icons || {};
    this.logger.info(`${icons.network || ''} ${c.bright}${req.method}${c.reset} ${c.fg.cyan}${req.path}${c.reset}`);
    
    // 显示连接池状态
    const poolStats = this.connectionRegistry.getPoolStats();
    // this.logger.info(`连接池状态 - 活跃: ${poolStats.active}/${poolStats.total}, 请求总数: ${poolStats.totalRequests}`);

    if (!this.connectionRegistry.hasActiveConnections()) {
      return this._sendErrorResponse(res, 503, '没有可用的浏览器连接');
    }

    const requestId = `chatcmpl-${this._generateRequestId()}`;
    let proxyRequest;
    let model = 'unknown';
    let requestBody = null;
    const startTime = Date.now();

    req.customRequestId = requestId;
    req.requestTimestamp = Math.floor(Date.now() / 1000);

    const openAiEndpoint = this._getOpenAIEndpoint(req.path);
    req.isOpenAICompatible = Boolean(openAiEndpoint);

    if (openAiEndpoint === 'models') {
        this.logger.info(`${icons.search || '🔍'} 检测到 ${c.fg.magenta}OpenAI模型列表${c.reset} 请求。正在转发到Gemini后端...`);
        model = 'models-list';
        proxyRequest = this._buildProxyRequest(req, requestId, '/v1beta/models');
    } else if (openAiEndpoint === 'chat') {
        // 处理模型名称后缀
        let rawModel = req.body.model || 'gemini-pro';
        const isBlacklisted = (name) => /computer-use|tts|audio|imagen|embedding/i.test(name);
        if (rawModel.endsWith('-伪流') && (rawModel.startsWith('gemini') || rawModel.startsWith('models/gemini')) && !isBlacklisted(rawModel)) {
            rawModel = rawModel.replace(/-伪流$/, '');
            req.forceFakeStreaming = true;
            req.body.model = rawModel; // 更新 body 中的模型名以便后续处理
        }
        req.requestedModel = rawModel;
        model = req.requestedModel;
        requestBody = req.body;
        
        this.logger.info(`${icons.robot || '🤖'} 检测到 ${c.fg.magenta}OpenAI聊天${c.reset} 请求。正在转换为Gemini格式...`);
        try {
            const { geminiBody, geminiPath, streaming } = this._transformOpenAIToGemini(req);
            model = req.requestedModel || model;
            const streamingModeForProxy = streaming ? 'real' : 'fake';
            this.logger.info(`${icons.zap || '⚡'} 为请求 ${c.fg.cyan}${requestId}${c.reset} 设置模式: ${c.fg.yellow}${streamingModeForProxy}${c.reset}`);
            proxyRequest = this._buildProxyRequest(req, requestId, geminiPath, geminiBody, streamingModeForProxy);
        } catch (error) {
            this._sendErrorResponse(res, 400, error.message);
            return;
        }
    } else {
        this.logger.info(`${icons.star || '⭐'} 检测到 ${c.fg.blue}原生Gemini${c.reset} 请求。正在直接转发...`);
        // 尝试从路径提取模型名称
        const pathMatch = req.path.match(/\/models\/(.*?):/);
        if (pathMatch) {
            model = pathMatch[1];
            // 处理原生请求中的后缀 (虽然原生请求通常直接指定路径，但为了兼容性也检查一下)
            const isBlacklisted = (name) => /computer-use|tts|audio|imagen|embedding/i.test(name);
            if (model.endsWith('-伪流') && (model.startsWith('gemini') || model.startsWith('models/gemini')) && !isBlacklisted(model)) {
                model = model.replace(/-伪流$/, '');
                req.forceFakeStreaming = true;
                // 修正路径中的模型名
                req.path = req.path.replace(pathMatch[1], model);
            }
        }
        requestBody = req.body;
        req.isStreaming = req.path.includes('streamGenerateContent');
        
        // 伪流式传输逻辑 (原生请求)
        // 修改：仅允许通过后缀触发，忽略全局配置的 enabled 状态
        const isFakeStreamingEnabled = req.forceFakeStreaming;
        if (req.isStreaming && isFakeStreamingEnabled) {
            req.isFakeStreaming = true;
            // 替换路径为非流式
            proxyRequest = this._buildProxyRequest(req, requestId, req.path.replace('streamGenerateContent', 'generateContent'), req.body, 'fake');
        } else {
            let geminiBody = req.body;
            // 始终应用系统消息策略
            geminiBody = this._applySystemMessageStrategyToGeminiBody(req.body);
            const streamingModeForProxy = req.isStreaming ? 'real' : 'fake';
            proxyRequest = this._buildProxyRequest(req, requestId, null, geminiBody, streamingModeForProxy);
        }
    }

    proxyRequest.model = model;
    const messageQueue = this.connectionRegistry.createMessageQueue(requestId);
    const shouldLog = !req.path.startsWith('/pool-stats') && !req.path.startsWith('/request-') &&
        !req.path.startsWith('/clear-') && !req.path.startsWith('/connection-') &&
        !req.path.startsWith('/toggle-');

    if (shouldLog) {
      await this.serverSystem.requestMonitor.logRequestStart(
        requestId,
        model,
        null,
        req.path,
        req.method,
        requestBody
      );
    }

    // 将请求转发到连接池并记录 requestId 对应的 connectionId
    try {
      await this.connectionRegistry.forwardRequest(proxyRequest, model);
      
      if (shouldLog) {
        const connectionId = this.connectionRegistry.pool.requestConnectionMap.get(requestId);
        await this.serverSystem.requestMonitor.updateRequestConnection(requestId, connectionId);
      }
      const responseData = await this._handleResponse(messageQueue, req, res);
      
      // 记录请求结束（根据状态码判断是成功还是429）
      const responseTime = Date.now() - startTime;
      const statusCode = res?.statusCode ?? 200;
      let logStatus = 'success';
      
      let statusColor = c.fg.green;
      if (statusCode === 429) {
        logStatus = 'rate-limited';
        statusColor = c.fg.yellow;
      } else if (statusCode >= 400) {
        logStatus = 'error';
        statusColor = c.fg.red;
      }

      const timeColor = responseTime > 1000 ? c.fg.yellow : c.fg.gray;
      const icons = this.logger.icons || {};
      const statusIcon = statusCode === 200 ? (icons.success || '✅') : (statusCode === 429 ? (icons.warn || '⚠️') : (icons.error || '❌'));
      this.logger.info(`${statusIcon} 请求完成: ${statusColor}${statusCode}${c.reset} ${icons.time || ''}${timeColor}${responseTime}ms${c.reset} ${icons.brain || ''}${c.fg.magenta}${model}${c.reset}`);

      if (shouldLog) {
        const latestConnectionId = this.connectionRegistry.pool.requestConnectionMap.get(requestId);
        await this.serverSystem.requestMonitor.updateRequestConnection(requestId, latestConnectionId);
      }
      await this.serverSystem.requestMonitor.logRequestEnd(requestId, logStatus, responseTime, responseData, responseData?.usage, statusCode);
      
      // 更新连接计数
      const connectionId = this.connectionRegistry.pool.requestConnectionMap.get(requestId);
      const connectionInfo = this.connectionRegistry.pool.connections.get(connectionId);
      if (connectionInfo) {
        if (statusCode === 429) {
          // 如果响应是 429，计入 rateLimitCount
          // 注意：如果之前 handleRateLimitError 已经处理过并重试失败，这里可能会重复计数
          // 但如果是透传的 429（未被拦截），这里是唯一的计数机会
          // 鉴于我们增强了拦截逻辑，这里主要作为兜底
          connectionInfo.rateLimitCount++;
        } else if (statusCode >= 500) {
           // 5xx 计入错误
           connectionInfo.errorCount++;
        } else {
           // 2xx, 3xx, 4xx(非429) 计入成功 (4xx通常是客户端错误，不怪连接)
           connectionInfo.successCount++;
        }
      }
    } catch (error) {
      this._handleRequestError(error, req, res);
      
      // 记录请求失败
      const responseTime = Date.now() - startTime;
      const status = error.message.includes('429') ? 'rate-limited' : 'error';
      if (shouldLog) {
        const latestConnectionId = this.connectionRegistry.pool.requestConnectionMap.get(requestId);
        await this.serverSystem.requestMonitor.updateRequestConnection(requestId, latestConnectionId);
      }
      await this.serverSystem.requestMonitor.logRequestEnd(requestId, status, responseTime, { error: error.message }, null, res?.statusCode ?? null);
      
      // 更新连接错误计数
      const connectionId = this.connectionRegistry.pool.requestConnectionMap.get(requestId);
      const connectionInfo = this.connectionRegistry.pool.connections.get(connectionId);
      if (connectionInfo) {
        if (status === 'rate-limited') {
          // 只有当错误信息不是由 handleRateLimitError 生成的特定信息时，才在这里计数
          // 避免 handleRateLimitError 已经加过一次后，这里又加一次
          if (!error.message.includes('Rate limited and no alternative connection available')) {
             connectionInfo.rateLimitCount++;
          }
        } else {
          connectionInfo.errorCount++;
        }
      }
    } finally {
      this.connectionRegistry.removeMessageQueue(requestId);
    }
  }

  _generateRequestId() {
    return Math.random().toString(36).substring(2, 26);
  }

  _buildProxyRequest(req, requestId, overridePath, overrideBody, streamingMode = 'fake') {
    const bodyString = overrideBody ? JSON.stringify(overrideBody) : JSON.stringify(req.body || {});
    const cleanHeaders = { ...(req.headers || {}) };
    delete cleanHeaders['content-length'];
    delete cleanHeaders['transfer-encoding'];
    delete cleanHeaders['host'];

    return {
      path: overridePath || req.path,
      method: req.method,
      headers: cleanHeaders,
      query_params: req.query,
      body: bodyString,
      request_id: requestId,
      streaming_mode: streamingMode
    };
  }

  async _handleResponse(messageQueue, req, res) {
    const firstMessage = await messageQueue.dequeue();
    if (!firstMessage) {
       throw new Error('后端未返回响应头信息');
    }
    if (firstMessage.event_type === 'error') {
       const status = firstMessage.status || 500;
       const errorMessage = `代理系统错误: HTTP ${status}: ${firstMessage.error_type || 'Unknown Error'}. 内容: ${firstMessage.message || 'No details provided'}`;
       this.logger.error(errorMessage);
       
       if (req.isOpenAICompatible) {
           const errorPayload = {
               error: {
                   message: firstMessage.message || errorMessage,
                   type: firstMessage.error_type || 'upstream_error',
                   code: status
               }
           };
           res.status(status).json(errorPayload);
           return errorPayload; // Return the error payload instead of throwing
       } else {
           this._sendErrorResponse(res, status, errorMessage);
           throw new Error(errorMessage);
       }
    }

    const initialMessages = [];
    if (firstMessage.event_type === 'response_headers') {
        // 如果响应状态码指示错误（如429），强制关闭流式模式，以便返回JSON格式的错误信息
        if (firstMessage.status >= 400) {
            req.isStreaming = false;
        }
        this._setResponseHeaders(res, req, firstMessage);
    } else {
        let status = 200;
        // 检查首个数据块是否包含错误信息，如果是，则设置正确的状态码并关闭流式模式
        if (firstMessage.event_type === 'chunk' && firstMessage.data) {
            try {
                const trimmed = firstMessage.data.trim();
                if (trimmed.startsWith('{') && trimmed.includes('"error"')) {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.error) {
                        status = parsed.error.code || 429;
                        req.isStreaming = false;
                    }
                }
            } catch (_) {}
        }

        this._setResponseHeaders(res, req, { status: status });
        initialMessages.push(firstMessage);
    }

    if (req.isFakeStreaming) {
      return await this._handleFakeStreamResponse(messageQueue, req, res, initialMessages);
    } else if (req.isStreaming) {
      return await this._handleStreamResponse(messageQueue, req, res, initialMessages);
    } else {
      return await this._handleFullResponse(messageQueue, req, res, initialMessages);
    }
  }

  async _handleFakeStreamResponse(messageQueue, req, res, initialMessages = []) {
    // 1. 获取完整响应
    let fullResponseJsonString = '';
    const pendingMessages = Array.isArray(initialMessages) ? initialMessages.slice() : [];
    
    try {
        while (true) {
            const dataMessage = pendingMessages.length > 0 
                ? pendingMessages.shift() 
                : await messageQueue.dequeue(600000);
            
            if (!dataMessage) break;
            if (dataMessage.type === 'STREAM_END' || dataMessage.event_type === 'stream_close') break;
            if (dataMessage.event_type === 'response_headers') continue;
            
            if (dataMessage.event_type === 'error') {
                throw new Error(dataMessage.message || 'Upstream error');
            }
            
            if (dataMessage.data) {
                fullResponseJsonString += dataMessage.data;
            }
        }
    } catch (e) {
        this.logger.error(`Error fetching full response for fake streaming: ${e.message}`);
        if (!res.headersSent) this._sendErrorResponse(res, 502, e.message);
        throw e;
    }

    // 2. 准备流式响应头
    if (!res.headersSent) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
    }

    // 3. 解析完整响应并转换为流式块
    const config = this.serverSystem.config.fakeStreaming || { chunkSize: 25, delay: 2 };
    const chunkSize = config.chunkSize || 25;
    const delay = config.delay || 2;

    let finalContent = '';
    let reasoningContent = null;
    let usage = null;
    let finishReason = 'stop';
    let toolCalls = [];
    
    // 解析 Gemini 响应
    try {
        const geminiResponse = JSON.parse(fullResponseJsonString);
        usage = this._mapUsageMetadataToOpenAI(geminiResponse.usageMetadata);
        finishReason = geminiResponse.candidates?.[0]?.finishReason || 'STOP';
        
        const parts = geminiResponse.candidates?.[0]?.content?.parts || [];
        parts.forEach(part => {
            if (part.text) {
                if (part.thought) {
                    reasoningContent = (reasoningContent || '') + part.text;
                } else {
                    finalContent += part.text;
                }
            } else if (part.executableCode) {
                const lang = part.executableCode.language || 'python';
                const code = part.executableCode.code || '';
                finalContent += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
            } else if (part.codeExecutionResult) {
                const outcome = part.codeExecutionResult.outcome;
                const output = part.codeExecutionResult.output || '';
                const label = outcome === 'OUTCOME_OK' ? 'output' : 'error';
                finalContent += `\n\`\`\`${label}\n${output}\n\`\`\`\n`;
            } else if (part.inlineData) {
                // 图片转为 Markdown
                const mime = part.inlineData.mimeType;
                const data = part.inlineData.data;
                finalContent += `\n![image](data:${mime};base64,${data})`;
            } else if (part.functionCall) {
                toolCalls.push({
                    function: part.functionCall
                });
            }
        });
    } catch (e) {
        // 如果解析失败，直接作为文本发送
        finalContent = fullResponseJsonString;
    }

    // 4. 模拟流式发送
    const sendChunk = (content, isReasoning = false) => {
        const chunk = {
            id: req.customRequestId,
            object: 'chat.completion.chunk',
            created: req.requestTimestamp,
            model: req.requestedModel,
            choices: [{
                index: 0,
                delta: isReasoning ? { reasoning_content: content } : { content: content },
                finish_reason: null
            }]
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    };

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 发送思考过程 (如果有)
    if (reasoningContent) {
        for (let i = 0; i < reasoningContent.length; i += chunkSize) {
            sendChunk(reasoningContent.slice(i, i + chunkSize), true);
            if (delay > 0) await sleep(delay);
        }
    }

    // 发送主要内容
    if (finalContent) {
        for (let i = 0; i < finalContent.length; i += chunkSize) {
            sendChunk(finalContent.slice(i, i + chunkSize), false);
            if (delay > 0) await sleep(delay);
        }
    }

    // 发送结束块
    const endChunk = {
        id: req.customRequestId,
        object: 'chat.completion.chunk',
        created: req.requestTimestamp,
        model: req.requestedModel,
        choices: [{
            index: 0,
            delta: {},
            finish_reason: finishReason === 'STOP' ? 'stop' : finishReason.toLowerCase()
        }]
    };
    
    if (usage) {
        endChunk.usage = this._sanitizeOpenAIUsageForClient(usage);
    }
    
    res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    // 5. 返回完整数据用于日志记录 (按非流式格式)
    // 构造一个符合 _handleFullResponse 返回格式的对象
    let responseForLog = null;
    try {
        responseForLog = JSON.parse(fullResponseJsonString);
    } catch {
        responseForLog = { content: fullResponseJsonString };
    }
    
    return responseForLog;
  }

  async _handleFullResponse(messageQueue, req, res, initialMessages = []) {
    let fullResponseJsonString = '';
    const pendingMessages = Array.isArray(initialMessages) ? initialMessages.slice() : [];
    const getNextMessage = async () => {
        if (pendingMessages.length > 0) {
            return pendingMessages.shift();
        }
        return await messageQueue.dequeue(600000);
    };
    try {
        while (true) {
            const dataMessage = await getNextMessage();
            if (!dataMessage) {
                break;
            }
            if (dataMessage.type === 'STREAM_END' || dataMessage.event_type === 'stream_close') {
                break;
            }
            if (dataMessage.event_type === 'response_headers') {
                continue;
            }
            if (dataMessage.event_type === 'error') {
                const status = dataMessage.status || 500;
                const errorMessage = `后端系统错误: HTTP ${status}: ${dataMessage.error_type || 'Unknown Error'}. 详情: ${dataMessage.message || 'No details provided'}`;
                this.logger.error(errorMessage);
                
                if (req.isOpenAICompatible && !res.headersSent) {
                    const errorPayload = {
                        error: {
                            message: dataMessage.message || errorMessage,
                            type: dataMessage.error_type || 'upstream_error',
                            code: status
                        }
                    };
                    res.status(status).json(errorPayload);
                    return errorPayload; // Return the error payload instead of throwing
                } else {
                    this._sendErrorResponse(res, status, errorMessage);
                    throw new Error(errorMessage);
                }
            }
            if (dataMessage.data) {
                fullResponseJsonString += dataMessage.data;
            }
        }
    } catch (e) {
        this.logger.error(`Error waiting for full response body: ${e.message}`);
        if (!res.headersSent) {
            this._sendErrorResponse(res, 504, 'Full response from backend timed out');
        }
        throw e;
    }

    if (req.isOpenAICompatible) {
        const openAiEndpoint = this._getOpenAIEndpoint(req.path);
        // --- 新增的判断逻辑 ---
        if (openAiEndpoint === 'models') {
            this.logger.info('正在将Gemini模型列表转换为OpenAI格式...');
            const transformedBody = this._transformGeminiModelsToOpenAI(fullResponseJsonString);
            res.json(transformedBody);
            return transformedBody;

        // --- 原有的对话处理逻辑放入else if中 ---
        } else if (openAiEndpoint === 'chat') {
            this.logger.info('正在将完整的Gemini聊天完成转换为OpenAI格式...');
            
            let geminiResponse = null;
            try {
                geminiResponse = JSON.parse(fullResponseJsonString);
            } catch (e) {
                this.logger.warn(`Could not parse Gemini JSON response: ${e.message}`);
            }

            // 检查是否是错误响应 (状态码非200 或 响应体包含error)
            if (res.statusCode >= 400 || (geminiResponse && geminiResponse.error)) {
                const errorBody = geminiResponse?.error || {
                    message: fullResponseJsonString || 'Unknown error',
                    code: res.statusCode || 500,
                    status: 'error'
                };

                const openAIError = {
                    error: {
                        code: errorBody.code || res.statusCode || 500,
                        message: errorBody.message || 'Unknown error',
                        status: errorBody.status || 'error',
                        type: errorBody.status || 'error'
                    }
                };
                
                // 如果之前没有设置正确的状态码，这里补上
                if (res.statusCode === 200 && errorBody.code && typeof errorBody.code === 'number') {
                    res.status(errorBody.code);
                }

                res.json(openAIError);
                return openAIError;
            }

            let finalContent = '';
            let reasoningContent = null;
            let imageContent = null;
            let usage = null;
            let finishReason = null;
            const toolCalls = [];

            if (geminiResponse) {
                usage = this._mapUsageMetadataToOpenAI(geminiResponse.usageMetadata);
                finishReason = geminiResponse.candidates?.[0]?.finishReason || null;
                const parts = geminiResponse.candidates?.[0]?.content?.parts;

                if (parts && Array.isArray(parts)) {
                    // 处理所有部分，包括文本和图片
                    parts.forEach(part => {
                        const toolCall = part?.toolCall || part?.functionCall;
                        if (toolCall && toolCall.name) {
                            // 1. 参数类型反转
                            let rawArgs = toolCall.args ?? toolCall.arguments;
                            if (typeof rawArgs === 'object' && rawArgs !== null) {
                                rawArgs = this._reverseTransformArgs(rawArgs);
                            }
                            const argsString = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
                            
                            // 2. Thought Signature 编码
                            const originalId = toolCall.id || `call_${req.customRequestId}_${toolCalls.length}`;
                            const signature = part.thoughtSignature;
                            const encodedId = this._encodeToolIdWithSignature(originalId, signature);

                            toolCalls.push({
                                id: encodedId,
                                type: 'function',
                                function: {
                                    name: toolCall.name,
                                    arguments: argsString
                                }
                            });
                        } else if (part.thought === true && part.text) {
                            reasoningContent = part.text;
                        } else if (part.text) {
                            finalContent += part.text;
                        } else if (part.executableCode) {
                            const lang = part.executableCode.language || 'python';
                            const code = part.executableCode.code || '';
                            finalContent += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
                        } else if (part.codeExecutionResult) {
                            const outcome = part.codeExecutionResult.outcome;
                            const output = part.codeExecutionResult.output || '';
                            const label = outcome === 'OUTCOME_OK' ? 'output' : 'error';
                            finalContent += `\n\`\`\`${label}\n${output}\n\`\`\`\n`;
                        } else if (part.inlineData) {
                            // 处理图片数据
                            const mimeType = part.inlineData.mimeType || 'image/png';
                            const base64Data = part.inlineData.data;
                            const imageMarkdown = `![image](data:${mimeType};base64,${base64Data})`;
                            if (!imageContent) {
                                imageContent = imageMarkdown;
                            } else {
                                imageContent += '\n' + imageMarkdown;
                            }
                        }
                    });
                }
            } else {
                finalContent = fullResponseJsonString;
            }

            const transformedBody = this._transformGeminiCompletionToOpenAI(
                finalContent,
                reasoningContent,
                req.customRequestId,
                req.requestTimestamp,
                req.requestedModel,
                imageContent,
                finishReason,
                toolCalls
            );
            if (usage) {
                transformedBody.usage = usage;
            }
            const responseForClient = { ...transformedBody };
            if (responseForClient.usage) {
                responseForClient.usage = this._sanitizeOpenAIUsageForClient(responseForClient.usage);
            }
            res.json(responseForClient);
            return transformedBody;
        } else {
            // 对于未知的OpenAI兼容路径，发送错误
            const errorMessage = `Unknown OpenAI-compatible path: ${req.path}`;
            this._sendErrorResponse(res, 404, errorMessage);
            throw new Error(errorMessage);
        }
    } else {
        this.logger.info('正在直接转发原生Gemini响应...');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        
        let finalResponse = fullResponseJsonString;
        // Check if this is a Gemini models list response
        if (req.path === '/v1beta/models') {
             finalResponse = this._addPseudoStreamModelsForGemini(fullResponseJsonString);
        }

        res.send(finalResponse);
        try {
            return JSON.parse(finalResponse);
        } catch {
            return finalResponse;
        }
    }
    this.logger.info('完整响应已发送。');
}

  _addPseudoStreamModelsForGemini(geminiJSON) {
    // 检查开关是否开启
    if (!this.serverSystem.config.enablePseudoStreamModels) {
        return geminiJSON;
    }

    try {
      const geminiBody = JSON.parse(geminiJSON);
      if (!geminiBody.models || !Array.isArray(geminiBody.models)) {
        this.logger.warn('[PseudoStream] Gemini model list format is unexpected, skipping.');
        return geminiJSON;
      }

      const isBlacklisted = (name) => /computer-use|tts|audio|imagen|embedding/i.test(name);
      const pseudoStreamModels = geminiBody.models
        .filter(model => (model.name.startsWith('models/gemini') || model.name.startsWith('gemini')) && !isBlacklisted(model.name))
        .map(model => {
            const newModel = JSON.parse(JSON.stringify(model)); // Deep copy
            newModel.name = `${model.name}-伪流`;
            if (newModel.displayName) {
            newModel.displayName = `${model.displayName} (伪流)`;
            }
            return newModel;
        });

      geminiBody.models.push(...pseudoStreamModels);
      return JSON.stringify(geminiBody);
    } catch (e) {
      this.logger.error(`[PseudoStream] Failed to add pseudo-stream models for Gemini response: ${e.message}`);
      return geminiJSON; // Return original on error
    }
  }


  async _handleStreamResponse(messageQueue, req, res, initialMessages = []) {
      let collectedContent = '';
      let collectedReasoning = '';
      let totalContentLength = 0;
      const maxLoggedContent = Number.POSITIVE_INFINITY; // keep full stream content
      const collectedChunks = []; // 存储完整的OpenAI chunk，便于日志查看思考等字段
      const rawSseLines = []; // 存储原始的 data 行，便于还原完整流
      let latestUsage = null;
      let usageEmitted = false;
      let streamError = null;
      let clientAborted = false;
      let sseBuffer = '';
      let doneReceived = false;
      const pendingMessages = Array.isArray(initialMessages) ? initialMessages.slice() : [];

      const abortHandler = () => {
          clientAborted = true;
          messageQueue.close();
      };
      res.on('close', abortHandler);

      const emitUsageChunk = () => {
          if (req.isOpenAICompatible && latestUsage && !usageEmitted) {
              const usageChunk = {
                  id: req.customRequestId,
                  object: "chat.completion.chunk",
                  created: req.requestTimestamp,
                  model: req.requestedModel,
                  choices: [{
                      index: 0,
                      delta: {},
                      finish_reason: 'stop'
                  }],
                  usage: latestUsage
              };
              const clientUsageChunk = this._sanitizeOpenAIChunkForClient(usageChunk);
              res.write(`data: ${JSON.stringify(clientUsageChunk)}\n\n`);
              usageEmitted = true;
          }
      };

      const pushChunk = (chunk) => {
          collectedChunks.push(chunk);
      };

      const pushRawLine = (line) => {
          rawSseLines.push(line);
      };

      const flushRemainingSseBuffer = () => {
          if (doneReceived) return;
          const remaining = sseBuffer.trim();
          sseBuffer = '';
          if (!remaining || !remaining.startsWith('data: ')) return;
          const jsonString = remaining.substring(6).trim();
          if (!jsonString || jsonString === '[DONE]') return;

          if (req.isOpenAICompatible) {
              try {
                  const geminiChunk = JSON.parse(jsonString);
                  const usageFromChunk = this._mapUsageMetadataToOpenAI(geminiChunk.usageMetadata || geminiChunk.usage);
                  if (usageFromChunk) {
                      latestUsage = usageFromChunk;
                  }
                  const openAIChunk = this._transformGeminiChunkToOpenAIChunk(geminiChunk, req.customRequestId, req.requestTimestamp, req.requestedModel);
                  if (openAIChunk && usageFromChunk && !openAIChunk.usage) {
                      openAIChunk.usage = usageFromChunk;
                  }
                  if (openAIChunk) {
                      pushChunk(openAIChunk);
                      pushRawLine(jsonString);
                      const clientChunk = this._sanitizeOpenAIChunkForClient(openAIChunk);
                      res.write(`data: ${JSON.stringify(clientChunk)}\n\n`);
                      if (typeof res.flush === 'function') {
                          res.flush();
                      }
                      if (openAIChunk.usage) {
                          latestUsage = openAIChunk.usage;
                          usageEmitted = true;
                      }
                      if (openAIChunk.choices && openAIChunk.choices[0] && openAIChunk.choices[0].delta) {
                          if (openAIChunk.choices[0].delta.content) {
                              const content = openAIChunk.choices[0].delta.content;
                              totalContentLength += content.length;
                              if (collectedContent.length < maxLoggedContent) {
                                  collectedContent += content;
                              }
                          }
                          if (openAIChunk.choices[0].delta.reasoning) {
                              const reasoning = openAIChunk.choices[0].delta.reasoning;
                              if (collectedReasoning.length < maxLoggedContent) {
                                  collectedReasoning += reasoning;
                              }
                          }
                      }
                  }
              } catch (e) {
                  this.logger.warn(`Could not parse or transform stream chunk JSON: "${jsonString}". Error: ${e.message}`);
              }
          } else {
              pushRawLine(jsonString);
              if (jsonString.startsWith('{')) {
                  try {
                      const parsedNativeChunk = JSON.parse(jsonString);
                      const usageFromNative = this._mapUsageMetadataToOpenAI(parsedNativeChunk.usageMetadata || parsedNativeChunk.usage);
                      if (usageFromNative) {
                          latestUsage = usageFromNative;
                      }
                  } catch {
                      // ignore parse errors in native stream lines
                  }
              }
          }
      };
      
      try {
          while (true) {
              if (clientAborted) {
                  throw new Error('Client closed connection');
              }
              const geminiMessage = pendingMessages.length > 0
                  ? pendingMessages.shift()
                  : await messageQueue.dequeue(600000);
              if (!geminiMessage) {
                  break;
              }
              if (geminiMessage.event_type === 'error') {
                  const errorMessage = `后端系统错误: HTTP ${geminiMessage.status || 500}: ${geminiMessage.error_type || 'Unknown Error'}. 详情: ${geminiMessage.message || 'No details provided'}`;
                  this.logger.error(errorMessage);
                  if (req.isOpenAICompatible) {
                      const errorPayload = {
                          error: {
                              message: errorMessage,
                              type: geminiMessage.error_type || 'backend_error',
                              code: geminiMessage.status || 500
                          }
                      };
                      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
                      res.write('data: [DONE]\n\n');
                  } else if (!res.headersSent) {
                      this._sendErrorResponse(res, geminiMessage.status || 502, errorMessage);
                  }
                  streamError = new Error(errorMessage);
                  break;
              }
              if (geminiMessage.type === 'STREAM_END' || geminiMessage.event_type === 'stream_close') {
                  this.logger.info('后端流式传输结束。');
                  flushRemainingSseBuffer();
                  if (!doneReceived) {
                      emitUsageChunk();
                      if (req.isOpenAICompatible) {
                          res.write('data: [DONE]\n\n');
                      }
                  }
                  break;
              }
              if (geminiMessage.event_type === 'response_headers') {
                  continue;
              }

              if (geminiMessage.data) {
                  if (req.isOpenAICompatible) {
                      const rawData = geminiMessage.data;

                      // 尝试检测是否为非SSE格式的错误JSON
                      try {
                          const trimmedData = rawData.trim();
                          if (trimmedData.startsWith('{') && trimmedData.endsWith('}')) {
                              const parsed = JSON.parse(trimmedData);
                              if (parsed.error) {
                                  const errorPayload = {
                                      error: {
                                          message: parsed.error.message || 'Unknown error',
                                          type: parsed.error.status || 'upstream_error',
                                          code: parsed.error.code || 500
                                      }
                                  };
                                  res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
                              }
                          }
                      } catch (_) {}

                      sseBuffer += rawData;
                      const lines = sseBuffer.split('\n');
                      sseBuffer = lines.pop();
                      for (const line of lines) {
                          if (line.startsWith('data: ')) {
                              const jsonString = line.substring(6).trim();
                              if (!jsonString) continue;
                              if (jsonString === '[DONE]') {
                                  doneReceived = true;
                                  emitUsageChunk();
                                  res.write('data: [DONE]\n\n');
                                  break;
                              }
                              try {
                                  const geminiChunk = JSON.parse(jsonString);

                                  if (geminiChunk.error) {
                                      const errorPayload = {
                                          error: {
                                              message: geminiChunk.error.message || 'Unknown error',
                                              type: geminiChunk.error.status || 'upstream_error',
                                              code: geminiChunk.error.code || 500
                                          }
                                      };
                                      res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
                                  }

                                  const usageFromChunk = this._mapUsageMetadataToOpenAI(geminiChunk.usageMetadata || geminiChunk.usage);
                                  if (usageFromChunk) {
                                      latestUsage = usageFromChunk;
                                  }
                                  const openAIChunk = this._transformGeminiChunkToOpenAIChunk(geminiChunk, req.customRequestId, req.requestTimestamp, req.requestedModel);
                                  if (openAIChunk && usageFromChunk && !openAIChunk.usage) {
                                      openAIChunk.usage = usageFromChunk;
                                  }
                                  if (openAIChunk) {
                                      pushChunk(openAIChunk);
                                      pushRawLine(jsonString);
                                      const clientChunk = this._sanitizeOpenAIChunkForClient(openAIChunk);
                                      res.write(`data: ${JSON.stringify(clientChunk)}\n\n`);
                                      if (typeof res.flush === 'function') {
                                          res.flush();
                                      }
                                      if (openAIChunk.usage) {
                                          latestUsage = openAIChunk.usage;
                                          usageEmitted = true;
                                      }
                                      // 收集内容用于日志，但限制总长度
                                      if (openAIChunk.choices && openAIChunk.choices[0] && openAIChunk.choices[0].delta) {
                                          if (openAIChunk.choices[0].delta.content) {
                                              const content = openAIChunk.choices[0].delta.content;
                                              totalContentLength += content.length;
                                              
                                              // 只收集前面的内容，避免内存溢出
                                              if (collectedContent.length < maxLoggedContent) {
                                                  collectedContent += content;
                                              }
                                          }
                                          if (openAIChunk.choices[0].delta.reasoning) {
                                              const reasoning = openAIChunk.choices[0].delta.reasoning;
                                              if (collectedReasoning.length < maxLoggedContent) {
                                                  collectedReasoning += reasoning;
                                              }
                                          }
                                      }
                                  }
                              } catch (e) {
                                  this.logger.warn(`Could not parse or transform stream chunk JSON: "${jsonString}". Error: ${e.message}`);
                              }
                          }
                      }
                      if (doneReceived) {
                          break;
                      }
                  } else {
                      res.write(geminiMessage.data);
                      if (typeof res.flush === 'function') {
                          res.flush();
                      }
                      // 兼容 SSE 的原生 Gemini 流：逐行解析 usage 元数据
                      const rawData = geminiMessage.data;
                      sseBuffer += rawData;
                      const lines = sseBuffer.split('\n');
                      sseBuffer = lines.pop();
                      for (const line of lines) {
                          if (line.startsWith('data: ')) {
                              const jsonString = line.substring(6).trim();
                              if (!jsonString) continue;
                              if (jsonString === '[DONE]') {
                                  doneReceived = true;
                                  break;
                              }
                              pushRawLine(jsonString);
                              if (jsonString.startsWith('{')) {
                                  try {
                                      const parsedNativeChunk = JSON.parse(jsonString);
                                      const usageFromNative = this._mapUsageMetadataToOpenAI(parsedNativeChunk.usageMetadata || parsedNativeChunk.usage);
                                      if (usageFromNative) {
                                          latestUsage = usageFromNative;
                                      }
                                  } catch {
                                      // ignore parse errors in native stream lines
                                  }
                              }
                          }
                      }
                      // 对于原生Gemini格式也收集内容
                      totalContentLength += rawData.length;
                      if (collectedContent.length < maxLoggedContent) {
                          collectedContent += rawData;
                      }
                      if (doneReceived) {
                          break;
                      }
                  }
              }
          }
          if (!streamError && !clientAborted) {
              flushRemainingSseBuffer();
          }
      } catch(error) {
          streamError = error;
          this.logger.error(`Stream processing error: ${error.message}`);
      } finally {
          res.removeListener('close', abortHandler);
          if(!res.writableEnded) {
              res.end();
              this.logger.info('流式响应连接已关闭。');
          }
      }
      
      // 返回更完整的内容摘要和元数据
      const responseData = {
          streamedContent: collectedContent,
          streamedReasoning: collectedReasoning || undefined,
          chunks: collectedChunks,
          rawSse: rawSseLines,
          totalLength: totalContentLength,
          truncated: totalContentLength > collectedContent.length,
          usage: latestUsage || undefined
      };
      
      // 如果内容被截断，添加提示信息
      if (responseData.truncated) {
          this.logger.debug(`流式响应内容已记录 ${collectedContent.length} 字符（总长度：${totalContentLength} 字符）`);
      }
      
      if (clientAborted) {
          throw new Error('Client closed connection');
      }
      if (streamError) {
          throw streamError;
      }
      return responseData;
  }

  _setResponseHeaders(res, req, headerMessage) {
    const status = headerMessage.status || 200;
    // 只有在非错误状态下才设置SSE头
    if (req.isStreaming && status < 400) {
        // 为 SSE 明确声明防缓冲头，避免中间代理或客户端聚合后才返回
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        // 常见反向代理（如 Nginx）会因缺少该头而缓冲 SSE
        res.setHeader('X-Accel-Buffering', 'no');
    }
    res.status(status);
    if (req.isStreaming && status < 400 && typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }
  }

  _sendErrorResponse(res, status, message) {
    if (!res.headersSent) {
      res.status(status).send(message);
    }
  }

   _handleRequestError(error, req, res) {
    if (!res.headersSent) {
      if (error.message === 'Queue timeout') {
        this._sendErrorResponse(res, 504, '请求超时');
      } else if (error.message === '当前请求模型在现有所有连接中使用额度到上限') {
        this.logger.warn(`请求处理被拒绝: ${error.message}`);
        if (req.isOpenAICompatible) {
             res.status(429).json({
                 error: {
                     message: error.message,
                     type: 'insufficient_quota',
                     code: 429
                 }
             });
        } else {
             this._sendErrorResponse(res, 429, error.message);
        }
      } else {
        this.logger.error(`请求处理错误: ${error.message}`);
        this._sendErrorResponse(res, 500, `代理错误: ${error.message}`);
      }
    } else {
        this.logger.error(`请求处理错误（头已发送）: ${error.message}`);
        if(!res.writableEnded) res.end();
    }
  }
}

// 新增：请求监控和统计类（使用本地文件存储）
const fs = require('fs');
const fsp = fs.promises;

class RequestMonitor {
  constructor(logger, config = {}) {
    this.logger = logger;
    this.serverConfig = config;
    // 修改为使用外部目录存储日志，而不是在打包的EXE内部
    // 使用进程工作目录而不是__dirname
    this.logsDir = path.join(process.cwd(), 'request_logs');
    this.indexFile = path.join(this.logsDir, 'index.json');
    this.imageIndexFile = path.join(this.logsDir, 'image_index.json');
    this.statsFile = path.join(this.logsDir, 'stats.json');
    // 索引容量：默认不限（使用安全整数上限），如需限制可调整
    this.maxIndexEntries = Number.MAX_SAFE_INTEGER;
    
    // 内存中的索引和统计（用于快速访问）
    this.logIndex = []; // 只存储元数据，不存储内容
    this.imageIndex = []; // 图片索引元数据
    this.stats = {
      totalRequests: 0,
      successRequests: 0,
      errorRequests: 0,
      rateLimitErrors: 0,
      totalResponseTime: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      modelStats: {},
      startTime: Date.now()
    };
    
    // 初始化存储目录
    this.readyPromise = this.initStorage();
    this.writeQueue = Promise.resolve();
  }

  // 本地时区日期 YYYY-MM-DD
  _formatLocalDate(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 本地时区时间 HH-MM-SS
  _formatLocalTime(date = new Date()) {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}-${mm}-${ss}`;
  }

  _sanitizePayload(payload) {
    if (!this.serverConfig || !this.serverConfig.excludeBase64InLogs) {
      return payload;
    }
    
    if (!payload) return payload;

    try {
      // Deep clone to avoid modifying original data
      const cloned = JSON.parse(JSON.stringify(payload));
      
      const traverse = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        
        // Handle Arrays
        if (Array.isArray(obj)) {
          obj.forEach(item => traverse(item));
          return;
        }
        
        // Handle Objects
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // Gemini inlineData
            if (key === 'inlineData' && obj[key] && typeof obj[key] === 'object') {
               if (obj[key].data && typeof obj[key].data === 'string' && obj[key].data.length > 100) {
                   obj[key].data = `[Base64 Image Data Excluded (${obj[key].data.length} chars)]`;
               }
            }
            // OpenAI image_url
            else if (key === 'image_url' && obj[key] && typeof obj[key] === 'object') {
                if (obj[key].url && typeof obj[key].url === 'string' && obj[key].url.startsWith('data:image')) {
                    obj[key].url = `[Base64 Image Data Excluded]`;
                }
            }
            // Generic "data" field with mimeType sibling (common in some internal structures)
            else if (key === 'data' && typeof obj[key] === 'string' && obj[key].length > 100 && obj['mimeType']) {
                 obj[key] = `[Base64 Image Data Excluded (${obj[key].length} chars)]`;
            }
            // Recurse
            else {
                traverse(obj[key]);
            }
          }
        }
      };
      
      traverse(cloned);
      return cloned;
    } catch (e) {
      this.logger.warn(`Sanitize payload failed: ${e.message}`);
      return payload; // Fallback to original
    }
  }

  // 初始化存储目录和文件
  async initStorage() {
    try {
      // 创建日志目录
      if (!fs.existsSync(this.logsDir)) {
        await fsp.mkdir(this.logsDir, { recursive: true });
        const c = this.logger.colors;
        this.logger.info(`创建日志目录: ${c.underscore}${this.logsDir}${c.reset}`);
      }
    
    // 创建子目录（按日期组织）
    const todayDir = path.join(this.logsDir, this._formatLocalDate());
    if (!fs.existsSync(todayDir)) {
      await fsp.mkdir(todayDir, { recursive: true });
    }
      
      // 加载现有索引
      if (fs.existsSync(this.indexFile)) {
        try {
          const indexData = await fsp.readFile(this.indexFile, 'utf8');
          this.logIndex = JSON.parse(indexData);
          const c = this.logger.colors;
          this.logger.success(`加载了 ${c.fg.cyan}${this.logIndex.length}${c.reset} 条日志索引`);
        } catch (error) {
          this.logger.warn('索引文件损坏，创建新索引');
          this.logIndex = [];
        }
      }

      // 加载图片索引
      if (fs.existsSync(this.imageIndexFile)) {
        try {
          const imgData = await fsp.readFile(this.imageIndexFile, 'utf8');
          this.imageIndex = JSON.parse(imgData);
          this.logger.success(`加载了 ${this.logger.colors.fg.cyan}${this.imageIndex.length}${this.logger.colors.reset} 条图片索引`);
        } catch (error) {
          this.logger.warn('图片索引文件损坏，将重新构建');
          this.imageIndex = [];
        }
      }
      
      // 加载统计数据
      if (fs.existsSync(this.statsFile)) {
        try {
          const statsData = await fsp.readFile(this.statsFile, 'utf8');
          this.stats = { ...this.stats, ...JSON.parse(statsData) };
        } catch (error) {
          this.logger.warn('统计文件损坏，使用默认值');
        }
      }

      // 价格表可能更新（新增/修正模型），这里基于索引重新计算费用，确保历史记录展示正确
      this._recalculateCostsFromIndex();
    } catch (error) {
      this.logger.error(`初始化存储失败: ${error.message}`);
    }
  }

  // 保存索引到文件
  _queueWrite(task) {
    this.writeQueue = this.writeQueue.then(task, task);
    return this.writeQueue;
  }

  async _writeFileAtomic(filePath, data) {
    const tmpFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpFile, data);
    await fsp.rename(tmpFile, filePath);
  }

  async saveIndex() {
    try {
      await this._queueWrite(() =>
        this._writeFileAtomic(this.indexFile, JSON.stringify(this.logIndex, null, 2))
      );
    } catch (error) {
      this.logger.error(`保存索引失败: ${error.message}`);
    }
  }

  async saveImageIndex() {
    try {
      await this._queueWrite(() =>
        this._writeFileAtomic(this.imageIndexFile, JSON.stringify(this.imageIndex, null, 2))
      );
    } catch (error) {
      this.logger.error(`保存图片索引失败: ${error.message}`);
    }
  }
  
  // 保存统计数据
  async saveStats() {
    try {
      await this._queueWrite(() =>
        this._writeFileAtomic(this.statsFile, JSON.stringify(this.stats, null, 2))
      );
    } catch (error) {
      this.logger.error(`保存统计失败: ${error.message}`);
    }
  }

  _toNumber(value) {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  _getEntryDateKey(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.date) return entry.date;
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!Number.isNaN(ts.getTime())) {
        return this._formatLocalDate(ts);
      }
    }
    return null;
  }

  _getEntryUsageTotals(entry) {
    if (!entry || typeof entry !== 'object') {
      return { totalTokens: 0, costUsd: 0 };
    }

    const promptTokens = this._toNumber(
      entry.promptTokens ??
      entry.prompt_tokens ??
      entry.usage?.prompt_tokens
    );
    const completionTokens = this._toNumber(
      entry.completionTokens ??
      entry.completion_tokens ??
      entry.usage?.completion_tokens
    );
    let totalTokens = this._toNumber(
      entry.totalTokens ??
      entry.total_tokens ??
      entry.usage?.total_tokens
    );

    if (totalTokens === null) {
      totalTokens = (promptTokens || 0) + (completionTokens || 0);
    }

    let costUsd = this._toNumber(
      entry.costUsd ??
      entry.totalCostUsd ??
      entry.cost ??
      entry.usage?.costUsd
    );
    if (costUsd === null && (promptTokens || completionTokens)) {
      costUsd = this._estimateCost(entry.model, promptTokens || 0, completionTokens || 0);
    }

    return {
      totalTokens: totalTokens || 0,
      costUsd: costUsd || 0
    };
  }

  _getWeekStartDate(date = new Date()) {
    const base = new Date(date);
    const day = base.getDay(); // 0=Sun, 1=Mon
    const diffToMonday = (day + 6) % 7;
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() - diffToMonday);
    return base;
  }

  _calculatePeriodUsage() {
    const now = new Date();
    const todayKey = this._formatLocalDate(now);
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = this._formatLocalDate(yesterday);

    const weekStart = this._getWeekStartDate(now);
    const weekStartKey = this._formatLocalDate(weekStart);
    
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekStartKey = this._formatLocalDate(lastWeekStart);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartKey = this._formatLocalDate(monthStart);
    
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStartKey = this._formatLocalDate(lastMonthStart);

    // Debug logs for period keys
    // this.logger.debug(`Period Keys: Today=${todayKey}, WeekStart=${weekStartKey}, MonthStart=${monthStartKey}`);

    const totals = {
      today: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 },
      yesterday: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 },
      week: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 },
      lastWeek: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 },
      month: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 },
      lastMonth: { totalTokens: 0, totalCostUsd: 0, totalCalls: 0 }
    };

    let processedCount = 0;
    for (const entry of this.logIndex) {
      const dateKey = this._getEntryDateKey(entry);
      if (!dateKey) continue;
      // Optimization: skip entries older than last month start
      if (dateKey < lastMonthStartKey) continue;
      
      const status = (entry.status || '').toLowerCase();
      if (status !== 'success') continue;

      // 过滤掉 models-list 请求
      const model = (entry.model || '').toLowerCase();
      if (model === 'models-list') continue;

      const { totalTokens, costUsd } = this._getEntryUsageTotals(entry);
      processedCount++;
      
      // Today
      if (dateKey === todayKey) {
        totals.today.totalTokens += totalTokens;
        totals.today.totalCostUsd += costUsd;
        totals.today.totalCalls++;
      }
      
      // Yesterday
      if (dateKey === yesterdayKey) {
        totals.yesterday.totalTokens += totalTokens;
        totals.yesterday.totalCostUsd += costUsd;
        totals.yesterday.totalCalls++;
      }

      // Current Week
      if (dateKey >= weekStartKey) {
        totals.week.totalTokens += totalTokens;
        totals.week.totalCostUsd += costUsd;
        totals.week.totalCalls++;
      }
      
      // Last Week (>= lastWeekStartKey AND < weekStartKey)
      if (dateKey >= lastWeekStartKey && dateKey < weekStartKey) {
        totals.lastWeek.totalTokens += totalTokens;
        totals.lastWeek.totalCostUsd += costUsd;
        totals.lastWeek.totalCalls++;
      }

      // Current Month
      if (dateKey >= monthStartKey) {
        totals.month.totalTokens += totalTokens;
        totals.month.totalCostUsd += costUsd;
        totals.month.totalCalls++;
      }
      
      // Last Month (>= lastMonthStartKey AND < monthStartKey)
      if (dateKey >= lastMonthStartKey && dateKey < monthStartKey) {
        totals.lastMonth.totalTokens += totalTokens;
        totals.lastMonth.totalCostUsd += costUsd;
        totals.lastMonth.totalCalls++;
      }
    }
    
    // this.logger.debug(`Calculated period usage from ${processedCount} entries.`);

    totals.today.totalCostUsd = +totals.today.totalCostUsd.toFixed(6);
    totals.yesterday.totalCostUsd = +totals.yesterday.totalCostUsd.toFixed(6);
    totals.week.totalCostUsd = +totals.week.totalCostUsd.toFixed(6);
    totals.lastWeek.totalCostUsd = +totals.lastWeek.totalCostUsd.toFixed(6);
    totals.month.totalCostUsd = +totals.month.totalCostUsd.toFixed(6);
    totals.lastMonth.totalCostUsd = +totals.lastMonth.totalCostUsd.toFixed(6);

    return totals;
  }

  _normalizeUsage(rawUsage) {
    if (!rawUsage) return null;

    const promptTokens = this._toNumber(
      rawUsage.prompt_tokens ??
      rawUsage.promptTokenCount ??
      rawUsage.inputTokenCount ??
      rawUsage.inputTokens
    );
    const completionTokens = this._toNumber(
      rawUsage.completion_tokens ??
      rawUsage.candidatesTokenCount ??
      rawUsage.outputTokenCount ??
      rawUsage.outputTokens
    );
    let totalTokens = this._toNumber(
      rawUsage.total_tokens ??
      rawUsage.totalTokenCount
    );

    if (totalTokens === null && promptTokens !== null && completionTokens !== null) {
      totalTokens = promptTokens + completionTokens;
    }

    if (promptTokens === null && completionTokens === null && totalTokens === null) {
      return null;
    }

    const usage = {
      prompt_tokens: promptTokens ?? 0,
      completion_tokens: completionTokens ?? 0,
      total_tokens: totalTokens ?? ((promptTokens ?? 0) + (completionTokens ?? 0))
    };

    if (rawUsage.promptTokensDetails || rawUsage.prompt_tokens_details) {
      usage.prompt_tokens_details = rawUsage.promptTokensDetails || rawUsage.prompt_tokens_details;
    }
    if (rawUsage.completionTokensDetails || rawUsage.completion_tokens_details) {
      usage.completion_tokens_details = rawUsage.completionTokensDetails || rawUsage.completion_tokens_details;
    }

    return {
      usage,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    };
  }

  _extractUsageFromResponse(responseBody, providedUsage = null) {
    const direct = this._normalizeUsage(providedUsage);
    if (direct) return direct;

    if (responseBody && typeof responseBody === 'object') {
      const fromObject = this._normalizeUsage(responseBody.usage || responseBody.usageMetadata);
      if (fromObject) return fromObject;
    }

    if (typeof responseBody === 'string') {
      try {
        const parsed = JSON.parse(responseBody);
        const fromParsed = this._normalizeUsage(parsed.usage || parsed.usageMetadata);
        if (fromParsed) return fromParsed;
      } catch (error) {
        return null;
      }
    }

    return null;
  }

  _estimateCost(model, promptTokens = 0, completionTokens = 0) {
    const normalizedModel = (model || '').toLowerCase();
    const pricingTable = [
      // 1. 特殊模型 & 图像生成 (高优先级)
      {
        match: ['gemini-robotics-er-1.5-preview'],
        inputLow: 0.30,
        outputLow: 2.50
      },
      {
        match: ['gemini-3-pro-image-preview'],
        inputLow: 2.0,
        outputLow: 120.00
      },
      {
        match: ['gemini-2.5-flash-image'],
        inputLow: 0.10,
        outputLow: 30.00
      },
      {
        match: ['gemini-2.0-flash-exp-image-generation'],
        inputLow: 0.10,
        outputLow: 30.00
      },
      {
        match: ['gemini-2.5-computer-use-preview'],
        inputLow: 1.25,
        inputHigh: 2.50,
        outputLow: 10.00,
        outputHigh: 15.00,
        threshold: 200000
      },
      {
        match: ['text-embedding-004', 'embedding-001', 'embedding-gecko-001'],
        inputLow: 0.10,
        outputLow: 0.00
      },

      // 2. Gemini 3 系列
      {
        match: ['gemini-3-flash-preview', 'gemini-3-flash'],
        inputLow: 0.50,
        outputLow: 3.00
      },
      {
        match: ['gemini-3-pro-preview', 'gemini-3-pro', 'gemini-3.0-pro'],
        inputLow: 2.0,
        inputHigh: 4.0,
        outputLow: 12.0,
        outputHigh: 18.0,
        threshold: 200000
      },

      // 3. Gemini 2.5 Pro 系列
      {
        match: ['gemini-2.5-pro', 'gemini-pro-latest'],
        inputLow: 1.25,
        inputHigh: 2.50,
        outputLow: 10.00,
        outputHigh: 15.00,
        threshold: 200000
      },

      // 4. Gemini 2.5 Flash Lite 系列
      {
        match: [
            'gemini-2.5-flash-lite',
            'gemini-flash-lite-latest'
        ],
        inputLow: 0.10,
        outputLow: 0.40
      },

      // 5. Gemini 2.5 Flash 系列
      {
        match: [
            'gemini-2.5-flash',
            'gemini-flash-latest'
        ],
        inputLow: 0.15,
        outputLow: 0.60
      },

      // 6. Gemini 2.0 Flash Lite 系列
      {
        match: [
            'gemini-2.0-flash-lite'
        ],
        inputLow: 0.075,
        outputLow: 0.30
      },

      // 7. Gemini 2.0 Flash 系列 (包含 gemini-exp-1206)
      {
        match: [
            'gemini-2.0-flash',
            'gemini-exp-1206'
        ],
        inputLow: 0.10,
        outputLow: 0.40
      }
    ];

    const pricing = pricingTable.find(p => p.match.some(key => normalizedModel.includes(key)));
    if (!pricing) return 0;

    const threshold = pricing.threshold || Infinity;
    const inputRate = promptTokens > threshold && pricing.inputHigh ? pricing.inputHigh : pricing.inputLow;
    const outputRate = completionTokens > threshold && pricing.outputHigh ? pricing.outputHigh : pricing.outputLow;

    const promptCost = ((promptTokens || 0) / 1_000_000) * (inputRate || 0);
    const completionCost = ((completionTokens || 0) / 1_000_000) * (outputRate || 0);

    return +(promptCost + completionCost).toFixed(6);
  }

  _recalculateCostsFromIndex() {
    let totalCostUsd = 0;
    const modelCosts = {};

    if (!Array.isArray(this.logIndex)) return;

    for (const entry of this.logIndex) {
      if (!entry || typeof entry !== 'object') continue;
      const promptTokens = this._toNumber(entry.promptTokens) ?? 0;
      const completionTokens = this._toNumber(entry.completionTokens) ?? 0;
      if (!promptTokens && !completionTokens) continue;

      const costUsd = this._estimateCost(entry.model, promptTokens, completionTokens);
      entry.costUsd = costUsd;
      totalCostUsd += costUsd;

      if (entry.model) {
        modelCosts[entry.model] = (modelCosts[entry.model] || 0) + costUsd;
      }
    }

    this.stats.totalCostUsd = totalCostUsd;
    if (this.stats.modelStats && typeof this.stats.modelStats === 'object') {
      for (const [model, stats] of Object.entries(this.stats.modelStats)) {
        if (!stats || typeof stats !== 'object') continue;
        stats.totalCostUsd = modelCosts[model] || 0;
      }
    }
  }

  // 辅助方法：解析日志文件路径 (处理绝对/相对路径及项目移动的情况)
  _resolveLogPath(storedPath) {
    if (!storedPath) return null;

    // 1. 如果是相对路径，直接拼接 logsDir
    if (!path.isAbsolute(storedPath)) {
      return path.join(this.logsDir, storedPath);
    }

    // 2. 如果是绝对路径
    // 2.1 检查文件是否存在 (未移动项目的情况)
    if (fs.existsSync(storedPath)) {
      return storedPath;
    }

    // 2.2 如果不存在，尝试作为相对路径处理 (项目已移动)
    // 假设存储的是 .../request_logs/YYYY-MM-DD/filename.json
    // 我们尝试提取 YYYY-MM-DD/filename.json
    const parts = storedPath.split(/[/\\]/); // 支持 / 和 \
    if (parts.length >= 2) {
        // 倒数第二个应该是日期目录
        const dateDir = parts[parts.length - 2];
        const fileName = parts[parts.length - 1];
        // 简单的正则检查日期格式 YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) {
             const newPath = path.join(this.logsDir, dateDir, fileName);
             if (fs.existsSync(newPath)) {
                 return newPath;
             }
             return newPath; // 即使不存在也返回新路径，可能是在写入前
        }
    }
    
    return storedPath; // 返回原路径
  }

  // 辅助方法：解析日志文件路径 (处理绝对/相对路径及项目移动的情况)
  _resolveLogPath(storedPath) {
    if (!storedPath) return null;

    // 1. 如果是相对路径，直接拼接 logsDir
    if (!path.isAbsolute(storedPath)) {
      return path.join(this.logsDir, storedPath);
    }

    // 2. 如果是绝对路径
    // 2.1 检查文件是否存在 (未移动项目的情况)
    if (fs.existsSync(storedPath)) {
      return storedPath;
    }

    // 2.2 如果不存在，尝试作为相对路径处理 (项目已移动)
    // 假设存储的是 .../request_logs/YYYY-MM-DD/filename.json
    // 我们尝试提取 YYYY-MM-DD/filename.json
    const parts = storedPath.split(/[/\\]/); // 支持 / 和 \
    if (parts.length >= 2) {
        // 倒数第二个应该是日期目录
        const dateDir = parts[parts.length - 2];
        const fileName = parts[parts.length - 1];
        // 简单的正则检查日期格式 YYYY-MM-DD
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) {
             const newPath = path.join(this.logsDir, dateDir, fileName);
             if (fs.existsSync(newPath)) {
                 return newPath;
             }
             return newPath; // 即使不存在也返回新路径，可能是在写入前
        }
    }
    
    return storedPath; // 返回原路径
  }

  // 记录请求开始
  async logRequestStart(requestId, model, connectionId, requestPath, method, requestBody) {
    await this.readyPromise;
    const timestamp = Date.now();
    const date = this._formatLocalDate();
    const logDir = path.join(this.logsDir, date);
    
    // 确保目录存在
    if (!fs.existsSync(logDir)) {
      await fsp.mkdir(logDir, { recursive: true });
    }
    
    // 创建更友好的日志文件名：日期_模型名_请求ID
    const time = this._formatLocalTime();
    const safeModel = (model || 'unknown').replace(/[^a-zA-Z0-9-_]/g, '_');
    const shortId = requestId.replace('chatcmpl-', '').substring(0, 8);
    const logFileName = `${time}_${safeModel}_${shortId}.json`;
    const logFile = path.join(logDir, logFileName);
    
    // 完整的日志数据（存储到文件，无大小限制）
    const fullLog = {
      requestId,
      model,
      connectionId,
      path: requestPath,
      method,
      requestBody, // 完整内容，不截断
      timestamp,
      status: 'processing',
      statusCode: null,
      startTime: timestamp,
      usage: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costUsd: null
    };
    
    // 索引数据（只包含元数据）
    // 优化：存储相对路径，以便在项目目录移动后仍能找到文件
    const relativeLogFile = path.relative(this.logsDir, logFile);
    
    const indexEntry = {
      requestId,
      model,
      connectionId,
      path: requestPath,
      method,
      timestamp,
      status: 'processing',
      statusCode: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      costUsd: null,
      logFile: relativeLogFile, // 存储相对路径
      date
    };
    
    // 保存完整日志到文件
    try {
      await fsp.writeFile(logFile, JSON.stringify(fullLog, null, 2));
    } catch (error) {
      this.logger.error(`保存请求日志失败: ${error.message}`);
    }
    
    // 更新内存索引
    this.logIndex.unshift(indexEntry);
    if (this.logIndex.length > this.maxIndexEntries) {
      this.logIndex.splice(this.maxIndexEntries);
    }
    
    // 提取请求中的图片并更新索引
    this._updateImageIndex(fullLog, 'request');

    // 异步保存索引
    this.saveIndex();
    this.saveImageIndex();
    
    // 更新统计
    this.stats.totalRequests++;
    if (!this.stats.modelStats[model]) {
      this.stats.modelStats[model] = {
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
    this.stats.modelStats[model].total++;
    
    // 异步保存统计
    this.saveStats();
  }

  // 更新连接ID（在请求转发成功后补写）
  async updateRequestConnection(requestId, connectionId) {
    if (!connectionId) return;
    await this.readyPromise;
    const indexEntry = this.logIndex.find(l => l.requestId === requestId);
    if (!indexEntry) return;
    indexEntry.connectionId = connectionId;

    try {
      const resolvedPath = this._resolveLogPath(indexEntry.logFile);
      const logData = await fsp.readFile(resolvedPath, 'utf8');
      const fullLog = JSON.parse(logData);
      fullLog.connectionId = connectionId;
      await fsp.writeFile(resolvedPath, JSON.stringify(fullLog, null, 2));
    } catch (error) {
      this.logger.error(`更新日志连接ID失败: ${error.message}`);
    }

    this.saveIndex();
  }

  // 记录请求结束
  async logRequestEnd(requestId, status, responseTime, responseBody, usageData = null, statusCode = null) {
    await this.readyPromise;
    // 查找索引
    const indexEntry = this.logIndex.find(l => l.requestId === requestId);
    if (!indexEntry) {
      this.logger.warn(`找不到请求索引: ${requestId}`);
      return;
    }
    
    // 读取完整日志
    let fullLog;
    const resolvedPath = this._resolveLogPath(indexEntry.logFile);
    try {
      const logData = await fsp.readFile(resolvedPath, 'utf8');
      fullLog = JSON.parse(logData);
    } catch (error) {
      this.logger.error(`读取日志文件失败: ${error.message}`);
      return;
    }
    
    // 更新日志数据
    const finalStatus = this._normalizeStatus(status, statusCode, responseBody);
    fullLog.status = finalStatus;
    if (statusCode != null) {
      fullLog.statusCode = statusCode;
    } else if (responseBody && (responseBody.status || responseBody.statusCode)) {
      fullLog.statusCode = responseBody.status || responseBody.statusCode;
    }
    fullLog.responseTime = responseTime;
    fullLog.endTime = Date.now();
    fullLog.responseBody = responseBody; // 完整内容，不截断

    const usageResult = this._extractUsageFromResponse(responseBody, usageData);
    if (usageResult) {
      fullLog.usage = usageResult.usage;
      fullLog.promptTokens = usageResult.promptTokens;
      fullLog.completionTokens = usageResult.completionTokens;
      fullLog.totalTokens = usageResult.totalTokens;
      fullLog.costUsd = this._estimateCost(fullLog.model, usageResult.promptTokens, usageResult.completionTokens);
    }
    
    // 保存更新后的日志
    try {
      await fsp.writeFile(resolvedPath, JSON.stringify(fullLog, null, 2));
    } catch (error) {
      this.logger.error(`更新日志文件失败: ${error.message}`);
    }
    
    // 更新索引
    indexEntry.status = finalStatus;
    if (statusCode != null) {
      indexEntry.statusCode = statusCode;
    } else if (responseBody && (responseBody.status || responseBody.statusCode)) {
      indexEntry.statusCode = responseBody.status || responseBody.statusCode;
    }
    indexEntry.responseTime = responseTime;
    indexEntry.endTime = Date.now();
    if (usageResult) {
      indexEntry.promptTokens = usageResult.promptTokens;
      indexEntry.completionTokens = usageResult.completionTokens;
      indexEntry.totalTokens = usageResult.totalTokens;
      indexEntry.costUsd = this._estimateCost(fullLog.model, usageResult.promptTokens, usageResult.completionTokens);
    }
    
    // 提取响应中的图片并更新索引
    this._updateImageIndex(fullLog, 'response');

    // 异步保存索引
    this.saveIndex();
    this.saveImageIndex();
    
    // 更新统计
    if (finalStatus === 'success') {
      this.stats.successRequests++;
      if (fullLog.model && this.stats.modelStats[fullLog.model]) {
        this.stats.modelStats[fullLog.model].success++;
        this.stats.modelStats[fullLog.model].totalTime += responseTime;
      }
    } else {
      this.stats.errorRequests++;
      if (finalStatus === 'rate-limited') {
        this.stats.rateLimitErrors++;
      }
      if (fullLog.model && this.stats.modelStats[fullLog.model]) {
        this.stats.modelStats[fullLog.model].error++;
      }
    }
    
    if (usageResult) {
      const costUsd = this._estimateCost(fullLog.model, usageResult.promptTokens, usageResult.completionTokens);
      this.stats.totalPromptTokens += usageResult.promptTokens;
      this.stats.totalCompletionTokens += usageResult.completionTokens;
      this.stats.totalTokens += usageResult.totalTokens;
      this.stats.totalCostUsd += costUsd;

      if (fullLog.model) {
        if (!this.stats.modelStats[fullLog.model]) {
          this.stats.modelStats[fullLog.model] = {
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
        const modelStats = this.stats.modelStats[fullLog.model];
        modelStats.promptTokens = (modelStats.promptTokens || 0) + usageResult.promptTokens;
        modelStats.completionTokens = (modelStats.completionTokens || 0) + usageResult.completionTokens;
        modelStats.totalTokens = (modelStats.totalTokens || 0) + usageResult.totalTokens;
        modelStats.totalCostUsd = (modelStats.totalCostUsd || 0) + costUsd;
      }
    }

    this.stats.totalResponseTime += responseTime;
    
    // 异步保存统计
    this.saveStats();
  }

  _normalizeStatus(status, statusCode = null, responseBody = null) {
    // 优先根据状态码判断
    if (statusCode === 429) return 'rate-limited';
    if (typeof statusCode === 'number' && statusCode >= 400) return 'error';

    // 如果 responseBody 里有 status/statusCode，也尝试判断
    const bodyStatus = responseBody && (responseBody.statusCode || responseBody.status);
    if (bodyStatus === 429) return 'rate-limited';
    if (typeof bodyStatus === 'number' && bodyStatus >= 400) return 'error';

    // 否则使用传入的状态值
    if (status === 'rate-limited') return 'rate-limited';
    if (status === 'error') return 'error';
    if (status === 'success') return 'success';

    // 默认返回 success
    return 'success';
  }

  // 获取请求日志（从索引返回元数据）
  // 支持 limit / startDate / endDate 过滤；默认不限条数，按时间倒序（索引已按最新在前）
  async getRequestLogs(options = {}) {
    await this.readyPromise;
    let limit = Number.MAX_SAFE_INTEGER;
    let startDate = null;
    let endDate = null;

    if (typeof options === 'number') {
      limit = options;
    } else if (options && typeof options === 'object') {
      if (options.limit != null) limit = Number(options.limit);
      startDate = options.startDate || null;
      endDate = options.endDate || null;
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = Number.MAX_SAFE_INTEGER;
    }

    const filtered = this.logIndex.filter((entry) => {
      const entryDate = this._getEntryDateKey(entry);

      // 如果启用了日期筛选，但条目没有有效日期，则直接过滤掉
      if ((startDate || endDate) && !entryDate) return false;

      if (startDate && entryDate && entryDate < startDate) return false;
      if (endDate && entryDate && entryDate > endDate) return false;
      return true;
    });

    return filtered.slice(0, limit === Number.POSITIVE_INFINITY ? filtered.length : limit);
  }

  // 获取请求详情（从文件读取完整内容）
  async getRequestDetail(requestId) {
    await this.readyPromise;
    const indexEntry = this.logIndex.find(l => l.requestId === requestId);
    if (!indexEntry) {
      // 尝试从更早的日志中查找
      const files = await this.searchLogFile(requestId);
      if (files.length > 0) {
        try {
          const logData = await fsp.readFile(files[0], 'utf8');
          return this._withRecalculatedCost(JSON.parse(logData));
        } catch (error) {
          this.logger.error(`读取日志文件失败: ${error.message}`);
          return null;
        }
      }
      return null;
    }
    
    try {
      const resolvedPath = this._resolveLogPath(indexEntry.logFile);
      const logData = await fsp.readFile(resolvedPath, 'utf8');
      return this._withRecalculatedCost(JSON.parse(logData));
    } catch (error) {
      this.logger.error(`读取日志文件失败: ${error.message}`);
      return null;
    }
  }

  _withRecalculatedCost(log) {
    if (!log || typeof log !== 'object') return log;

    const promptTokens = this._toNumber(log.promptTokens ?? log.usage?.prompt_tokens) ?? 0;
    const completionTokens = this._toNumber(log.completionTokens ?? log.usage?.completion_tokens) ?? 0;
    if (!promptTokens && !completionTokens) return log;

    log.costUsd = this._estimateCost(log.model, promptTokens, completionTokens);
    return log;
  }
  
  // 搜索日志文件
  async searchLogFile(requestId) {
    await this.readyPromise;
    const results = [];
    try {
      const dates = await fsp.readdir(this.logsDir);
      for (const date of dates) {
        if (date.endsWith('.json')) continue; // 跳过索引文件
        const dateDir = path.join(this.logsDir, date);
        // 搜索匹配的文件（文件名包含请求ID的一部分）
        if (fs.existsSync(dateDir)) {
          const files = fs.readdirSync(dateDir);
          const shortId = requestId.replace('chatcmpl-', '').substring(0, 8);
          const matchingFiles = files.filter(f => f.includes(shortId));
          matchingFiles.forEach(f => {
            results.push(path.join(dateDir, f));
          });
        }
      }
    } catch (error) {
      this.logger.error(`搜索日志文件失败: ${error.message}`);
    }
    return results;
  }

  // 获取统计数据
  async getStats() {
    await this.readyPromise;
    const avgResponseTime = this.stats.successRequests > 0
      ? Math.round(this.stats.totalResponseTime / this.stats.successRequests)
      : 0;
    
    const successRate = this.stats.totalRequests > 0
      ? Math.round((this.stats.successRequests / this.stats.totalRequests) * 100)
      : 0;
    const periodUsage = this._calculatePeriodUsage();

    return {
      totalRequests: this.stats.totalRequests,
      successRequests: this.stats.successRequests,
      errorRequests: this.stats.errorRequests,
      rateLimitErrors: this.stats.rateLimitErrors,
      totalPromptTokens: this.stats.totalPromptTokens,
      totalCompletionTokens: this.stats.totalCompletionTokens,
      totalTokens: this.stats.totalTokens,
      totalCostUsd: +this.stats.totalCostUsd.toFixed(6),
      avgResponseTime,
      successRate,
      modelStats: this.stats.modelStats,
      periodUsage,
      uptime: Date.now() - this.stats.startTime
    };
  }

  // 清空日志
  async clearLogs() {
    await this.readyPromise;
    try {
      // 清空内存索引
      this.logIndex = [];
      await this.saveIndex();
      
      // 重置统计（但保留启动时间）
      this.stats = {
        totalRequests: 0,
        successRequests: 0,
        errorRequests: 0,
        rateLimitErrors: 0,
        totalResponseTime: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        modelStats: {},
        startTime: this.stats.startTime
      };
      await this.saveStats();
      
      // 可选：清理旧的日志文件
      const dates = await fsp.readdir(this.logsDir);
      for (const date of dates) {
        if (date.endsWith('.json')) continue;
        const dateDir = path.join(this.logsDir, date);
        const files = await fsp.readdir(dateDir);
        for (const file of files) {
          await fsp.unlink(path.join(dateDir, file));
        }
      }
      
      this.logger.info('请求日志已清空');
    } catch (error) {
      this.logger.error(`清空日志失败: ${error.message}`);
    }
  }
  
  // 导出日志（用于备份）
  async exportLogs(startDate, endDate) {
    await this.readyPromise;
    const logs = [];
    try {
      const dates = await fsp.readdir(this.logsDir);
      for (const date of dates) {
        if (date.endsWith('.json')) continue;
        if (startDate && date < startDate) continue;
        if (endDate && date > endDate) continue;
        
        const dateDir = path.join(this.logsDir, date);
        const files = await fsp.readdir(dateDir);
        for (const file of files) {
          const logData = await fsp.readFile(path.join(dateDir, file), 'utf8');
          logs.push(JSON.parse(logData));
        }
      }
    } catch (error) {
      this.logger.error(`导出日志失败: ${error.message}`);
    }
    return logs;
  }

  // 获取图片列表（基于索引分页）
  async getGalleryImages(page = 1, pageSize = 20, type = 'all', startDate = null, endDate = null, search = null) {
    await this.readyPromise;
    
    let filtered = this.imageIndex;
    
    // 类型筛选
    if (type !== 'all') {
      filtered = filtered.filter(img => img.type === type);
    }

    // 日期筛选
    if (startDate || endDate) {
      filtered = filtered.filter(img => {
        const dateKey = this._formatLocalDate(new Date(img.timestamp));
        if (startDate && dateKey < startDate) return false;
        if (endDate && dateKey > endDate) return false;
        return true;
      });
    }

    // 搜索筛选
    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter(img => {
        const requestId = (img.requestId || '').toLowerCase();
        const model = (img.model || '').toLowerCase();
        return requestId.includes(lowerSearch) || model.includes(lowerSearch);
      });
    }
    
    // 按时间倒序
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = filtered.slice(start, end);
    
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  // 获取单张图片数据
  async getImageData(requestId, type, index) {
    await this.readyPromise;
    const imgMeta = this.imageIndex.find(img =>
      img.requestId === requestId && img.type === type && img.index === Number(index)
    );
    
    if (!imgMeta) return null;
    
    // 查找对应的日志文件
    const logEntry = this.logIndex.find(l => l.requestId === requestId);
    if (!logEntry) return null;
    
    try {
      const resolvedPath = this._resolveLogPath(logEntry.logFile);
      if (!fs.existsSync(resolvedPath)) return null;
      
      const logData = await fsp.readFile(resolvedPath, 'utf8');
      const log = JSON.parse(logData);
      
      const body = type === 'request' ? log.requestBody : log.responseBody;
      const images = [];
      this._extractImagesFromPayload(body, log, type, images, true); // true = extract data
      
      const targetImg = images.find(img => img.index === Number(index));
      return targetImg ? targetImg.src : null;
    } catch (e) {
      this.logger.error(`获取图片数据失败: ${e.message}`);
      return null;
    }
  }

  // 重建图片索引
  async rebuildImageIndex() {
    await this.readyPromise;
    this.logger.info('开始重建图片索引...');
    this.imageIndex = [];
    let count = 0;
    
    for (const entry of this.logIndex) {
      try {
        const resolvedPath = this._resolveLogPath(entry.logFile);
        if (!fs.existsSync(resolvedPath)) continue;
        
        const logData = await fsp.readFile(resolvedPath, 'utf8');
        const log = JSON.parse(logData);
        
        this._updateImageIndex(log, 'request');
        this._updateImageIndex(log, 'response');
        count++;
        
        if (count % 100 === 0) {
           // 避免阻塞事件循环
           await new Promise(resolve => setTimeout(resolve, 0));
        }
      } catch (e) {
        // ignore error
      }
    }
    
    await this.saveImageIndex();
    this.logger.success(`图片索引重建完成，共索引 ${this.imageIndex.length} 张图片`);
    return this.imageIndex.length;
  }

  _updateImageIndex(log, type) {
    const body = type === 'request' ? log.requestBody : log.responseBody;
    const images = [];
    this._extractImagesFromPayload(body, log, type, images, false); // false = metadata only
    
    if (images.length > 0) {
      // 检查是否已存在（避免重复）
      const existingIds = new Set(this.imageIndex.map(i => `${i.requestId}_${i.type}_${i.index}`));
      
      images.forEach(img => {
        const key = `${img.requestId}_${img.type}_${img.index}`;
        if (!existingIds.has(key)) {
          this.imageIndex.push(img);
        }
      });
    }
  }

  _extractImagesFromPayload(body, log, type, images, includeData = false) {
    if (!body) return;

    // 尝试解析字符串格式的 body
    if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed === 'object') {
          body = parsed;
        }
      } catch (e) {
        // ignore
      }
    }

    let imgIndex = 0;

    const addImage = (src, mimeType) => {
      const isDataUrl = src.startsWith('data:');
      const meta = {
        requestId: log.requestId,
        timestamp: log.timestamp,
        model: log.model,
        type: type,
        index: imgIndex++,
        mimeType: mimeType || 'image/unknown'
      };
      
      if (includeData) {
        meta.src = src;
      } else {
        // 如果是 data URL，只存元数据，不存内容
        // 如果是 http URL，存 URL
        if (!isDataUrl) {
            meta.url = src;
        }
      }
      images.push(meta);
    };

    // 1. Handle Gemini inlineData
    if (typeof body === 'object') {
      // Handle standard JSON body
      const contents = body.contents || (body.candidates && body.candidates[0]?.content ? [body.candidates[0].content] : []);
      if (Array.isArray(contents)) {
        contents.forEach(content => {
          if (Array.isArray(content.parts)) {
            content.parts.forEach(part => {
              if (part.inlineData) {
                const mime = part.inlineData.mimeType || 'image/png';
                const data = part.inlineData.data;
                addImage(`data:${mime};base64,${data}`, mime);
              }
            });
          }
        });
      }

      // Handle rawSse (for streamed responses)
      if (Array.isArray(body.rawSse)) {
        body.rawSse.forEach(line => {
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
              parts.forEach(part => {
                if (part.inlineData) {
                  const mime = part.inlineData.mimeType || 'image/png';
                  const data = part.inlineData.data;
                  addImage(`data:${mime};base64,${data}`, mime);
                }
              });
            }
          } catch {
            // ignore parse errors
          }
        });
      }
      
      // 2. Handle OpenAI image_url
      if (Array.isArray(body.messages)) {
        body.messages.forEach(msg => {
          if (Array.isArray(msg.content)) {
            msg.content.forEach(part => {
              if (part.type === 'image_url' && part.image_url?.url) {
                addImage(part.image_url.url, 'image/unknown');
              }
            });
          }
        });
      }
    }

    // 3. Handle Markdown images in text
    let textContent = '';
    if (typeof body === 'string') {
      textContent = body;
    } else {
      if (body.candidates && body.candidates[0]?.content?.parts) {
         textContent = body.candidates[0].content.parts.map(p => p.text || '').join('\n');
      } else if (body.choices && body.choices[0]?.message?.content) {
         textContent = body.choices[0].message.content;
      } else {
         try { textContent = JSON.stringify(body); } catch {}
      }
    }

    const markdownImageRegex = /!\[.*?\]\((.*?)\)/g;
    let match;
    while ((match = markdownImageRegex.exec(textContent)) !== null) {
      const src = match[1];
      if (src && (src.startsWith('data:image') || src.startsWith('http'))) {
        addImage(src, 'image/unknown');
      }
    }
  }
}

class ProxyServerSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      httpPort: 8889,
      wsPort: 9998,
      host: '0.0.0.0',
      systemMessageStrategy: 'merge-first-parts', // 'none' | 'merge-first' | 'merge-first-parts' | 'convert-all-to-user'
      systemMessageLabelPrefix: false,
      enablePseudoStreamModels: true, // 是否在模型列表中显示伪流版模型
      fakeStreaming: {
        enabled: false,
        chunkSize: 10,
        delay: 15
      },
      ...config
    };

    this.logger = new LoggingService('ProxyServer');
    this.connectionRegistry = new ConnectionRegistry(this.logger);
    this.requestHandler = new RequestHandler(this, this.connectionRegistry, this.logger);
    this.requestMonitor = new RequestMonitor(this.logger);

    this.httpServer = null;
    this.wsServer = null;
    this.statsInterval = null;
  }

  async _ensurePortAvailable(port, host, label = 'server') {
    const tryListen = () => new Promise((resolve, reject) => {
      const tester = http.createServer();

      tester.once('error', (err) => {
        if (err.code !== 'EADDRINUSE') {
          return reject(err);
        }

        this.logger.warn(`Port ${port} is in use for ${label}, attempting to free it automatically...`);
        this._freePort(port)
          .then(() => {
            const retryServer = http.createServer();
            retryServer.once('error', (retryErr) => {
              retryServer.close();
              reject(retryErr);
            });
            retryServer.once('listening', () => {
              retryServer.close(() => {
                this.logger.info(`Port ${port} is now available.`);
                resolve();
              });
            });
            retryServer.listen(port, host);
          })
          .catch(reject);
      });

      tester.once('listening', () => {
        tester.close(() => resolve());
      });

      tester.listen(port, host);
    });

    await tryListen();
  }

  async _freePort(port) {
    const platform = process.platform;
    const command = platform === 'win32'
      ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`
      : `bash -c "pids=\\$(lsof -ti tcp:${port} 2>/dev/null); if [ -n \\"\\$pids\\" ]; then kill -9 $pids; fi"`;

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        const output = stdout ? stdout.trim() : '';
        const errorText = stderr ? stderr.trim() : '';

        if (error) {
          // On Windows, no match may still produce a non-zero exit code. Treat it as a soft warning.
          if (!output && !errorText) {
            this.logger.warn(`Cleanup command could not find a process for port ${port}; continuing.`);
            return resolve();
          }

          this.logger.error(`Failed to free port ${port}: ${errorText || error.message}`);
          return reject(new Error(`Unable to free port ${port}`));
        }

        if (output.length > 0) {
          this.logger.info(`Terminated processes on port ${port}: ${output}`);
        } else {
          this.logger.warn(`Port ${port} was in use but no owning process was found by the cleanup command.`);
        }
        resolve();
      });
    });
  }

  printBanner() {
    const c = this.logger.colors;
    
    // Gemini 品牌色渐变 (更鲜艳的蓝紫渐变)
    const startColor = { r: 0, g: 198, b: 255 };   // Deep Sky Blue
    const endColor = { r: 140, g: 20, b: 252 };    // Electric Purple
    
    const bannerText = `
   ______               _       _   ____
  / ____/___   ____ ___(_)___  (_) / __ \\_________  _  __  __
 / / __/ _ \\ / __ \`__ \\ / __ \\/ / / /_/ / ___/ __ \\| |/_/ / / /
/ /_/ /  __// / / / / / / / / / / ____/ /  / /_/ />  < / /_/ /
\\____/\\___//_/ /_/ /_/_/ /_/_/_/_/   /_/   \\____/_/|_| \\__, /
                                                      /____/
`;
    
    console.log('\n');
    console.log(this.logger.gradient(bannerText, startColor, endColor));
    
    const title = "GEMINI PROXY SERVER";
    const version = " V4.0 PREVIEW ";
    const subTitle = "Google AI Studio High-Performance Gateway";
    
    // 使用双线分隔符，更具科技感
    const separator = `${c.fg.gray}══════════════════════════════════════════════════════════${c.reset}`;
    
    console.log(`   ${this.logger.gradient("◈ " + title + " ◈", {r:255,g:220,b:0}, {r:255,g:100,b:0})}   ${c.bg.magenta}${c.fg.white}${c.bright}${version}${c.reset}`);
    console.log(`   ${c.fg.cyan}${subTitle}${c.reset}`);
    console.log(`   ${separator}\n`);
  }

  async start() {
    try {
      this.printBanner();
      await this.requestMonitor.readyPromise;
      // 初始化连接池
      await this.connectionRegistry.initialize();
      await this._ensurePortAvailable(this.config.httpPort, this.config.host, 'HTTP');
      await this._ensurePortAvailable(this.config.wsPort, this.config.host, 'WebSocket');
      await this._startHttpServer();
      await this._startWebSocketServer();
      this._startStatsReporting();

      this.logger.success(`代理服务器系统启动完成（连接池模式）。`);
      
      const c = this.logger.colors;
      const icons = this.logger.icons;
      const host = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host;
      const port = this.config.httpPort;
      
      console.log('');
      console.log(`${c.fg.gray}┌──────────────────────────────────────────────────────────┐${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}  ${c.fg.green}🚀 服务已就绪 (Service Ready)${c.reset}                           ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}├──────────────────────────────────────────────────────────┤${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}  ${icons.network} ${c.bright}API 接口地址 (API Endpoint):${c.reset}                        ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}  ${c.fg.cyan}http://${host}:${port}/v1/chat/completions${c.reset}          ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}                                                          ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}  ${icons.chart} ${c.bright}监控面板 (Monitor Dashboard):${c.reset}                       ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}│${c.reset}  ${c.fg.cyan}${c.underscore}http://${host}:${port}/monitor${c.reset}                       ${c.fg.gray}│${c.reset}`);
      console.log(`${c.fg.gray}└──────────────────────────────────────────────────────────┘${c.reset}`);
      console.log('');

      this.emit('started');
    } catch (error) {
      this.logger.error(`启动失败: ${error.message}`);
      this.emit('error', error);
      throw error;
    }
  }

  async _startHttpServer() {
    const app = this._createExpressApp();
    this.httpServer = http.createServer(app);

    return new Promise((resolve) => {
      this.httpServer.listen(this.config.httpPort, this.config.host, () => {
        const c = this.logger.colors;
        this.logger.success(`HTTP服务器启动: ${c.underscore}http://${this.config.host}:${this.config.httpPort}${c.reset}`);
        resolve();
      });
    });
  }

  _createExpressApp() {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '100mb' }));

    // 静态文件服务 - 修改为从外部目录读取
    app.use('/public', express.static(path.join(process.cwd(), 'public')));

    // 监控页面 - 修改为从外部目录读取
    app.get('/monitor', (req, res) => {
      // 使用process.cwd()而不是__dirname，从EXE运行目录读取
      const monitorPath = path.join(process.cwd(), 'public', 'monitor.html');
      // 先检查文件是否存在
      if (fs.existsSync(monitorPath)) {
        res.sendFile(monitorPath);
      } else {
        res.status(404).send('监控面板文件未找到，请确保public/monitor.html文件存在于EXE运行目录');
      }
    });

    // 实时日志流 (SSE)
    app.get('/monitor/logs', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      const sendLog = (log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      };

      this.logger.addListener(sendLog);

      // 发送初始连接消息
      sendLog({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        service: 'System',
        message: 'Log stream connected.'
      });

      req.on('close', () => {
        this.logger.removeListener(sendLog);
      });
    });

    // 连接池状态端点
    app.get('/pool-stats', (req, res) => {
      const stats = this.connectionRegistry.getPoolStats();
      res.json(stats);
    });

    // 请求日志端点
    app.get('/request-logs', async (req, res) => {
      const limit = req.query.limit != null ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER;
      const startDate = req.query.startDate || null;
      const endDate = req.query.endDate || null;
      const logs = await this.requestMonitor.getRequestLogs({ limit, startDate, endDate });
      res.json(logs);
    });

    // 请求统计端点
    app.get('/request-stats', async (req, res) => {
      const stats = await this.requestMonitor.getStats();
      res.json(stats);
    });

    // 清空日志端点
    app.post('/clear-logs', async (req, res) => {
      await this.requestMonitor.clearLogs();
      res.json({ success: true });
    });
    
    // 获取请求详情端点
    app.get('/request-detail/:requestId', async (req, res) => {
      const requestId = req.params.requestId;
      const log = await this.requestMonitor.getRequestDetail(requestId);
      if (log) {
        res.json(log);
      } else {
        res.status(404).json({ error: 'Request not found' });
      }
    });
    
    // 导出日志端点（用于备份）
    app.get('/export-logs', async (req, res) => {
      const { startDate, endDate } = req.query;
      const logs = await this.requestMonitor.exportLogs(startDate, endDate);
      res.json(logs);
    });

    // 获取图片库数据 (分页)
    app.get('/gallery-images', async (req, res) => {
      try {
        const page = req.query.page ? Number(req.query.page) : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 20;
        const type = req.query.type || 'all';
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;
        const search = req.query.search || null;
        
        const result = await this.requestMonitor.getGalleryImages(page, pageSize, type, startDate, endDate, search);
        res.json(result);
      } catch (error) {
        this.logger.error(`获取图片库数据失败: ${error.message}`);
        res.status(500).json({ error: 'Failed to fetch gallery images' });
      }
    });

    // 获取单张图片内容
    app.get('/gallery-image/:requestId/:type/:index', async (req, res) => {
      try {
        const { requestId, type, index } = req.params;
        const imageData = await this.requestMonitor.getImageData(requestId, type, index);
        
        if (!imageData) {
          return res.status(404).send('Image not found');
        }

        if (imageData.startsWith('data:')) {
          // Data URL: extract mime and buffer
          const matches = imageData.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
            res.send(buffer);
          } else {
            res.status(400).send('Invalid image data');
          }
        } else if (imageData.startsWith('http')) {
          // External URL: redirect
          res.redirect(imageData);
        } else {
          res.status(400).send('Unknown image format');
        }
      } catch (error) {
        this.logger.error(`获取图片内容失败: ${error.message}`);
        res.status(500).send('Internal Server Error');
      }
    });

    // 重建图片索引
    app.post('/rebuild-image-index', async (req, res) => {
      try {
        const count = await this.requestMonitor.rebuildImageIndex();
        res.json({ success: true, count });
      } catch (error) {
        this.logger.error(`重建图片索引失败: ${error.message}`);
        res.status(500).json({ error: 'Failed to rebuild index' });
      }
    });
    
    // 获取连接详情端点
    app.get('/connection-details', (req, res) => {
      const details = this.connectionRegistry.getConnectionDetails();
      res.json(details);
    });

    // 清除冷却状态
    app.post('/clear-cooldown', (req, res) => {
      const { connectionId, model = 'all' } = req.body;
      const success = this.connectionRegistry.clearCooldown(connectionId, model);
      res.json({ success });
    });
    
    // 切换连接状态端点
    app.post('/toggle-connection', (req, res) => {
      const { connectionId, enable } = req.body;
      const success = this.connectionRegistry.toggleConnection(connectionId, enable);
      res.json({ success });
    });

    // 获取代理网页链接
    app.get('/get-proxy-url', async (req, res) => {
      try {
        const configPath = path.join(process.cwd(), 'proxy-config.txt');
        if (fs.existsSync(configPath)) {
          const content = await fsp.readFile(configPath, 'utf8');
          // Extract the first line that looks like a URL, ignoring comments
          const lines = content.split('\n');
          let url = '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              url = trimmed;
              break;
            }
          }
          res.json({ url });
        } else {
          res.json({ url: '' });
        }
      } catch (error) {
        this.logger.error(`Failed to read proxy config: ${error.message}`);
        res.status(500).json({ error: 'Failed to read config' });
      }
    });

    // 获取服务器配置
    app.get('/get-config', (req, res) => {
      res.json({
        systemMessageStrategy: this.config.systemMessageStrategy,
        systemMessageLabelPrefix: this.config.systemMessageLabelPrefix,
        excludeBase64InLogs: this.config.excludeBase64InLogs,
        enablePseudoStreamModels: this.config.enablePseudoStreamModels,
        fakeStreaming: this.config.fakeStreaming
      });
    });

    // 获取额度池总览
    app.get('/quota-overview', (req, res) => {
        // 获取当前活跃的连接ID列表
        const activeConnectionIds = Array.from(this.connectionRegistry.pool.connections.values())
            .filter(c => c.status === 'active' && c.ws && c.ws.readyState === WebSocket.OPEN)
            .map(c => c.id);

        const overview = this.connectionRegistry.pool.quotaManager.getPoolOverview(activeConnectionIds);
        const nextReset = this.connectionRegistry.pool.quotaManager.getNextResetTime();
        const config = this.connectionRegistry.pool.quotaManager.config;
        res.json({
            overview,
            config, // 暴露配置信息，包含模型列表
            nextResetTime: nextReset,
            serverTime: Date.now()
        });
    });

    // 更新服务器配置
    app.post('/update-config', (req, res) => {
      const { systemMessageStrategy, systemMessageLabelPrefix, excludeBase64InLogs, enablePseudoStreamModels, fakeStreaming } = req.body;
      const allowedStrategies = ['none', 'merge-first', 'merge-first-parts', 'convert-all-to-user', 'merge-all', 'extract-all'];
      let updated = false;

      if (systemMessageStrategy && allowedStrategies.includes(systemMessageStrategy)) {
        this.config.systemMessageStrategy = systemMessageStrategy;
        this.logger.info(`System message strategy updated to: ${systemMessageStrategy}`);
        updated = true;
      }

      if (typeof systemMessageLabelPrefix === 'boolean') {
        this.config.systemMessageLabelPrefix = systemMessageLabelPrefix;
        this.logger.info(`System message label prefix updated to: ${systemMessageLabelPrefix}`);
        updated = true;
      }

      if (typeof excludeBase64InLogs === 'boolean') {
        this.config.excludeBase64InLogs = excludeBase64InLogs;
        this.logger.info(`Exclude Base64 in logs updated to: ${excludeBase64InLogs}`);
        updated = true;
      }

      if (typeof enablePseudoStreamModels === 'boolean') {
        this.config.enablePseudoStreamModels = enablePseudoStreamModels;
        this.logger.info(`Enable Pseudo Stream Models updated to: ${enablePseudoStreamModels}`);
        updated = true;
      }

      if (fakeStreaming && typeof fakeStreaming === 'object') {
        this.config.fakeStreaming = {
          enabled: !!fakeStreaming.enabled,
          chunkSize: Number(fakeStreaming.chunkSize) || 25,
          delay: Number(fakeStreaming.delay) || 2
        };
        this.logger.info(`Fake streaming config updated: enabled=${this.config.fakeStreaming.enabled}, chunk=${this.config.fakeStreaming.chunkSize}, delay=${this.config.fakeStreaming.delay}`);
        updated = true;
      }

      if (updated) {
        res.json({ success: true, message: 'Configuration updated.' });
      } else {
        res.status(400).json({ success: false, message: 'Invalid configuration value.' });
      }
    });

    // 其他所有请求
    app.all(/(.*)/, (req, res) => {
      this.requestHandler.processRequest(req, res);
    });

    return app;
  }

  async _startWebSocketServer() {
    this.wsServer = new WebSocket.Server({
      port: this.config.wsPort,
      host: this.config.host
    });

    this.wsServer.on('connection', (ws, req) => {
      this.connectionRegistry.addConnection(ws, {
        address: req.socket.remoteAddress
      });
    });

    const c = this.logger.colors;
    this.logger.success(`WebSocket服务器启动: ${c.underscore}ws://${this.config.host}:${this.config.wsPort}${c.reset}`);
  }

  _startStatsReporting() {
    // 改为每5分钟报告一次连接池状态，减少日志输出
    this.statsInterval = setInterval(() => {
      const stats = this.connectionRegistry.getPoolStats();
      // 只在有实际活动时报告状态
      if (stats.totalRequests > 0 || stats.active > 0) {
        const c = this.logger.colors;
        this.logger.info(`[连接池状态汇总] 活跃连接: ${c.fg.green}${stats.active}${c.reset}, 总处理请求: ${c.fg.cyan}${stats.totalRequests}${c.reset}`);
      }
    }, 300000); // 5分钟
  }

  async shutdown() {
    const icons = this.logger.icons || {};
    this.logger.info(`${icons.warn || ''} 正在关闭服务器...`);
    
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
    }
    
    if (this.connectionRegistry) {
      this.connectionRegistry.shutdown();
    }
    
    if (this.wsServer) {
      this.wsServer.close();
    }
    
    if (this.httpServer) {
      this.httpServer.close();
    }
    
    this.logger.info(`${icons.lock || ''} 服务器已关闭`);
  }
}

async function initializeServer() {
  const serverSystem = new ProxyServerSystem();
  
  // 优雅关闭
  process.on('SIGINT', async () => {
    const c = serverSystem.logger.colors;
    console.log(`\n${c.fg.yellow}收到SIGINT信号，正在优雅关闭...${c.reset}`);
    await serverSystem.shutdown();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    const c = serverSystem.logger.colors;
    console.log(`\n${c.fg.yellow}收到SIGTERM信号，正在优雅关闭...${c.reset}`);
    await serverSystem.shutdown();
    process.exit(0);
  });
  
  await serverSystem.start();
}

if (require.main === module) {
  initializeServer();
}

module.exports = { ProxyServerSystem };
