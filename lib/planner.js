// ==========================================
// 🧠 AI 规划器 V2 - 迭代规划模式
// ==========================================
// 核心改进：每步执行后重新评估，直到任务完成

const PLANNER_CONFIG = {
    maxIterations: 30,   // 最大迭代次数
    maxTokensPerCall: 1500,
    temperature: 0.3
};

// 当前正在处理的 tabId（用于发送思考消息）
let currentTargetTabId = null;

/**
 * 生成精简的 DOM 摘要用于 AI 分析
 */
function generateDOMSummary(pageData) {
    return {
        url: pageData.url,
        title: pageData.title,
        inputs: (pageData.inputs || []).slice(0, 15).map(input => ({
            key: input.key,
            type: input.type,
            placeholder: input.placeholder,
            label: input.label,
            selector: input.selector
        })),
        buttons: (pageData.buttons || []).slice(0, 25).map(btn => ({
            key: btn.key,
            text: btn.text,
            type: btn.type,
            selector: btn.selector
        })),
        textSnippet: (pageData.text || '').substring(0, 1000)
    };
}

/**
 * 构建迭代规划 Prompt（核心改进）
 * @param {string} userGoal - 用户的最终目标
 * @param {Object} domSummary - 当前页面 DOM 摘要
 * @param {Array} actionHistory - 已执行的操作历史
 * @param {Object} memory - 项目记忆
 */
function buildIterativePlannerPrompt(userGoal, domSummary, actionHistory = [], memory = {}) {
    const historyText = actionHistory.length > 0 
        ? actionHistory.map((h, i) => `${i + 1}. ${h.description} → ${h.success ? '✅成功' : '❌失败'}`).join('\n')
        : '(尚未执行任何操作)';

    const selectorHints = Object.entries(memory.selectorPatterns || {})
        .filter(([_, v]) => v.confidence > 0.6)
        .slice(0, 10)
        .map(([name, v]) => `  - ${name}: ${v.selector}`)
        .join('\n') || '  (无)';

    return `# 迭代式浏览器自动化

## 用户最终目标
"${userGoal}"

## 当前页面状态
- URL: ${domSummary.url}
- 标题: ${domSummary.title}

### 可用输入框
${JSON.stringify(domSummary.inputs, null, 2)}

### 可用按钮/链接
${JSON.stringify(domSummary.buttons, null, 2)}

### 页面内容
${domSummary.textSnippet}

## 已执行的操作
${historyText}

## 已知选择器
${selectorHints}

## 你的任务
分析当前页面状态，判断：
1. 用户目标是否已完成？
2. 如果未完成，下一步应该做什么？

## 输出格式 (严格 JSON)
{
  "thinking": "你对当前状态的分析（简短）",
  "goalCompleted": true/false,
  "completionReason": "如果完成，说明完成的原因",
  "nextAction": {
    "action": "fill" | "click" | "navigate" | "wait" | "scroll" | "select" | null,
    "target": "CSS 选择器或 URL",
    "value": "填充值（如需要）",
    "description": "这一步做什么"
  },
  "confidence": 0.0-1.0,
  "estimatedRemainingSteps": 0-10
}

注意：
- 如果目标已完成，nextAction 应为 null
- 如果需要点击按钮进入下一步，先点击，下一轮再处理新页面
- 不要假设点击后会发生什么，先执行再观察
- 只输出 JSON`;
}

/**
 * 调用 AI 进行迭代规划 (流式模式)
 */
async function callIterativePlannerAI(prompt, screenshot, config) {
    const { apiKey, providerUrl, modelName } = config;
    
    if (!apiKey) {
        throw new Error('API Key 未配置');
    }
    
    const endpoint = providerUrl || 'https://openrouter.ai/api/v1/chat/completions';
    
    const messages = [
        { role: 'system', content: '你是一个浏览器自动化专家。每次只规划下一步操作，观察结果后再决定下一步。只输出 JSON。' }
    ];
    
    if (screenshot) {
        messages.push({
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: screenshot, detail: 'low' } }
            ]
        });
    } else {
        messages.push({ role: 'user', content: prompt });
    }
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: modelName || 'google/gemini-2.0-flash-001',
            messages,
            stream: true, // 启用流式输出
            max_tokens: PLANNER_CONFIG.maxTokensPerCall,
            temperature: PLANNER_CONFIG.temperature
        })
    });
    
    if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message?.replace(/sk-[a-zA-Z0-9]+/g, '[REDACTED]') || `HTTP ${response.status}`);
    }
    
    // 流式读取响应
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';
    
    // 通知开始思考
    broadcastThinkingUpdate('');
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (value) {
                buffer += decoder.decode(value, { stream: true });
            }
            
            // 处理 SSE 格式
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                
                if (data === '[DONE]') continue;
                if (!data) continue;
                
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content || '';
                    if (content) {
                        fullContent += content;
                        // 流式发送 thinking 内容到 content script
                        broadcastThinkingUpdate(content);
                    }
                } catch (e) {
                    // 解析失败，可能是不完整的 JSON，忽略
                    console.log('SSE parse skip:', data.substring(0, 50));
                }
            }
            
            if (done) break;
        }
        
        // 处理 buffer 中剩余的内容
        if (buffer.trim()) {
            const remainingLines = buffer.split('\n');
            for (const line of remainingLines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]' || !data) continue;
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content || '';
                    if (content) {
                        fullContent += content;
                        broadcastThinkingUpdate(content);
                    }
                } catch (e) {}
            }
        }
    } finally {
        // 确保关闭 reader
        reader.releaseLock();
    }
    
    // 通知思考完成
    broadcastThinkingDone();
    
    console.log('AI fullContent length:', fullContent.length);
    return fullContent;
}

/**
 * 向 content script 发送 AI 思考更新
 */
function broadcastThinkingUpdate(content) {
    if (!currentTargetTabId) return;
    try {
        chrome.tabs.sendMessage(currentTargetTabId, { type: 'AI_THINKING_UPDATE', content }).catch(() => {});
    } catch (e) {
        // content script 可能未就绪，忽略
    }
}

/**
 * 通知 content script 思考完成
 */
function broadcastThinkingDone() {
    if (!currentTargetTabId) return;
    try {
        chrome.tabs.sendMessage(currentTargetTabId, { type: 'AI_THINKING_DONE' }).catch(() => {});
    } catch (e) {
        // content script 可能未就绪，忽略
    }
}

/**
 * 尝试修复不完整的 JSON 字符串
 */
function tryFixJson(jsonStr) {
    let fixed = jsonStr.trim();
    // 简单尝试补全闭合括号
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
        fixed += '}'.repeat(openBraces - closeBraces);
    }
    return fixed;
}

/**
 * 解析迭代规划响应
 */
function parseIterativeResponse(response) {
    let jsonStr = response;
    
    const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1];
    }
    
    let jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    let result;
    
    try {
        if (!jsonMatch) {
            // 尝试直接解析，或者是修复后的解析
            result = JSON.parse(tryFixJson(jsonStr));
        } else {
            result = JSON.parse(jsonMatch[0]);
        }
    } catch (e) {
        console.warn('JSON 解析失败，尝试修复...', e);
        try {
            // 二次尝试：如果正则没匹配到，或者匹配到的也解析失败，尝试修复整个字符串
            result = JSON.parse(tryFixJson(jsonStr));
        } catch (e2) {
             console.error('JSON 修复失败:', e2);
             // 如果还是失败，构造一个“继续尝试”的默认结果，避免直接报错停止
             // 这样可以让 AI 在下一轮有机会纠正，而不是直接崩溃
             return {
                 thinking: "JSON 解析错误，尝试继续...",
                 goalCompleted: false,
                 nextAction: null, // 将触发 "AI 无法确定下一步" 的逻辑，但为了避免立即停止，我们可以让它重试
                 confidence: 0
             };
             // 或者直接抛出错误让上层处理
             throw new Error('AI 返回中未找到有效 JSON: ' + e2.message);
        }
    }
    
    return {
        thinking: result.thinking || '',
        goalCompleted: result.goalCompleted === true,
        completionReason: result.completionReason || '',
        nextAction: result.nextAction || null,
        confidence: result.confidence || 0.5,
        estimatedRemainingSteps: result.estimatedRemainingSteps || 0
    };
}

/**
 * 迭代规划主函数 - 规划下一步
 * @param {Object} options
 * @returns {Promise<Object>} 返回 { goalCompleted, nextStep, thinking }
 */
async function planNextStep(options) {
    const { userGoal, pageData, screenshot, actionHistory, memory, apiConfig, tabId } = options;
    
    // 设置当前目标 tabId 用于广播思考内容
    currentTargetTabId = tabId || null;
    
    // 生成 DOM 摘要
    const domSummary = generateDOMSummary(pageData);
    
    // 构建 prompt
    const prompt = buildIterativePlannerPrompt(userGoal, domSummary, actionHistory, memory);
    
    // 调用 AI
    console.log(`🧠 迭代规划 (已执行 ${actionHistory.length} 步)...`);
    const aiResponse = await callIterativePlannerAI(prompt, screenshot, apiConfig);
    
    // 解析响应
    const result = parseIterativeResponse(aiResponse);
    
    console.log(`📋 AI 判断: ${result.goalCompleted ? '✅任务完成' : '➡️继续执行'}`);
    if (result.nextAction) {
        console.log(`   下一步: ${result.nextAction.description}`);
    }
    
    return {
        goalCompleted: result.goalCompleted,
        completionReason: result.completionReason,
        thinking: result.thinking,
        nextStep: result.nextAction ? {
            id: actionHistory.length + 1,
            action: result.nextAction.action,
            target: result.nextAction.target,
            value: result.nextAction.value,
            description: result.nextAction.description,
            fallbackTargets: [],
            status: 'pending'
        } : null,
        confidence: result.confidence,
        estimatedRemainingSteps: result.estimatedRemainingSteps
    };
}

/**
 * 替换步骤中的 memory 占位符
 */
function resolveStepPlaceholders(step, userMemory) {
    const resolved = { ...step };
    
    if (resolved.value && typeof resolved.value === 'string') {
        resolved.value = resolved.value.replace(/\{\{memory\.(\w+)\}\}/g, (match, key) => {
            return userMemory[key] || match;
        });
    }
    
    if (resolved.target && typeof resolved.target === 'string') {
        resolved.target = resolved.target.replace(/\{\{memory\.(\w+)\}\}/g, (match, key) => {
            return userMemory[key] || match;
        });
    }
    
    return resolved;
}

// ==========================================
// 旧版一次性规划（保留用于兼容缓存模板）
// ==========================================

function buildPlannerPrompt(userPrompt, domSummary, memory = {}) {
    // 简化版，用于生成可缓存的模板
    return `# 任务规划

用户任务: "${userPrompt}"
页面 URL: ${domSummary.url}
页面标题: ${domSummary.title}

可用输入框: ${JSON.stringify(domSummary.inputs, null, 2)}
可用按钮: ${JSON.stringify(domSummary.buttons, null, 2)}

生成完整步骤序列，输出 JSON:
{
  "taskId": "uuid",
  "intent": "任务意图",
  "steps": [{ "id": 1, "action": "...", "target": "...", "value": "...", "description": "..." }],
  "expectedOutcome": "预期结果"
}`;
}

async function planTask(options) {
    const { userPrompt, pageData, screenshot, memory, apiConfig } = options;
    
    // 检查缓存模板
    if (memory && self.MemoryManager) {
        const cachedTemplate = await self.MemoryManager.getTaskTemplate(pageData.url, userPrompt);
        if (cachedTemplate) {
            console.log('📦 使用缓存模板');
            return { ...cachedTemplate, fromCache: true };
        }
    }
    
    // 没有缓存，返回空 - 将使用迭代模式
    return null;
}

// 导出
if (typeof self !== 'undefined') {
    self.Planner = {
        // 新的迭代规划 API
        planNextStep,
        generateDOMSummary,
        buildIterativePlannerPrompt,
        parseIterativeResponse,
        resolveStepPlaceholders,
        
        // 旧版 API（兼容）
        planTask,
        buildPlannerPrompt,
        
        PLANNER_CONFIG
    };
}
