// ==========================================
// 🖥️ 悬浮状态栏 (Overlay)
// ==========================================

(function() {
    // 防止重复注入
    if (document.getElementById("ai-agent-overlay")) return;

    // 1. 创建容器
    const overlay = document.createElement("div");
    overlay.id = "ai-agent-overlay";
    overlay.style.position = "fixed";
    overlay.style.bottom = "20px";
    overlay.style.right = "20px";
    overlay.style.width = "300px";
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

    // 2. 内部结构
    overlay.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <strong style="color: #34C759;">🤖 AI Agent Working</strong>
            <span id="ai-spinner" style="font-size: 12px;">⏳</span>
        </div>
        <div id="ai-status-text" style="line-height: 1.4; color: #ddd;">
            正在初始化...
        </div>
    `;

    document.body.appendChild(overlay);

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
                    // 3秒后自动淡出? 不，让用户自己看一会儿
                } else if (request.text.includes("Error") || request.text.includes("❌")) {
                    overlay.style.backgroundColor = "rgba(255, 59, 48, 0.9)"; // Red
                    spinner.innerText = "❌";
                } else {
                    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.85)"; // Back to black
                    spinner.innerText = "⏳";
                }
            }
        }
        
        if (request.type === "SHOW_CONFIRM") {
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
