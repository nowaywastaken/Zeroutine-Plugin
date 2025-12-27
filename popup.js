const writeBtn = document.getElementById("writeBtn");
const userPrompt = document.getElementById("userPrompt");
const statusDiv = document.getElementById("status");
const settingsBtn = document.getElementById("settingsBtn");

const tabBtnAgent = document.getElementById("tabBtnAgent");
const tabBtnScripts = document.getElementById("tabBtnScripts");
const tabAgent = document.getElementById("tabAgent");
const tabScripts = document.getElementById("tabScripts");

// === Tab Switching Logic ===
tabBtnAgent.addEventListener("click", () => {
    tabAgent.style.display = "block";
    tabScripts.style.display = "none";
    tabBtnAgent.style.opacity = "1";
    tabBtnScripts.style.opacity = "0.5";
});

tabBtnScripts.addEventListener("click", () => {
    tabAgent.style.display = "none";
    tabScripts.style.display = "block";
    tabBtnAgent.style.opacity = "0.5";
    tabBtnScripts.style.opacity = "1";
    loadScriptsForCurrentTab();
});

if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    });
}

// === 🎒 记忆背包 UI 元素 (保持不变) ===
const toggleMemoryBtn = document.getElementById("toggleMemoryBtn");
const memoryArea = document.getElementById("memoryArea");
const memoryContent = document.getElementById("memoryContent");
const saveMemoryBtn = document.getElementById("saveMemoryBtn");

// 初始化：加载记忆
chrome.storage.local.get(["userMemory"], (result) => {
  if (result.userMemory) {
    memoryContent.value = result.userMemory;
  }
});

// 切换显示背包
toggleMemoryBtn.addEventListener("click", () => {
    if (memoryArea.style.display === "none") {
        memoryArea.style.display = "block";
        toggleMemoryBtn.innerText = "🎒 收起背包";
    } else {
        memoryArea.style.display = "none";
        toggleMemoryBtn.innerText = "🎒 我的记忆背包";
    }
});

// 保存记忆
saveMemoryBtn.addEventListener("click", () => {
    const memoryText = memoryContent.value;
    chrome.storage.local.set({ userMemory: memoryText }, () => {
        const originalText = saveMemoryBtn.innerText;
        saveMemoryBtn.innerText = "✅ 已保存";
        setTimeout(() => { saveMemoryBtn.innerText = originalText; }, 1000);
    });
});

const stopBtn = document.getElementById("stopBtn");

// =========================================
// 新逻辑：发送指令给 Background
// =========================================
writeBtn.addEventListener("click", async () => {
  const prompt = userPrompt.value;
  if (!prompt) {
    statusDiv.innerText = "⚠️ 请下达指令";
    return;
  }
  
  writeBtn.disabled = true;
  stopBtn.style.display = "block"; // 显示停止按钮
  statusDiv.innerText = "🚀 任务已发送给后台...";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  chrome.runtime.sendMessage({
      type: "START_TASK",
      tabId: tab.id,
      prompt: prompt
  }, (response) => {
      // ... same error handling ...
      if (chrome.runtime.lastError) {
          statusDiv.innerText = "❌ 无法连接后台: " + chrome.runtime.lastError.message;
          writeBtn.disabled = false;
          stopBtn.style.display = "none";
      } else {
          statusDiv.innerText = "✅ 任务开始！";
          pollStatus();
      }
  });
});

stopBtn.addEventListener("click", () => {
    statusDiv.innerText = "⛔️ 正在尝试停止...";
    let stopped = false;

    // 1. 尝试礼貌地通知后台
    chrome.runtime.sendMessage({ type: "STOP_TASK" }, (response) => {
        stopped = true;
        statusDiv.innerText = "✅ 已停止";
        // Poll 马上会更新 UI
    });

    // 2. 如果后台死了 (500ms 没回音)，直接暴力强制重置 (Force Kill)
    setTimeout(() => {
        if (!stopped) {
            console.warn("后台未响应，强制重置状态 (Force Kill)");
            statusDiv.innerText = "⚠️ 后台无响应，强制重置中...";
            
            // 直接操作 Storage
            chrome.storage.local.set({ 
                "agentState": { 
                    active: false, 
                    stepInfo: "⛔️ 任务已被强制终止 (Zombie Task)",
                    lastPrompt: userPrompt.value // 尽可能保留现场
                } 
            }, () => {
                statusDiv.innerText = "✅ 已强制终止";
                // 手动刷新一下 UI
                writeBtn.disabled = false;
                writeBtn.innerText = "让 AI 生成并填写";
                stopBtn.style.display = "none";
            });
        }
    }, 500);
});

function pollStatus() {
    // 避免重复轮询
    if (window.statusInterval) clearInterval(window.statusInterval);
    
    window.statusInterval = setInterval(() => {
        chrome.runtime.sendMessage({ type: "GET_STATUS" }, (state) => {
            if (!state) return;

            // 1. 自动填入上次的 Prompt（方便重试）
            if (state.lastPrompt && !userPrompt.value) {
                userPrompt.value = state.lastPrompt;
            }

            // 2. 更新按钮状态
            if (state.active) {
                statusDiv.innerText = state.stepInfo;
                writeBtn.disabled = true; 
                writeBtn.innerText = "⏳ 任务进行中...";
                stopBtn.style.display = "block"; // 🔴 显示停止
            } else {
                // Not active
                stopBtn.style.display = "none"; // 隐藏停止
                writeBtn.disabled = false;
                writeBtn.innerText = "让 AI 生成并填写";
                
                if (state.stepInfo.startsWith("✅")) {
                     statusDiv.innerText = state.stepInfo;
                     clearInterval(window.statusInterval); 
                } else if (state.stepInfo.startsWith("⛔️")) {
                     statusDiv.innerText = state.stepInfo;
                } else {
                     // 避免显示 "Analyzing..." 等陈旧状态
                     statusDiv.innerText = "✨ 准备就绪";
                }
            }
        });
    }, 1000);
}

// 打开 Popup 时立即检查一次状态
// 打开 Popup 时立即检查一次状态
pollStatus();

// =========================================
// 🔌 脚本管理逻辑
// =========================================
const scriptList = document.getElementById("scriptList");
const scriptPrompt = document.getElementById("scriptPrompt");
const generateScriptBtn = document.getElementById("generateScriptBtn");
const scriptStatus = document.getElementById("scriptStatus");

async function loadScriptsForCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    scriptList.innerHTML = '<div style="text-align: center; color: #999;">正在检查脚本...</div>';
    
    // We can't directly query background for "scripts for this tab" yet easily unless we send a message
    // simpler: just get all scripts and filter client side (OK for small number of scripts)
    const { userScripts } = await chrome.storage.local.get("userScripts");
    
    scriptList.innerHTML = "";
    let count = 0;

    if (userScripts) {
         try {
             const url = tab.url;
             userScripts.forEach(script => {
                  const pattern = script.matches.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
                  const regex = new RegExp(`^${pattern}$`);
                  if (regex.test(url)) {
                      count++;
                      const div = document.createElement("div");
                      div.style.padding = "8px";
                      div.style.borderBottom = "1px solid #eee";
                      div.style.display = "flex";
                      div.style.justifyContent = "space-between";
                      div.style.alignItems = "center";
                      
                      div.innerHTML = `
                        <span style="font-weight:bold; font-size:13px;">${script.name}</span>
                        <div>
                            <button class="repair-btn" data-id="${script.id}" style="width:auto; padding:3px 8px; font-size:10px; background:#FF9500; margin-right:5px;" title="让 AI 修复此脚本">🪄 修复</button>
                            <button class="del-btn" data-id="${script.id}" style="width:auto; padding:3px 8px; font-size:10px; background:#FF3B30;">删除</button>
                        </div>
                      `;
                      scriptList.appendChild(div);
                  }
             });
         } catch(e) { console.error(e); }
    }
    
    if (count === 0) {
        scriptList.innerHTML = '<div style="text-align: center; color: #999; font-size: 12px;">当前页面暂无脚本</div>';
    }

    // Add listeners
    document.querySelectorAll(".del-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const id = e.target.getAttribute("data-id");
            const { userScripts } = await chrome.storage.local.get("userScripts");
            const newScripts = userScripts.filter(s => s.id !== id);
            await chrome.storage.local.set({ userScripts: newScripts });
            loadScriptsForCurrentTab();
        });
    });

    document.querySelectorAll(".repair-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
             const id = e.target.getAttribute("data-id");
             const complaint = prompt("请简述问题 (例如: '颜色不对' 或 '没反应')，留空则让 AI 自己检查:");
             if (complaint === null) return; // Cancelled

             scriptStatus.innerText = "⏳ 正在分析修复...";
             const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
             
             chrome.runtime.sendMessage({
                 type: "REPAIR_SCRIPT",
                 tabId: tab.id,
                 scriptId: id,
                 complaint: complaint || "Script is not working as expected. Please fix selectors."
             }, (response) => {
                 if (response.status === "ok") {
                     alert("✅ 修复完成！页面将自动刷新。");
                     chrome.tabs.reload(tab.id);
                     window.close(); // Close popup
                 } else {
                     scriptStatus.innerText = "❌ 修复失败: " + response.error;
                 }
             });
        });
    });
}

generateScriptBtn.addEventListener("click", async () => {
    const prompt = scriptPrompt.value;
    if (!prompt) {
        scriptStatus.innerText = "⚠️ 请输入描述";
        return;
    }
    
    scriptStatus.innerText = "⏳ 正在生成...";
    generateScriptBtn.disabled = true;
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({
        type: "GENERATE_SCRIPT",
        tabId: tab.id,
        url: tab.url,
        prompt: prompt
    }, (response) => {
        generateScriptBtn.disabled = false;
        if (chrome.runtime.lastError) {
             scriptStatus.innerText = "❌ Error: " + chrome.runtime.lastError.message;
        } else if (response.status === "ok") {
             scriptStatus.innerText = "✅ 脚本已生成并保存！";
             loadScriptsForCurrentTab();
             scriptPrompt.value = "";
        } else {
             scriptStatus.innerText = "❌ " + (response.error || "未知错误");
        }
    });
});