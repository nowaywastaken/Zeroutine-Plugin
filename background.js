// ==========================================
// 🤖 Zeroutine-Plugin Background Service Worker
// ==========================================
// 架构 V2: 方案 B（命令式 AI）+ 方案 C（视觉模型）+ 项目级记忆
// 核心改进：一次性规划 + 确定性执行 + 视觉修复

// =================配置=================
const CONFIG = {
    maxSteps: 50,
    apiMinInterval: 500,
    defaultTimeout: 10000
};

// Rate limiting
let lastApiCallTime = 0;

// =================模块加载=================
// 在 Service Worker 中导入模块
importScripts(
    'lib/memory_manager.js',
    'lib/planner.js',
    'lib/executor.js',
    'lib/vision.js'
);

// =================全局状态=================
let globalState = {
    active: false,
    tabId: null,
    task: null,
    currentStepIndex: 0,
    stepInfo: '🚀 扩展已就绪',
    waitingForLoad: false,
    lastPrompt: ''
};

// 状态持久化
function saveState() {
    chrome.storage.local.set({ agentState: globalState });
}

async function restoreState() {
    const data = await chrome.storage.local.get('agentState');
    if (data.agentState) {
        globalState = { ...globalState, ...data.agentState };
    }
}

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
    chrome.storage.local.set({
        agentState: { active: false, stepInfo: '🚀 扩展已就绪', waitingForLoad: false }
    });
    
    // 清理过期记忆
    if (self.MemoryManager) {
        const cleaned = await self.MemoryManager.cleanupExpiredMemory();
        if (cleaned > 0) {
            console.log(`🧹 清理了 ${cleaned} 个过期域名记忆`);
        }
    }
    
    chrome.alarms.clearAll();
});

// Service Worker 恢复
restoreState();

// =================消息处理=================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // 🚀 新的智能任务启动
    if (request.type === 'SMART_START') {
        console.log('🚀 收到任务请求:', request.prompt);
        sendResponse({ status: 'analyzing' });
        
        (async () => {
            try {
                await handleSmartStart(request.tabId, request.prompt, request.mode);
            } catch (e) {
                console.error('任务启动失败:', e);
                globalState.active = false;
                globalState.stepInfo = '❌ 启动失败: ' + e.message;
                saveState();
                updateOverlay(request.tabId, globalState.stepInfo);
            }
        })();
        return true;
    }
    
    // 传统任务启动（兼容）
    if (request.type === 'START_TASK') {
        handleSmartStart(request.tabId, request.prompt, 'AGENT');
        sendResponse({ status: 'ok' });
        return true;
    }
    
    // 停止任务
    if (request.type === 'STOP_TASK') {
        console.log('🛑 任务终止');
        globalState.active = false;
        globalState.stepInfo = '⛔️ 任务已由用户终止';
        globalState.waitingForLoad = false;
        saveState();
        chrome.alarms.clearAll();
        
        if (globalState.tabId) {
            updateOverlay(globalState.tabId, globalState.stepInfo);
        }
        sendResponse({ status: 'stopped' });
        return true;
    }
    
    // 获取状态
    if (request.type === 'GET_STATUS') {
        chrome.storage.local.get('agentState', (data) => {
            sendResponse(data.agentState || globalState);
        });
        return true;
    }
    
    // 脚本相关（保留原有功能）
    if (request.type === 'GENERATE_SCRIPT') {
        handleScriptGeneration(request.tabId, request.url, request.prompt)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
    }
    
    if (request.type === 'REPAIR_SCRIPT') {
        handleScriptRepair(request.tabId, request.scriptId, request.complaint)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
    }
    
    if (request.type === 'CONVERT_HISTORY_TO_SCRIPT') {
        if (!globalState.task?.steps) {
            sendResponse({ status: 'error', error: 'No task history found' });
            return true;
        }
        
        const targetTabId = request.tabId || globalState.tabId;
        chrome.tabs.get(targetTabId, (tab) => {
            // 将任务步骤转换为脚本
            convertTaskToScript(globalState.task, tab?.url || '*')
                .then(() => sendResponse({ status: 'ok' }))
                .catch(err => sendResponse({ status: 'error', error: err.message }));
        });
        return true;
    }
});

// =================新核心流程（迭代规划 V2）=================

/**
 * 智能任务启动 - 迭代模式
 */
async function handleSmartStart(tabId, prompt, mode) {
    // 1. 初始化状态
    globalState = {
        active: true,
        tabId,
        userGoal: prompt,
        actionHistory: [],
        stepInfo: '🔍 正在分析页面...',
        waitingForLoad: false,
        lastPrompt: prompt,
        iterationCount: 0
    };
    saveState();
    
    // 2. 注入 Overlay
    await injectOverlay(tabId);
    updateOverlay(tabId, globalState.stepInfo);
    
    // 3. 检查受限页面
    const tab = await chrome.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) {
        globalState.stepInfo = '⚠️ 受限页面，无法执行自动化';
        globalState.active = false;
        saveState();
        updateOverlay(tabId, globalState.stepInfo);
        return;
    }
    
    // 4. 检查模式
    if (mode === 'SCRIPT') {
        updateOverlay(tabId, '📜 正在生成脚本...');
        await handleScriptGeneration(tabId, tab.url, prompt);
        return;
    }
    
    // 5. 获取配置
    const apiConfig = await chrome.storage.local.get(['apiKey', 'providerUrl', 'modelName']);
    if (!apiConfig.apiKey) {
        globalState.stepInfo = '❌ 请先在设置中配置 API Key';
        globalState.active = false;
        saveState();
        updateOverlay(tabId, globalState.stepInfo);
        return;
    }
    
    // 6. 开始迭代执行循环
    await runIterativeLoop(tabId, prompt, apiConfig);
}

/**
 * 迭代执行循环 - 核心逻辑
 */
async function runIterativeLoop(tabId, userGoal, apiConfig) {
    const MAX_ITERATIONS = 30;
    const userMemoryData = await chrome.storage.local.get('userMemory');
    const userMemory = parseUserMemory(userMemoryData.userMemory || '');
    
    while (globalState.active && globalState.iterationCount < MAX_ITERATIONS) {
        globalState.iterationCount++;
        
        try {
            // 1. 等待页面稳定
            await delay(300);
            
            // 2. 检查 tab 是否还存在
            let tab;
            try {
                tab = await chrome.tabs.get(tabId);
            } catch (e) {
                globalState.stepInfo = '❌ 页面已关闭';
                globalState.active = false;
                break;
            }
            
            // 3. 分析当前页面
            updateOverlay(tabId, `🔍 分析页面... (第 ${globalState.iterationCount} 轮)`);
            const pageData = await analyzePage(tabId);
            
            // 4. 获取项目记忆
            const domain = self.MemoryManager?.extractDomain(tab.url) || 'unknown';
            const memory = await self.MemoryManager?.getProjectMemory(domain) || {};
            
            // 5. 尝试获取截图
            let screenshot = null;
            try {
                if (self.Vision) {
                    screenshot = await self.Vision.captureScreenshot(tabId, { resize: true });
                }
            } catch (e) {
                // 截图失败不影响流程
            }
            
            // 6. 调用 AI 规划下一步
            updateOverlay(tabId, '🧠 AI 正在思考...');
            const planResult = await self.Planner.planNextStep({
                userGoal,
                pageData,
                screenshot,
                actionHistory: globalState.actionHistory,
                memory,
                apiConfig,
                tabId  // 传递 tabId 用于流式思考显示
            });
            
            // 7. 检查是否完成
            if (planResult.goalCompleted) {
                globalState.stepInfo = `✅ 任务完成！${planResult.completionReason || ''}`;
                globalState.active = false;
                saveState();
                updateOverlay(tabId, globalState.stepInfo);
                console.log('🎉 任务完成:', planResult.completionReason);
                break;
            }
            
            // 8. 检查是否有下一步
            if (!planResult.nextStep) {
                globalState.stepInfo = '❓ AI 无法确定下一步操作';
                globalState.active = false;
                saveState();
                updateOverlay(tabId, globalState.stepInfo);
                break;
            }
            
            // 9. 执行下一步
            const step = planResult.nextStep;
            const resolvedStep = self.Planner.resolveStepPlaceholders(step, userMemory);
            
            updateOverlay(tabId, `⚡️ [${globalState.iterationCount}] ${resolvedStep.description}`);
            globalState.stepInfo = `⚡️ ${resolvedStep.description}`;
            saveState();
            
            // 10. 执行操作
            const stepResult = await self.Executor.executeStep(resolvedStep, {
                tabId,
                userMemory,
                pageUrl: tab.url
            });
            
            // 11. 记录历史
            globalState.actionHistory.push({
                step: globalState.iterationCount,
                action: resolvedStep.action,
                target: resolvedStep.target,
                description: resolvedStep.description,
                success: stepResult.success,
                error: stepResult.error
            });
            saveState();
            
            // 12. 处理执行结果
            if (!stepResult.success) {
                console.warn(`⚠️ 步骤失败: ${stepResult.error}`);
                
                // 尝试视觉修复
                if (self.Vision) {
                    updateOverlay(tabId, '🔧 尝试视觉修复...');
                    const repairResult = await self.Vision.repairSelector(tabId, resolvedStep, apiConfig);
                    
                    if (repairResult.success) {
                        // 用新选择器重试
                        resolvedStep.target = repairResult.newSelector;
                        const retryResult = await self.Executor.executeStep(resolvedStep, {
                            tabId,
                            userMemory,
                            pageUrl: tab.url
                        });
                        
                        if (retryResult.success) {
                            globalState.actionHistory[globalState.actionHistory.length - 1].success = true;
                            globalState.actionHistory[globalState.actionHistory.length - 1].repaired = true;
                            
                            // 保存修复后的选择器
                            if (self.MemoryManager) {
                                await self.MemoryManager.saveSelector(
                                    tab.url,
                                    resolvedStep.description,
                                    repairResult.newSelector,
                                    true
                                );
                            }
                        }
                    }
                }
            }
            
            // 13. 如果是点击或导航，等待页面变化
            if (['click', 'navigate'].includes(resolvedStep.action)) {
                updateOverlay(tabId, '⏳ 等待页面响应...');
                await waitForPageStable(tabId, 3000);
            }
            
        } catch (error) {
            console.error('迭代循环错误:', error);
            globalState.stepInfo = `❌ 错误: ${error.message}`;
            globalState.active = false;
            saveState();
            updateOverlay(tabId, globalState.stepInfo);
            break;
        }
    }
    
    // 循环结束
    if (globalState.iterationCount >= MAX_ITERATIONS && globalState.active) {
        globalState.stepInfo = '⚠️ 达到最大迭代次数，任务停止';
        globalState.active = false;
        saveState();
        updateOverlay(tabId, globalState.stepInfo);
    }
}

/**
 * 等待页面稳定
 */
async function waitForPageStable(tabId, timeout = 3000) {
    const startTime = Date.now();
    let lastUrl = '';
    let stableCount = 0;
    
    while (Date.now() - startTime < timeout) {
        try {
            const tab = await chrome.tabs.get(tabId);
            
            // 等待页面加载完成
            if (tab.status !== 'complete') {
                stableCount = 0;
                await delay(200);
                continue;
            }
            
            // 检查 URL 是否稳定
            if (tab.url === lastUrl) {
                stableCount++;
                if (stableCount >= 3) {
                    return; // 页面稳定
                }
            } else {
                lastUrl = tab.url;
                stableCount = 0;
            }
            
            await delay(200);
        } catch (e) {
            // Tab 可能已关闭
            return;
        }
    }
}

// =================辅助函数=================

/**
 * 检查是否为受限 URL
 */
function isRestrictedUrl(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('edge://') || 
           url.startsWith('about:') || 
           url.startsWith('view-source:') ||
           url.startsWith('chrome-extension://');
}

/**
 * 分析页面元素
 */
async function analyzePage(tabId) {
    const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: analyzePageElements
    });
    return result[0]?.result || { text: '', inputs: [], buttons: [] };
}

/**
 * 页面元素分析函数（注入到页面）
 */
function analyzePageElements() {
    const bodyText = document.body?.innerText || '';
    
    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }
    
    function buildSelector(el) {
        if (!el) return null;
        const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
        if (testId) return `[data-testid="${testId}"]`;
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel) return `[aria-label="${ariaLabel}"]`;
        let sel = el.tagName.toLowerCase();
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.split(/\s+/).filter(c => c && !c.includes(':'));
            if (classes.length > 0) sel += '.' + classes.slice(0, 2).join('.');
        }
        return sel;
    }
    
    // 收集输入框
    const inputList = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
        if (!isVisible(el)) return;
        inputList.push({
            key: el.name || el.id || `idx_${inputList.length}`,
            placeholder: el.placeholder || '',
            label: el.previousElementSibling?.innerText?.substring(0, 30) || '',
            type: el.type || el.tagName.toLowerCase(),
            selector: buildSelector(el),
            disabled: el.disabled,
            value: el.value?.substring(0, 20) || ''
        });
    });
    
    // 收集按钮
    const btnList = [];
    const seenElements = new WeakSet();
    
    ['button:not([disabled])', 'input[type="submit"]', '[role="button"]', 'a[href]'].forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (seenElements.has(el) || !isVisible(el)) return;
            seenElements.add(el);
            
            const text = (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '')
                .substring(0, 30).replace(/\n/g, ' ').trim();
            if (!text) return;
            
            btnList.push({
                key: el.id || el.name || buildSelector(el) || `btn_${btnList.length}`,
                text,
                tagName: el.tagName,
                selector: buildSelector(el),
                type: el.type || el.getAttribute('role') || 'link'
            });
        });
    });
    
    return {
        text: bodyText.substring(0, 2500),
        inputs: inputList.slice(0, 30),
        buttons: btnList.slice(0, 50),
        url: window.location.href,
        title: document.title
    };
}

/**
 * 注入 Overlay
 */
async function injectOverlay(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
    } catch (e) {
        console.warn('Overlay 注入失败:', e);
    }
}

/**
 * 更新 Overlay 显示
 */
function updateOverlay(tabId, text) {
    chrome.tabs.sendMessage(tabId, { type: 'UPDATE_OVERLAY', text }).catch(() => {});
}

/**
 * 解析用户记忆（从文本格式解析为对象）
 */
function parseUserMemory(memoryText) {
    const memory = {};
    if (!memoryText) return memory;
    
    // 支持 key: value 和 key=value 格式
    const lines = memoryText.split('\n');
    for (const line of lines) {
        const match = line.match(/^(\w+)\s*[:=]\s*(.+)$/);
        if (match) {
            memory[match[1].trim()] = match[2].trim();
        }
    }
    
    return memory;
}

/**
 * 延迟函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// =================脚本生成（保留原有功能）=================

async function handleScriptGeneration(tabId, url, userPrompt) {
    // ... 保留原有的脚本生成逻辑
    // 这部分代码与原来一样，用于生成 Tampermonkey 风格的脚本
    
    const tab = await chrome.tabs.get(tabId);
    const actualUrl = url || tab?.url || '*';
    
    // 获取页面数据
    let pageData = { text: '' };
    try {
        const result = await chrome.scripting.executeScript({ target: { tabId }, function: analyzePageElements });
        pageData = result[0].result;
    } catch (e) {}
    
    // 调用 AI 生成脚本
    const apiConfig = await chrome.storage.local.get(['apiKey', 'providerUrl', 'modelName']);
    
    if (!apiConfig.apiKey) {
        throw new Error('API Key 未配置');
    }
    
    const prompt = `
    任务: 创建一个 Tampermonkey 风格的 JavaScript 脚本来实现: "${userPrompt}"
    
    页面 URL: ${actualUrl}
    页面标题: ${pageData.title || 'Unknown'}
    可用输入框: ${JSON.stringify(pageData.inputs?.slice(0, 10))}
    可用按钮: ${JSON.stringify(pageData.buttons?.slice(0, 10))}
    
    要求:
    1. 代码要能在页面加载后自动执行
    2. 使用稳定的选择器
    3. 添加适当的错误处理
    
    返回 JSON:
    {
      "code": "完整的 JavaScript 代码",
      "name": "脚本简短名称",
      "explanation": "脚本功能说明"
    }
    `;
    
    const response = await callAI(prompt, 'json_object', apiConfig);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回格式无效');
    
    const data = JSON.parse(jsonMatch[0]);
    
    // 保存脚本
    const { userScripts: currentScripts } = await chrome.storage.local.get('userScripts');
    const newScripts = currentScripts || [];
    
    const scriptId = crypto.randomUUID();
    newScripts.push({
        id: scriptId,
        name: data.name || 'AI Script',
        matches: actualUrl.split('?')[0] + '*',
        enabled: true,
        createdAt: Date.now()
    });
    
    await chrome.storage.local.set({
        userScripts: newScripts,
        [`ujs_${scriptId}`]: data.code
    });
    
    updateOverlay(tabId, `✅ 脚本已生成: ${data.name}`);
    globalState.active = false;
    saveState();
    
    return true;
}

async function handleScriptRepair(tabId, scriptId, complaint) {
    // 保留原有的脚本修复逻辑
    const { userScripts } = await chrome.storage.local.get('userScripts');
    const script = userScripts?.find(s => s.id === scriptId);
    if (!script) throw new Error('Script not found');
    
    const codeData = await chrome.storage.local.get(`ujs_${scriptId}`);
    const currentCode = codeData[`ujs_${scriptId}`] || '';
    
    const apiConfig = await chrome.storage.local.get(['apiKey', 'providerUrl', 'modelName']);
    
    const prompt = `
    修复这个脚本，用户反馈: "${complaint}"
    
    当前代码:
    ${currentCode}
    
    返回 JSON:
    {
      "code": "修复后的代码",
      "explanation": "修复说明"
    }
    `;
    
    const response = await callAI(prompt, 'json_object', apiConfig);
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI 返回格式无效');
    
    const data = JSON.parse(jsonMatch[0]);
    
    await chrome.storage.local.set({ [`ujs_${scriptId}`]: data.code });
    
    return true;
}

async function convertTaskToScript(task, url) {
    // 将任务步骤转换为可重复执行的脚本
    const steps = task.steps.map(step => {
        switch (step.action) {
            case 'fill':
                return `document.querySelector('${step.target}').value = '${step.value}';`;
            case 'click':
                return `document.querySelector('${step.target}').click();`;
            default:
                return `// ${step.action}: ${step.description}`;
        }
    }).join('\n');
    
    const code = `
// Auto-generated from task: ${task.intent || 'Unknown'}
(function() {
    function run() {
        ${steps}
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }
})();
`;
    
    const { userScripts: currentScripts } = await chrome.storage.local.get('userScripts');
    const newScripts = currentScripts || [];
    
    const scriptId = crypto.randomUUID();
    newScripts.push({
        id: scriptId,
        name: task.intent || 'Converted Task',
        matches: url.split('?')[0] + '*',
        enabled: true,
        createdAt: Date.now()
    });
    
    await chrome.storage.local.set({
        userScripts: newScripts,
        [`ujs_${scriptId}`]: code
    });
    
    return scriptId;
}

// =================AI 调用=================

async function callAI(prompt, format = 'json_object', config = {}) {
    const { apiKey, providerUrl, modelName } = config.apiKey ? config : await chrome.storage.local.get(['apiKey', 'providerUrl', 'modelName']);
    
    if (!apiKey) {
        throw new Error('API Key 未配置');
    }
    
    // Rate limiting
    const now = Date.now();
    const elapsed = now - lastApiCallTime;
    if (elapsed < CONFIG.apiMinInterval) {
        await delay(CONFIG.apiMinInterval - elapsed);
    }
    lastApiCallTime = Date.now();
    
    const endpoint = providerUrl || 'https://openrouter.ai/api/v1/chat/completions';
    const model = modelName || 'google/gemini-2.0-flash-001';
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            response_format: { type: format },
            messages: [
                { role: 'system', content: '你是一个浏览器自动化专家。只输出 JSON。' },
                { role: 'user', content: prompt }
            ]
        })
    });
    
    const data = await response.json();
    
    if (data.error) {
        const safeMessage = data.error.message?.replace(/sk-[a-zA-Z0-9]+/g, '[REDACTED]') || 'Unknown API error';
        throw new Error(safeMessage);
    }
    
    return data.choices?.[0]?.message?.content || '';
}

// =================页面加载监听=================

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    
    // 用户脚本注入（保留原有功能）
    try {
        const { userScripts } = await chrome.storage.local.get('userScripts');
        if (userScripts?.length > 0) {
            const matchedScripts = userScripts.filter(script => {
                if (!script.enabled || !script.matches) return false;
                try {
                    const pattern = script.matches.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                    return new RegExp(`^${pattern}$`).test(tab.url);
                } catch { return false; }
            });
            
            if (matchedScripts.length > 0) {
                const keys = matchedScripts.map(s => `ujs_${s.id}`);
                const codeMap = await chrome.storage.local.get(keys);
                
                for (const script of matchedScripts) {
                    const code = codeMap[`ujs_${script.id}`];
                    if (code) {
                        chrome.scripting.executeScript({
                            target: { tabId },
                            func: (code) => {
                                const el = document.createElement('script');
                                el.textContent = code;
                                (document.head || document.documentElement).appendChild(el);
                                el.remove();
                            },
                            args: [code],
                            world: 'MAIN'
                        }).catch(() => {});
                    }
                }
            }
        }
    } catch (e) {}
    
    // Agent 状态恢复
    if (globalState.active && tabId === globalState.tabId && globalState.waitingForLoad) {
        console.log('页面加载完成，继续执行...');
        globalState.waitingForLoad = false;
        saveState();
        
        // 重新注入 Overlay
        await injectOverlay(tabId);
        updateOverlay(tabId, globalState.stepInfo);
    }
});

// =================Alarm 处理=================

chrome.alarms.onAlarm.addListener((alarm) => {
    // 预留用于未来的定时任务
    console.log('Alarm:', alarm.name);
});

console.log('🤖 Zeroutine V2 已启动');
