// ==========================================
// 🧠 项目级记忆管理系统
// ==========================================
// 支持按域名存储选择器、任务模板、页面签名
// 自动过期清理，智能匹配相似域名

const MEMORY_STORAGE_KEY = 'projectMemory';
const MEMORY_VERSION = 1;
const MAX_AGE_DAYS = 30;
const MAX_SELECTORS_PER_DOMAIN = 100;
const MAX_TEMPLATES_PER_DOMAIN = 20;

/**
 * 从 URL 提取域名
 * @param {string} url 
 * @returns {string}
 */
function extractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname;
    } catch {
        return 'unknown';
    }
}

/**
 * 从 URL 提取路径模式（用于页面签名）
 * @param {string} url 
 * @returns {string}
 */
function extractPathPattern(url) {
    try {
        const u = new URL(url);
        // 将动态部分替换为占位符 /user/123 -> /user/:id
        return u.pathname.replace(/\/\d+/g, '/:id').replace(/\/[a-f0-9]{24,}/gi, '/:hash');
    } catch {
        return '/';
    }
}

/**
 * 获取完整的记忆存储
 * @returns {Promise<Object>}
 */
async function getMemoryStore() {
    const data = await chrome.storage.local.get(MEMORY_STORAGE_KEY);
    const store = data[MEMORY_STORAGE_KEY] || { version: MEMORY_VERSION, domains: {} };
    
    // 迁移检查
    if (!store.version || store.version < MEMORY_VERSION) {
        store.version = MEMORY_VERSION;
    }
    
    return store;
}

/**
 * 保存完整的记忆存储
 * @param {Object} store 
 */
async function saveMemoryStore(store) {
    await chrome.storage.local.set({ [MEMORY_STORAGE_KEY]: store });
}

/**
 * 获取某个域名的记忆
 * @param {string} domain 
 * @returns {Promise<Object>}
 */
async function getProjectMemory(domain) {
    const store = await getMemoryStore();
    
    if (!store.domains[domain]) {
        store.domains[domain] = {
            selectorPatterns: {},
            taskTemplates: {},
            pageSignatures: {},
            createdAt: Date.now(),
            lastAccessed: Date.now()
        };
        await saveMemoryStore(store);
    }
    
    // 更新访问时间
    store.domains[domain].lastAccessed = Date.now();
    await saveMemoryStore(store);
    
    return store.domains[domain];
}

/**
 * 保存选择器及其结果
 * @param {string} url - 当前页面 URL
 * @param {string} name - 选择器名称（如 "login_button"）
 * @param {string} selector - CSS 选择器
 * @param {boolean} success - 是否成功
 * @param {Object} options - 额外选项
 */
async function saveSelector(url, name, selector, success, options = {}) {
    const domain = extractDomain(url);
    const store = await getMemoryStore();
    
    if (!store.domains[domain]) {
        store.domains[domain] = {
            selectorPatterns: {},
            taskTemplates: {},
            pageSignatures: {},
            createdAt: Date.now(),
            lastAccessed: Date.now()
        };
    }
    
    const patterns = store.domains[domain].selectorPatterns;
    
    if (!patterns[name]) {
        patterns[name] = {
            selector: selector,
            confidence: success ? 0.6 : 0.3,
            successCount: success ? 1 : 0,
            failCount: success ? 0 : 1,
            lastSuccess: success ? Date.now() : null,
            lastUsed: Date.now(),
            fallbacks: [],
            context: options.context || {} // 页面路径、元素类型等
        };
    } else {
        const pattern = patterns[name];
        
        if (success) {
            pattern.successCount++;
            pattern.lastSuccess = Date.now();
            
            // 如果是新的选择器且成功了，可能要替换
            if (selector !== pattern.selector) {
                // 将旧的存入 fallbacks
                if (!pattern.fallbacks.includes(pattern.selector)) {
                    pattern.fallbacks.unshift(pattern.selector);
                    pattern.fallbacks = pattern.fallbacks.slice(0, 5); // 最多保留 5 个
                }
                pattern.selector = selector;
            }
        } else {
            pattern.failCount++;
            
            // 如果失败了，尝试降级 fallback
            if (selector === pattern.selector && pattern.fallbacks.length > 0) {
                pattern.fallbacks.unshift(pattern.selector);
                pattern.selector = pattern.fallbacks.pop();
            }
        }
        
        // 更新信心度
        const total = pattern.successCount + pattern.failCount;
        pattern.confidence = Math.min(0.99, pattern.successCount / total);
        pattern.lastUsed = Date.now();
    }
    
    // 限制选择器数量
    const keys = Object.keys(patterns);
    if (keys.length > MAX_SELECTORS_PER_DOMAIN) {
        // 删除最旧的
        const sorted = keys.sort((a, b) => patterns[a].lastUsed - patterns[b].lastUsed);
        const toDelete = sorted.slice(0, keys.length - MAX_SELECTORS_PER_DOMAIN);
        toDelete.forEach(k => delete patterns[k]);
    }
    
    store.domains[domain].lastAccessed = Date.now();
    await saveMemoryStore(store);
}

/**
 * 获取选择器（带 fallback）
 * @param {string} url 
 * @param {string} name 
 * @returns {Promise<Object|null>}
 */
async function getSelector(url, name) {
    const domain = extractDomain(url);
    const memory = await getProjectMemory(domain);
    
    if (memory.selectorPatterns[name]) {
        const pattern = memory.selectorPatterns[name];
        return {
            selector: pattern.selector,
            confidence: pattern.confidence,
            fallbacks: pattern.fallbacks || [],
            lastSuccess: pattern.lastSuccess
        };
    }
    
    return null;
}

/**
 * 保存任务模板
 * @param {string} url 
 * @param {string} intent - 任务意图（如 "登录"）
 * @param {Object} task - 完整的任务对象
 */
async function saveTaskTemplate(url, intent, task) {
    const domain = extractDomain(url);
    const store = await getMemoryStore();
    
    if (!store.domains[domain]) {
        store.domains[domain] = {
            selectorPatterns: {},
            taskTemplates: {},
            pageSignatures: {},
            createdAt: Date.now(),
            lastAccessed: Date.now()
        };
    }
    
    const templates = store.domains[domain].taskTemplates;
    
    // 标准化 intent
    const normalizedIntent = normalizeIntent(intent);
    
    templates[normalizedIntent] = {
        task: task,
        successCount: 1,
        failCount: 0,
        lastUsed: Date.now(),
        createdAt: Date.now()
    };
    
    // 限制模板数量
    const keys = Object.keys(templates);
    if (keys.length > MAX_TEMPLATES_PER_DOMAIN) {
        const sorted = keys.sort((a, b) => templates[a].lastUsed - templates[b].lastUsed);
        const toDelete = sorted.slice(0, keys.length - MAX_TEMPLATES_PER_DOMAIN);
        toDelete.forEach(k => delete templates[k]);
    }
    
    store.domains[domain].lastAccessed = Date.now();
    await saveMemoryStore(store);
}

/**
 * 根据意图匹配历史任务模板
 * @param {string} url 
 * @param {string} intent 
 * @returns {Promise<Object|null>}
 */
async function getTaskTemplate(url, intent) {
    const domain = extractDomain(url);
    const memory = await getProjectMemory(domain);
    
    const normalizedIntent = normalizeIntent(intent);
    const templates = memory.taskTemplates;
    
    // 精确匹配
    if (templates[normalizedIntent]) {
        const template = templates[normalizedIntent];
        template.lastUsed = Date.now();
        await saveMemoryStore(await getMemoryStore());
        return template.task;
    }
    
    // 模糊匹配（关键词）
    const keywords = normalizedIntent.split(/\s+/);
    for (const [key, value] of Object.entries(templates)) {
        const keyKeywords = key.split(/\s+/);
        const overlap = keywords.filter(k => keyKeywords.includes(k));
        if (overlap.length >= Math.min(2, keywords.length)) {
            value.lastUsed = Date.now();
            await saveMemoryStore(await getMemoryStore());
            return value.task;
        }
    }
    
    return null;
}

/**
 * 更新选择器信心度
 * @param {string} url 
 * @param {string} name 
 * @param {boolean} success 
 */
async function updateSelectorConfidence(url, name, success) {
    await saveSelector(url, name, null, success);
}

/**
 * 标准化意图字符串
 * @param {string} intent 
 * @returns {string}
 */
function normalizeIntent(intent) {
    return intent
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\s]/g, '') // 保留中英文和空格
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 清理过期记忆
 * @returns {Promise<number>} 清理的域名数量
 */
async function cleanupExpiredMemory() {
    const store = await getMemoryStore();
    const now = Date.now();
    const maxAge = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    
    let cleanedCount = 0;
    
    for (const [domain, memory] of Object.entries(store.domains)) {
        if (now - memory.lastAccessed > maxAge) {
            delete store.domains[domain];
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        await saveMemoryStore(store);
    }
    
    return cleanedCount;
}

/**
 * 获取记忆统计
 * @returns {Promise<Object>}
 */
async function getMemoryStats() {
    const store = await getMemoryStore();
    
    const stats = {
        totalDomains: Object.keys(store.domains).length,
        totalSelectors: 0,
        totalTemplates: 0,
        domains: []
    };
    
    for (const [domain, memory] of Object.entries(store.domains)) {
        const selectorCount = Object.keys(memory.selectorPatterns).length;
        const templateCount = Object.keys(memory.taskTemplates).length;
        
        stats.totalSelectors += selectorCount;
        stats.totalTemplates += templateCount;
        
        stats.domains.push({
            domain,
            selectors: selectorCount,
            templates: templateCount,
            lastAccessed: memory.lastAccessed
        });
    }
    
    // 按最近访问排序
    stats.domains.sort((a, b) => b.lastAccessed - a.lastAccessed);
    
    return stats;
}

/**
 * 导出所有记忆
 * @returns {Promise<Object>}
 */
async function exportMemory() {
    const store = await getMemoryStore();
    return {
        version: store.version,
        exportedAt: Date.now(),
        domains: store.domains
    };
}

/**
 * 导入记忆
 * @param {Object} data 
 * @param {boolean} merge - 是否合并（false = 覆盖）
 */
async function importMemory(data, merge = true) {
    if (!data || !data.domains) {
        throw new Error('Invalid memory data');
    }
    
    const store = await getMemoryStore();
    
    if (merge) {
        // 合并
        for (const [domain, memory] of Object.entries(data.domains)) {
            if (store.domains[domain]) {
                // 合并选择器
                Object.assign(store.domains[domain].selectorPatterns, memory.selectorPatterns);
                Object.assign(store.domains[domain].taskTemplates, memory.taskTemplates);
                Object.assign(store.domains[domain].pageSignatures, memory.pageSignatures);
            } else {
                store.domains[domain] = memory;
            }
        }
    } else {
        // 覆盖
        store.domains = data.domains;
    }
    
    await saveMemoryStore(store);
}

/**
 * 清除所有记忆
 */
async function clearAllMemory() {
    await chrome.storage.local.remove(MEMORY_STORAGE_KEY);
}

/**
 * 清除某个域名的记忆
 * @param {string} domain 
 */
async function clearDomainMemory(domain) {
    const store = await getMemoryStore();
    delete store.domains[domain];
    await saveMemoryStore(store);
}

// 导出为模块（Chrome Extension Service Worker 环境）
if (typeof self !== 'undefined') {
    self.MemoryManager = {
        getProjectMemory,
        saveSelector,
        getSelector,
        saveTaskTemplate,
        getTaskTemplate,
        updateSelectorConfidence,
        cleanupExpiredMemory,
        getMemoryStats,
        exportMemory,
        importMemory,
        clearAllMemory,
        clearDomainMemory,
        extractDomain,
        extractPathPattern
    };
}

// 也支持 ES Module 式导出（用于可能的打包场景）
// export { ... }

