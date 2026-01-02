// ==========================================
// ⚡️ 确定性执行器
// ==========================================
// 按照规划好的步骤序列执行，无需再次调用 AI
// 支持重试、fallback、进度报告

const EXECUTOR_CONFIG = {
    maxRetries: 3,
    defaultTimeout: 10000,
    stepDelay: 500, // 步骤间延迟
    scrollDelay: 300
};

/**
 * 执行单个步骤
 * @param {Object} step - 步骤对象
 * @param {Object} context - 执行上下文
 * @returns {Promise<Object>}
 */
async function executeStep(step, context = {}) {
    const { tabId, userMemory = {}, onProgress } = context;
    
    // 替换占位符
    const resolvedStep = self.Planner?.resolveStepPlaceholders 
        ? self.Planner.resolveStepPlaceholders(step, userMemory)
        : step;
    
    const result = {
        stepId: step.id,
        action: step.action,
        success: false,
        error: null,
        retries: 0,
        usedFallback: false,
        executedAt: Date.now()
    };
    
    // 报告进度
    if (onProgress) {
        onProgress({ type: 'step_start', step: resolvedStep });
    }
    
    try {
        switch (resolvedStep.action) {
            case 'navigate':
                await executeNavigate(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'fill':
                await executeFillWithRetry(tabId, resolvedStep, result);
                break;
                
            case 'click':
                await executeClickWithRetry(tabId, resolvedStep, result);
                break;
                
            case 'wait':
                await executeWait(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'scroll':
                await executeScroll(tabId, resolvedStep);
                result.success = true;
                break;
                
            case 'hover':
                await executeHover(tabId, resolvedStep, result);
                break;
                
            case 'select':
                await executeSelect(tabId, resolvedStep, result);
                break;
                
            default:
                throw new Error(`未知操作类型: ${resolvedStep.action}`);
        }
    } catch (error) {
        result.error = error.message;
        result.success = false;
    }
    
    // 报告结果
    if (onProgress) {
        onProgress({ type: 'step_complete', step: resolvedStep, result });
    }
    
    // 更新记忆中的选择器信心度
    if (resolvedStep.target && self.MemoryManager && context.pageUrl) {
        const selectorName = step.description || `step_${step.id}`;
        self.MemoryManager.saveSelector(
            context.pageUrl,
            selectorName,
            resolvedStep.target,
            result.success
        ).catch(() => {});
    }
    
    return result;
}

/**
 * 导航到 URL
 */
async function executeNavigate(tabId, step) {
    await chrome.tabs.update(tabId, { url: step.target });
    
    // 等待页面加载
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('页面加载超时'));
        }, step.timeout || EXECUTOR_CONFIG.defaultTimeout);
        
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        
        chrome.tabs.onUpdated.addListener(listener);
    });
}

/**
 * 带重试的填充操作
 */
async function executeFillWithRetry(tabId, step, result) {
    const targets = [step.target, ...(step.fallbackTargets || [])];
    
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (!target) continue;
        
        for (let retry = 0; retry < EXECUTOR_CONFIG.maxRetries; retry++) {
            try {
                const execResult = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: executeFillInPage,
                    args: [target, step.value]
                });
                
                if (execResult[0]?.result?.success) {
                    result.success = true;
                    result.retries = retry;
                    result.usedFallback = i > 0;
                    result.usedSelector = target;
                    return;
                }
            } catch (e) {
                result.retries = retry + 1;
            }
            
            // 重试前等待
            if (retry < EXECUTOR_CONFIG.maxRetries - 1) {
                await delay(500 * (retry + 1));
            }
        }
    }
    
    throw new Error(`填充操作失败: 所有选择器都无法匹配`);
}

/**
 * 页面内执行填充（注入到页面中运行）
 */
function executeFillInPage(selector, value) {
    try {
        const el = document.querySelector(selector);
        if (!el) {
            return { success: false, error: 'Element not found' };
        }
        
        // 检查可交互性
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || el.disabled) {
            return { success: false, error: 'Element not interactable' };
        }
        
        // 聚焦
        el.focus();
        
        // 清空并填充
        el.value = '';
        el.value = value;
        
        // 触发事件链
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        
        // 视觉反馈
        const originalOutline = el.style.outline;
        el.style.outline = '2px solid #4CAF50';
        setTimeout(() => { el.style.outline = originalOutline; }, 1000);
        
        return { success: true, value: el.value };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * 带重试的点击操作
 */
async function executeClickWithRetry(tabId, step, result) {
    const targets = [step.target, ...(step.fallbackTargets || [])];
    
    for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        if (!target) continue;
        
        for (let retry = 0; retry < EXECUTOR_CONFIG.maxRetries; retry++) {
            try {
                const execResult = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: executeClickInPage,
                    args: [target]
                });
                
                if (execResult[0]?.result?.success) {
                    result.success = true;
                    result.retries = retry;
                    result.usedFallback = i > 0;
                    result.usedSelector = target;
                    result.causedNavigation = execResult[0]?.result?.isLink;
                    return;
                }
            } catch (e) {
                result.retries = retry + 1;
            }
            
            if (retry < EXECUTOR_CONFIG.maxRetries - 1) {
                await delay(500 * (retry + 1));
            }
        }
    }
    
    throw new Error(`点击操作失败: 所有选择器都无法匹配`);
}

/**
 * 页面内执行点击
 */
function executeClickInPage(selector) {
    try {
        const el = document.querySelector(selector);
        if (!el) {
            return { success: false, error: 'Element not found' };
        }
        
        // 检查可见性
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            return { success: false, error: 'Element not visible' };
        }
        
        // 滚动到视图
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        
        // 视觉高亮
        const originalOutline = el.style.outline;
        const originalBg = el.style.backgroundColor;
        el.style.outline = '3px solid #f44336';
        el.style.backgroundColor = 'rgba(255, 235, 59, 0.5)';
        
        // 模拟完整鼠标事件
        setTimeout(() => {
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            el.click();
            
            // 恢复样式
            setTimeout(() => {
                el.style.outline = originalOutline;
                el.style.backgroundColor = originalBg;
            }, 500);
        }, 100);
        
        return { 
            success: true, 
            isLink: el.tagName === 'A' && el.href,
            text: el.innerText?.substring(0, 50)
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * 等待条件满足
 */
async function executeWait(tabId, step) {
    const timeout = step.timeout || EXECUTOR_CONFIG.defaultTimeout;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
        let conditionMet = false;
        
        switch (step.value) {
            case 'url_contains':
                const tab = await chrome.tabs.get(tabId);
                conditionMet = tab.url.includes(step.target);
                break;
                
            case 'element_visible':
                const result = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (selector) => {
                        const el = document.querySelector(selector);
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        return style.display !== 'none' && style.visibility !== 'hidden';
                    },
                    args: [step.target]
                });
                conditionMet = result[0]?.result === true;
                break;
                
            case 'element_gone':
                const result2 = await chrome.scripting.executeScript({
                    target: { tabId },
                    func: (selector) => !document.querySelector(selector),
                    args: [step.target]
                });
                conditionMet = result2[0]?.result === true;
                break;
                
            case 'page_load':
                const tab2 = await chrome.tabs.get(tabId);
                conditionMet = tab2.status === 'complete';
                break;
                
            default:
                // 固定等待
                await delay(parseInt(step.value) || 1000);
                conditionMet = true;
        }
        
        if (conditionMet) {
            return;
        }
        
        await delay(200);
    }
    
    throw new Error(`等待超时: ${step.value} ${step.target || ''}`);
}

/**
 * 滚动操作
 */
async function executeScroll(tabId, step) {
    await chrome.scripting.executeScript({
        target: { tabId },
        func: (direction, amount) => {
            if (direction === 'down') {
                window.scrollBy(0, amount || 500);
            } else if (direction === 'up') {
                window.scrollBy(0, -(amount || 500));
            } else if (direction === 'to') {
                const el = document.querySelector(amount);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        },
        args: [step.value, step.target]
    });
    
    await delay(EXECUTOR_CONFIG.scrollDelay);
}

/**
 * 悬停操作
 */
async function executeHover(tabId, step, result) {
    const execResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector) => {
            const el = document.querySelector(selector);
            if (!el) return { success: false };
            el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            return { success: true };
        },
        args: [step.target]
    });
    
    result.success = execResult[0]?.result?.success || false;
    if (!result.success) {
        throw new Error('悬停操作失败');
    }
}

/**
 * 选择下拉框选项
 */
async function executeSelect(tabId, step, result) {
    const execResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selector, value) => {
            const el = document.querySelector(selector);
            if (!el || el.tagName !== 'SELECT') return { success: false };
            el.value = value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { success: true, value: el.value };
        },
        args: [step.target, step.value]
    });
    
    result.success = execResult[0]?.result?.success || false;
    if (!result.success) {
        throw new Error('选择操作失败');
    }
}

/**
 * 执行完整任务
 * @param {Object} task - 规划好的任务对象
 * @param {Object} context - 执行上下文
 * @returns {Promise<Object>}
 */
async function executeTask(task, context = {}) {
    const { tabId, userMemory = {}, onProgress, onError, stopSignal } = context;
    
    const results = {
        taskId: task.taskId,
        startedAt: Date.now(),
        completedAt: null,
        success: false,
        stepsCompleted: 0,
        stepResults: [],
        error: null
    };
    
    // 报告任务开始
    if (onProgress) {
        onProgress({ type: 'task_start', task });
    }
    
    // 获取当前页面 URL
    let pageUrl = context.pageUrl;
    if (!pageUrl) {
        try {
            const tab = await chrome.tabs.get(tabId);
            pageUrl = tab.url;
        } catch (e) {}
    }
    
    try {
        for (const step of task.steps) {
            // 检查停止信号
            if (stopSignal?.() === true) {
                results.error = '任务被用户停止';
                break;
            }
            
            // 执行步骤
            const stepResult = await executeStep(step, {
                tabId,
                userMemory,
                pageUrl,
                onProgress
            });
            
            results.stepResults.push(stepResult);
            
            if (stepResult.success) {
                results.stepsCompleted++;
                
                // 如果点击导致了导航，等待页面加载
                if (stepResult.causedNavigation) {
                    await delay(1000);
                    try {
                        await waitForPageLoad(tabId, EXECUTOR_CONFIG.defaultTimeout);
                    } catch (e) {
                        // 页面可能已经加载完成
                    }
                }
            } else {
                // 步骤失败
                if (!step.optional) {
                    results.error = `步骤 ${step.id} 失败: ${stepResult.error}`;
                    if (onError) {
                        const shouldContinue = await onError({ step, result: stepResult });
                        if (!shouldContinue) {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            
            // 步骤间延迟
            await delay(EXECUTOR_CONFIG.stepDelay);
        }
        
        results.success = results.stepsCompleted === task.steps.length;
        
    } catch (error) {
        results.error = error.message;
    }
    
    results.completedAt = Date.now();
    
    // 报告任务完成
    if (onProgress) {
        onProgress({ type: 'task_complete', results });
    }
    
    // 更新任务模板的成功率
    if (self.MemoryManager && pageUrl) {
        // 异步更新，不阻塞
        const store = await chrome.storage.local.get('projectMemory');
        const memory = store.projectMemory;
        if (memory?.domains) {
            const domain = self.MemoryManager.extractDomain(pageUrl);
            const templates = memory.domains[domain]?.taskTemplates;
            if (templates) {
                for (const template of Object.values(templates)) {
                    if (template.task?.taskId === task.taskId) {
                        if (results.success) {
                            template.successCount = (template.successCount || 0) + 1;
                        } else {
                            template.failCount = (template.failCount || 0) + 1;
                        }
                        await chrome.storage.local.set({ projectMemory: memory });
                        break;
                    }
                }
            }
        }
    }
    
    return results;
}

/**
 * 等待页面加载完成
 */
function waitForPageLoad(tabId, timeout) {
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            reject(new Error('页面加载超时'));
        }, timeout);
        
        const listener = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        
        chrome.tabs.onUpdated.addListener(listener);
        
        // 立即检查当前状态
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') {
                clearTimeout(timeoutId);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });
}

/**
 * 延迟工具函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 导出
if (typeof self !== 'undefined') {
    self.Executor = {
        executeStep,
        executeTask,
        waitForPageLoad,
        EXECUTOR_CONFIG
    };
}
