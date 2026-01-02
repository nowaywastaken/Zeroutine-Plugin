// ==========================================
// 🖥️ 悬浮状态栏 (Overlay) + AI 思考流式显示
// ==========================================

(function() {
    // 防止重复注入
    if (document.getElementById("ai-agent-overlay")) return;

    // === 打字机效果状态 ===
    let typewriterQueue = [];
    let isTyping = false;
    let thinkingText = '';

    // 1. 创建容器
    const overlay = document.createElement("div");
    overlay.id = "ai-agent-overlay";
    overlay.style.position = "fixed";
    overlay.style.bottom = "20px";
    overlay.style.right = "20px";
    overlay.style.width = "320px";
    overlay.style.padding = "15px";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.85)";
    overlay.style.color = "#fff";
    overlay.style.borderRadius = "10px";
    overlay.style.fontFamily = "sans-serif";
    overlay.style.fontSize = "14px";
    overlay.style.boxShadow = "0 4px 15px rgba(0,0,0,0.3)";
    overlay.style.zIndex = "999999";
    overlay.style.transition = "all 0.3s ease";
    overlay.style.backdropFilter = "blur(10px)";
    overlay.style.border = "1px solid rgba(255,255,255,0.1)";

    // 2. 内部结构 - 添加思考区域
    overlay.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #34C759;">🤖 AI Agent Working</strong>
            <span id="ai-spinner" style="font-size: 12px;">⏳</span>
        </div>
        <div id="ai-status-text" style="line-height: 1.4; color: #ddd;">
            正在初始化...
        </div>
        <div id="ai-thinking-section" style="display: none; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
            <div id="ai-thinking-content" style="
                max-height: 200px;
                line-height: 1.5;
                font-size: 12px;
                font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
                background-color: #1e1e1e;
                color: #e0e0e0;
                padding: 10px;
                border-radius: 6px;
                overflow-y: auto;
                word-break: break-word;
                white-space: pre-wrap;
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
                border: 1px solid #333;
            "></div>
        </div>
        <style>
            #ai-thinking-content::-webkit-scrollbar { width: 6px; }
            #ai-thinking-content::-webkit-scrollbar-track { background: #1e1e1e; }
            #ai-thinking-content::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
            #ai-thinking-content::-webkit-scrollbar-thumb:hover { background: #777; }
        </style>
    `;

    document.body.appendChild(overlay);

    // === 打字机效果函数 ===
    function showThinkingSection() {
        const section = document.getElementById('ai-thinking-section');
        const content = document.getElementById('ai-thinking-content');
        if (section) {
            // 只有当区域未显示时才重置，防止流式更新时被清空
            if (section.style.display === 'none' || section.style.display === '') {
                section.style.display = 'block';
                thinkingText = '';
                typewriterQueue = [];
                isTyping = false;
                // 清空内容，无需光标
                if (content) content.innerHTML = '';
            }
        }
    }

    function hideThinkingSection() {
        const section = document.getElementById('ai-thinking-section');
        if (section) {
            section.style.display = 'none';
            thinkingText = '';
            typewriterQueue = [];
            isTyping = false;
        }
    }

    function appendThinkingText(newText) {
        const content = document.getElementById('ai-thinking-content');
        if (!content || !newText) return;
        
        for (const char of newText) {
            typewriterQueue.push(char);
        }
        
        if (!isTyping) {
            processTypewriterQueue();
        }
    }

    function processTypewriterQueue() {
        const content = document.getElementById('ai-thinking-content');
        if (!content || typewriterQueue.length === 0) {
            isTyping = false;
            return;
        }
        
        isTyping = true;
        const char = typewriterQueue.shift();
        thinkingText += char;
        
        // 转义 HTML
        const escapedText = thinkingText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
            
        // 直接设置内容，不带光标
        content.innerHTML = escapedText;
        
        // 自动滚动到底部
        content.scrollTop = content.scrollHeight;
        
        // 根据队列长度调整速度
        const delay = typewriterQueue.length > 50 ? 5 : (typewriterQueue.length > 20 ? 15 : 30);
        setTimeout(processTypewriterQueue, delay);
    }

    function finishThinking() {
        const content = document.getElementById('ai-thinking-content');
        if (content && thinkingText) {
            setTimeout(() => {
                const escapedText = thinkingText
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
                content.innerHTML = escapedText; // 移除光标
            }, 500);
        }
    }

    // 3. 监听消息来更新文字
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "UPDATE_OVERLAY") {
            const statusDiv = document.getElementById("ai-status-text");
            const spinner = document.getElementById("ai-spinner");
            
            if (statusDiv) {
                statusDiv.innerText = request.text;
                
                // 简单的视觉反馈
                if (request.text.includes("完成") || request.text.includes("✅")) {
                    overlay.style.backgroundColor = "rgba(52, 199, 89, 0.9)"; // Green
                    spinner.innerText = "✅";
                    hideThinkingSection(); // 完成时隐藏思考区域
                } else if (request.text.includes("Error") || request.text.includes("❌") || request.text.includes("⛔️")) {
                    overlay.style.backgroundColor = "rgba(255, 59, 48, 0.9)"; // Red
                    spinner.innerText = "❌";
                    hideThinkingSection(); // 错误时隐藏思考区域
                } else {
                    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.85)"; // Back to black
                    spinner.innerText = "⏳";
                }
            }
        }
        
        // === 新增：处理 AI 思考流式更新 ===
        if (request.type === "AI_THINKING_UPDATE") {
            showThinkingSection();
            if (request.content) {
                appendThinkingText(request.content);
            }
        }
        
        if (request.type === "AI_THINKING_DONE") {
            finishThinking();
        }
        
        if (request.type === "AI_THINKING_CLEAR") {
            hideThinkingSection();
        }
        
        if (request.type === "SHOW_CONFIRM") {
            hideThinkingSection(); // 确认对话框时隐藏思考区域
            const statusDiv = document.getElementById("ai-status-text");
            // Highlight Warning
            overlay.style.backgroundColor = "#FF9500"; // Orange
            if (statusDiv) {
                // Safe DOM manipulation (no innerHTML with dynamic content)
                statusDiv.textContent = ''; // Clear
                
                const msgDiv = document.createElement('div');
                msgDiv.style.fontWeight = 'bold';
                msgDiv.style.marginBottom = '5px';
                msgDiv.textContent = request.text; // Safe: textContent
                
                const btnContainer = document.createElement('div');
                btnContainer.style.cssText = 'display:flex; gap:10px; margin-top:5px;';
                
                const yesBtn = document.createElement('button');
                yesBtn.id = 'ai-confirm-yes';
                yesBtn.style.cssText = 'flex:1; background:white; color:#FF9500; border:none; border-radius:4px; padding:5px; cursor:pointer; font-weight:bold;';
                yesBtn.textContent = 'Yes';
                yesBtn.onclick = () => {
                    chrome.runtime.sendMessage({ type: "CONFIRM_RESULT", result: true });
                    statusDiv.textContent = "Switching...";
                };
                
                const noBtn = document.createElement('button');
                noBtn.id = 'ai-confirm-no';
                noBtn.style.cssText = 'flex:1; background:rgba(0,0,0,0.2); color:white; border:none; border-radius:4px; padding:5px; cursor:pointer;';
                noBtn.textContent = 'No';
                noBtn.onclick = () => {
                    chrome.runtime.sendMessage({ type: "CONFIRM_RESULT", result: false });
                    statusDiv.textContent = "Cancelled switch.";
                    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.85)"; // Reset
                };
                
                btnContainer.appendChild(yesBtn);
                btnContainer.appendChild(noBtn);
                statusDiv.appendChild(msgDiv);
                statusDiv.appendChild(btnContainer);
            }
        }
    });
})();
