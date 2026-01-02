// ==========================================
// 👁️ 视觉理解模块
// ==========================================
// 方案 C: 使用 Vision AI 截图分析和视觉验证
// 支持 GPT-4V 和 Gemini Pro Vision

const VISION_CONFIG = {
    screenshotQuality: 70, // JPEG 质量
    maxScreenshotWidth: 1280,
    maxScreenshotHeight: 800,
    compressionFormat: 'jpeg'
};

/**
 * 截取当前标签页的屏幕截图
 * @param {number} tabId 
 * @param {Object} options 
 * @returns {Promise<string>} Base64 编码的图片
 */
async function captureScreenshot(tabId, options = {}) {
    const { quality = VISION_CONFIG.screenshotQuality, format = VISION_CONFIG.compressionFormat } = options;
    
    try {
        // 使用 chrome.tabs.captureVisibleTab
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: format,
            quality: quality
        });
        
        // 可选：压缩/缩放图片以节省 token
        if (options.resize) {
            return await resizeImage(dataUrl, VISION_CONFIG.maxScreenshotWidth, VISION_CONFIG.maxScreenshotHeight);
        }
        
        return dataUrl;
    } catch (e) {
        console.error('截图失败:', e);
        throw new Error('无法截取屏幕截图: ' + e.message);
    }
}

/**
 * 缩放图片
 * @param {string} dataUrl 
 * @param {number} maxWidth 
 * @param {number} maxHeight 
 * @returns {Promise<string>}
 */
/**
 * 缩放图片
 * @param {string} dataUrl 
 * @param {number} maxWidth 
 * @param {number} maxHeight 
 * @returns {Promise<string>}
 */
async function resizeImage(dataUrl, maxWidth, maxHeight) {
    // 检查是否在 Service Worker 环境 (无 DOM)
    if (typeof document === 'undefined') {
        return resizeImageOffscreen(dataUrl, maxWidth, maxHeight);
    }

    // 标准 DOM 环境直接处理
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            
            // 计算缩放比例
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }
            
            // 创建 canvas 缩放
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            resolve(canvas.toDataURL('image/jpeg', VISION_CONFIG.screenshotQuality / 100));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

/**
 * 通过 Offscreen Document 缩放图片 (用于 Background Service Worker)
 */
async function resizeImageOffscreen(dataUrl, maxWidth, maxHeight) {
    // 确保 offscreen document 存在
    await setupOffscreenDocument('offscreen.html');
    
    // 发送消息处理
    const response = await chrome.runtime.sendMessage({
        type: 'RESIZE_IMAGE',
        target: 'offscreen',
        data: {
            dataUrl,
            maxWidth,
            maxHeight,
            quality: VISION_CONFIG.screenshotQuality
        }
    });

    if (response.error) {
        throw new Error(response.error);
    }

    return response.dataUrl;
}

/**
 * 创建或获取 Offscreen Document
 */
let creatingOffscreenPromise = null;
async function setupOffscreenDocument(path) {
    // 检查是否已经存在
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return;
    }

    // 避免并发创建
    if (creatingOffscreenPromise) {
        await creatingOffscreenPromise;
        return;
    }

    creatingOffscreenPromise = chrome.offscreen.createDocument({
        url: path,
        reasons: ['BLOBS'],
        justification: 'Resize images for Vision AI processing'
    });

    await creatingOffscreenPromise;
    creatingOffscreenPromise = null;
}

/**
 * 截图并生成分析数据
 * @param {number} tabId 
 * @returns {Promise<Object>}
 */
async function captureAndAnalyze(tabId) {
    // 1. 截图
    const screenshot = await captureScreenshot(tabId, { resize: true });
    
    // 2. 获取精简 DOM 信息
    const domData = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            // 只获取关键信息
            const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden' && !el.disabled;
                })
                .slice(0, 15)
                .map(el => ({
                    type: el.type || el.tagName.toLowerCase(),
                    placeholder: el.placeholder,
                    id: el.id,
                    name: el.name,
                    ariaLabel: el.getAttribute('aria-label')
                }));
            
            const buttons = Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]'))
                .filter(el => {
                    const style = window.getComputedStyle(el);
                    const rect = el.getBoundingClientRect();
                    return style.display !== 'none' && rect.width > 0 && rect.height > 0;
                })
                .slice(0, 20)
                .map(el => ({
                    text: (el.innerText || el.value || el.title || '').substring(0, 30),
                    id: el.id,
                    type: el.tagName
                }));
            
            return {
                url: window.location.href,
                title: document.title,
                inputs,
                buttons,
                textSnippet: document.body.innerText.substring(0, 500)
            };
        }
    });
    
    return {
        screenshot,
        dom: domData[0]?.result || {},
        capturedAt: Date.now()
    };
}

/**
 * 视觉验证操作结果
 * @param {string} beforeScreenshot - 操作前截图
 * @param {string} afterScreenshot - 操作后截图
 * @param {string} expectedChange - 预期变化描述
 * @param {Object} apiConfig - API 配置
 * @returns {Promise<Object>}
 */
async function verifyStepResult(beforeScreenshot, afterScreenshot, expectedChange, apiConfig) {
    const prompt = `# 操作验证任务

请比较这两张截图，判断操作是否成功执行。

## 预期变化
${expectedChange}

## 判断标准
1. 页面是否发生了变化？
2. 变化是否符合预期？
3. 是否出现错误提示？

## 输出格式 (JSON)
{
  "success": true/false,
  "confidence": 0.0-1.0,
  "observedChanges": "实际观察到的变化",
  "issues": ["问题列表，如有"]
}`;

    const response = await callVisionAI(prompt, [beforeScreenshot, afterScreenshot], apiConfig);
    return parseVisionResponse(response);
}

/**
 * 通过自然语言描述定位元素
 * @param {string} screenshot - 当前页面截图
 * @param {string} description - 元素描述
 * @param {Object} domInfo - DOM 信息
 * @param {Object} apiConfig - API 配置
 * @returns {Promise<Object>}
 */
async function locateElementByDescription(screenshot, description, domInfo, apiConfig) {
    const prompt = `# 元素定位任务

我需要找到页面上的这个元素：
"${description}"

## 当前页面信息
- URL: ${domInfo.url}
- 标题: ${domInfo.title}

## 可用元素
### 输入框
${JSON.stringify(domInfo.inputs || [], null, 2)}

### 按钮/链接
${JSON.stringify(domInfo.buttons || [], null, 2)}

## 请根据截图和上述信息，返回最可能匹配的 CSS 选择器

输出格式 (JSON):
{
  "found": true/false,
  "selector": "CSS 选择器",
  "confidence": 0.0-1.0,
  "alternativeSelectors": ["备选选择器..."],
  "reasoning": "定位理由"
}`;

    const response = await callVisionAI(prompt, [screenshot], apiConfig);
    return parseVisionResponse(response);
}

/**
 * 调用 Vision AI
 * @param {string} prompt 
 * @param {string[]} images - Base64 图片数组
 * @param {Object} config 
 * @returns {Promise<string>}
 */
async function callVisionAI(prompt, images, config) {
    const { apiKey, providerUrl, modelName } = config;
    
    if (!apiKey) {
        throw new Error('API Key 未配置');
    }
    
    const endpoint = providerUrl || 'https://openrouter.ai/api/v1/chat/completions';
    
    // 构建带图片的消息内容
    const content = [
        { type: 'text', text: prompt }
    ];
    
    // 添加图片
    for (const img of images) {
        content.push({
            type: 'image_url',
            image_url: {
                url: img.startsWith('data:') ? img : `data:image/jpeg;base64,${img}`,
                detail: 'low' // 低精度节省 token
            }
        });
    }
    
    const requestBody = {
        model: modelName || 'google/gemini-2.0-flash-001',
        messages: [
            { role: 'system', content: '你是一个视觉分析专家，专门分析网页截图。只输出 JSON。' },
            { role: 'user', content: content }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
        temperature: 0.3
    };
    
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    if (data.error) {
        throw new Error(data.error.message || 'Vision API 错误');
    }
    
    return data.choices?.[0]?.message?.content || '';
}

/**
 * 解析 Vision AI 返回
 * @param {string} response 
 * @returns {Object}
 */
function parseVisionResponse(response) {
    try {
        // 处理可能的 markdown 代码块
        let jsonStr = response;
        const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1];
        }
        
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        
        throw new Error('未找到有效 JSON');
    } catch (e) {
        return {
            success: false,
            error: 'Failed to parse vision response: ' + e.message,
            rawResponse: response
        };
    }
}

/**
 * 智能元素修复 - 当选择器失效时使用视觉定位
 * @param {number} tabId 
 * @param {Object} failedStep - 失败的步骤
 * @param {Object} apiConfig 
 * @returns {Promise<Object>}
 */
async function repairSelector(tabId, failedStep, apiConfig) {
    console.log('🔧 尝试视觉修复选择器:', failedStep.target);
    
    // 1. 截图
    const { screenshot, dom } = await captureAndAnalyze(tabId);
    
    // 2. 使用视觉 AI 定位
    const description = failedStep.description || `${failedStep.action} 操作的目标元素`;
    const result = await locateElementByDescription(screenshot, description, dom, apiConfig);
    
    if (result.found && result.selector) {
        // 3. 验证新选择器是否有效
        const verifyResult = await chrome.scripting.executeScript({
            target: { tabId },
            func: (selector) => {
                const el = document.querySelector(selector);
                if (!el) return { valid: false };
                const style = window.getComputedStyle(el);
                return {
                    valid: style.display !== 'none' && style.visibility !== 'hidden',
                    tagName: el.tagName,
                    text: el.innerText?.substring(0, 30)
                };
            },
            args: [result.selector]
        });
        
        if (verifyResult[0]?.result?.valid) {
            return {
                success: true,
                newSelector: result.selector,
                alternativeSelectors: result.alternativeSelectors || [],
                confidence: result.confidence,
                reasoning: result.reasoning
            };
        }
    }
    
    // 尝试备选选择器
    if (result.alternativeSelectors?.length > 0) {
        for (const altSelector of result.alternativeSelectors) {
            const verifyResult = await chrome.scripting.executeScript({
                target: { tabId },
                func: (selector) => !!document.querySelector(selector),
                args: [altSelector]
            });
            
            if (verifyResult[0]?.result) {
                return {
                    success: true,
                    newSelector: altSelector,
                    confidence: result.confidence * 0.8,
                    reasoning: 'Used alternative selector'
                };
            }
        }
    }
    
    return {
        success: false,
        error: '视觉修复失败，无法定位元素',
        reasoning: result.reasoning
    };
}

/**
 * 获取页面状态摘要（用于任务完成验证）
 * @param {number} tabId 
 * @param {Object} apiConfig 
 * @returns {Promise<Object>}
 */
async function getPageStateSummary(tabId, apiConfig) {
    const { screenshot, dom } = await captureAndAnalyze(tabId);
    
    const prompt = `# 页面状态分析

请分析这个网页截图，简要描述：
1. 当前页面是什么页面？
2. 用户当前处于什么状态（已登录/未登录/操作成功/有错误等）？
3. 页面上最显著的信息是什么？

输出格式 (JSON):
{
  "pageType": "登录页/首页/搜索结果/错误页/等",
  "userState": "状态描述",
  "keyInfo": ["关键信息列表"],
  "hasError": true/false,
  "errorMessage": "如有错误，错误信息"
}`;

    const response = await callVisionAI(prompt, [screenshot], apiConfig);
    return parseVisionResponse(response);
}

// 导出
if (typeof self !== 'undefined') {
    self.Vision = {
        captureScreenshot,
        captureAndAnalyze,
        verifyStepResult,
        locateElementByDescription,
        repairSelector,
        getPageStateSummary,
        VISION_CONFIG
    };
}
