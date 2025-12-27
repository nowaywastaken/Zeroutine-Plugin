window.onerror = function(message, source, lineno, colno, error) {
  const errDiv = document.createElement('div');
  errDiv.style.color = 'red';
  errDiv.style.backgroundColor = '#ffeeee';
  errDiv.style.padding = '10px';
  errDiv.style.border = '1px solid red';
  errDiv.style.marginTop = '10px';
  errDiv.style.fontSize = '12px';
  errDiv.innerText = `🔥 ERROR: ${message} (${lineno}:${colno})`;
  document.body.prepend(errDiv);
};

// === i18n Helper Functions ===
function i18n(key) {
    return chrome.i18n.getMessage(key) || key;
}

function applyI18n() {
    // Apply text content translations
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = i18n(key);
        if (msg) el.textContent = msg;
    });
    // Apply placeholder translations
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = i18n(key);
        if (msg) el.placeholder = msg;
    });
}

// Apply i18n on load
applyI18n();

const writeBtn = document.getElementById("writeBtn");
const userPrompt = document.getElementById("userPrompt");
const statusDiv = document.getElementById("status");
const settingsBtn = document.getElementById("settingsBtn");

// === Mode Slider Logic ===
const modeRadios = document.querySelectorAll('input[name="mode"]');
function getSelectedMode() {
    for (const radio of modeRadios) {
        if (radio.checked) return radio.value;
    }
    return "AUTO";
}

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

// Toggle memory display
toggleMemoryBtn.addEventListener("click", () => {
    if (memoryArea.style.display === "none") {
        memoryArea.style.display = "block";
        toggleMemoryBtn.innerText = i18n("memoryBackpackHide");
    } else {
        memoryArea.style.display = "none";
        toggleMemoryBtn.innerText = i18n("memoryBackpack");
    }
});

// Save memory
saveMemoryBtn.addEventListener("click", () => {
    const memoryText = memoryContent.value;
    chrome.storage.local.set({ userMemory: memoryText }, () => {
        const originalText = saveMemoryBtn.innerText;
        saveMemoryBtn.innerText = i18n("memorySaved");
        setTimeout(() => { saveMemoryBtn.innerText = originalText; }, 1000);
    });
});

const stopBtn = document.getElementById("stopBtn");

// =========================================
// 新逻辑：发送指令给 Background
// =========================================

document.addEventListener('DOMContentLoaded', () => {
  console.log("Popup DOM Loaded");

  // Verify elements
  if (!writeBtn || !userPrompt || !statusDiv) {
      console.error("Critical elements missing");
      if(statusDiv) statusDiv.innerText = i18n("errorMissingElements");
      return;
  }

  // Remove old listeners? No, just add new safe one. 
  // Note: If reusing global vars, ensure we don't re-declare with const
  
  writeBtn.onclick = async () => {
      // DEBUG: Visual proof of click
      writeBtn.style.backgroundColor = "blue"; 
      writeBtn.innerText = "⚡️ CLICKED";
      console.log("Write Button Clicked");
      
      // Input validation
      const MAX_PROMPT_LENGTH = 2000;
      const prompt = userPrompt.value.trim();
      
      if (!prompt) {
        statusDiv.innerText = i18n("errorEnterCommand");
        writeBtn.style.backgroundColor = "#34C759";
        writeBtn.innerText = i18n("btnStartAITask") || "🚀 Start";
        return;
      }
      
      if (prompt.length > MAX_PROMPT_LENGTH) {
        statusDiv.innerText = `⚠️ Prompt too long (max ${MAX_PROMPT_LENGTH} chars)`;
        writeBtn.style.backgroundColor = "#34C759";
        writeBtn.innerText = i18n("btnStartAITask") || "🚀 Start";
        return;
      }
      
      try {
          writeBtn.disabled = true;
          stopBtn.style.display = "block"; 
          statusDiv.innerText = i18n("statusConnecting");
        
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab) throw new Error("No active tab found");

          console.log("Sending SMART_START...");
          chrome.runtime.sendMessage({
              type: "SMART_START",
              tabId: tab.id,
              prompt: prompt,
              mode: getSelectedMode()
          }, (response) => {
              console.log("Response received:", response);
              if (chrome.runtime.lastError) {
                  console.error("Runtime Error:", chrome.runtime.lastError);
                  statusDiv.innerText = i18n("errorConnectionFailed") + chrome.runtime.lastError.message;
                  writeBtn.disabled = false;
                  stopBtn.style.display = "none";
              } else {
                  console.log("Task Started OK");
                  statusDiv.innerText = i18n("statusTaskStarted");
                  pollStatus();
              }
          });
      } catch (e) {
          console.error("Click Handler Error:", e);
          statusDiv.innerText = i18n("errorPrefix") + e.message;
          writeBtn.disabled = false;
          stopBtn.style.display = "none";
      }
  };
});

stopBtn.addEventListener("click", () => {
    statusDiv.innerText = i18n("statusStopping");
    let stopped = false;

    // 1. Try to notify background politely
    chrome.runtime.sendMessage({ type: "STOP_TASK" }, (response) => {
        stopped = true;
        statusDiv.innerText = i18n("statusStopped");
        // Poll will update UI shortly
    });

    // 2. If background is dead (no response in 500ms), force reset
    setTimeout(() => {
        if (!stopped) {
            console.warn("Background unresponsive, force resetting state");
            statusDiv.innerText = i18n("statusForceResetting");
            
            // Directly modify Storage
            chrome.storage.local.set({ 
                "agentState": { 
                    active: false, 
                    stepInfo: i18n("zombieTask"),
                    lastPrompt: userPrompt.value
                } 
            }, () => {
                statusDiv.innerText = i18n("statusForceStopped");
                // Manually refresh UI
                writeBtn.disabled = false;
                writeBtn.innerText = i18n("btnStartAITask");
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
                writeBtn.innerText = i18n("statusTaskInProgress");
                stopBtn.style.display = "block";
            } else {
                // Not active
                stopBtn.style.display = "none";
                writeBtn.disabled = false;
                writeBtn.innerText = i18n("btnStartAITask");
                
                if (state.stepInfo.startsWith("✅")) {
                     statusDiv.innerText = state.stepInfo;
                     
                     if (!document.getElementById("convertBtn")) {
                         const btn = document.createElement("button");
                         btn.id = "convertBtn";
                         btn.innerText = i18n("btnSaveAsScript");
                         btn.style.marginTop = "8px";
                         btn.style.backgroundColor = "#FF9500"; // Orange
                         btn.style.fontSize = "12px";
                         btn.style.padding = "5px";
                         
                         btn.onclick = () => {
                             btn.innerText = i18n("generatingScript");
                             btn.disabled = true;
                             chrome.runtime.sendMessage({ type: "CONVERT_HISTORY_TO_SCRIPT" }, (res) => {
                                 if (res.status === "ok") {
                                     btn.innerText = i18n("scriptSaved");
                                     // Optional: switch to scripts tab?
                                     // tabBtnScripts.click(); 
                                     loadScriptsForCurrentTab();
                                 } else {
                                     btn.innerText = i18n("errorPrefix") + (res.error || "Unknown");
                                 }
                             });
                         };
                         
                         // Create a container to avoid text overwrite issues if we were to poll again
                         const container = document.createElement("div");
                         container.appendChild(btn);
                         statusDiv.appendChild(container);
                     }

                     clearInterval(window.statusInterval); 
                } else if (state.stepInfo.startsWith("⛔️")) {
                     statusDiv.innerText = state.stepInfo;
                } else {
                     // Avoid showing stale statuses like "Analyzing..."
                     statusDiv.innerText = i18n("statusReadyEmoji");
                }
            }
        });
    }, 1000);
}

// =========================================
// 📂 脚本管理逻辑 (折叠式)
// =========================================
const toggleScriptsBtn = document.getElementById("toggleScriptsBtn");
const scriptList = document.getElementById("scriptList");
const scriptCountBadge = document.getElementById("scriptCountBadge");

toggleScriptsBtn.addEventListener("click", () => {
    const isHidden = scriptList.style.display === "none";
    scriptList.style.display = isHidden ? "block" : "none";
});

// 打开 Popup 时除了 Check Status，也 Check Scripts
pollStatus();
loadScriptsForCurrentTab();

// =========================================
// 🔌 脚本管理逻辑
// =========================================
// 🔌 脚本管理逻辑
// =========================================
// const scriptList = document.getElementById("scriptList"); // Removed duplicate declaration
// No scriptPrompt or generateScriptBtn in new UI (merged)

async function loadScriptsForCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    scriptList.innerHTML = '<div style="text-align: center; color: #999;">' + i18n("checkingScripts") + '</div>';
    
    // We can't directly query background for "scripts for this tab" yet easily unless we send a message
    // simpler: just get all scripts and filter client side (OK for small number of scripts)
    const { userScripts } = await chrome.storage.local.get("userScripts");
    
    scriptList.innerHTML = "";
    let count = 0;

    if (userScripts) {
         try {
             const url = tab.url;
             const MAX_PATTERN_LENGTH = 500; // ReDoS protection
             
             userScripts.forEach(script => {
                  // Safe regex matching with error handling
                  try {
                      // Fix: Validate pattern before processing
                      if (!script.matches || typeof script.matches !== 'string' || script.matches.trim().length === 0) {
                          console.warn('Empty or invalid match pattern for script:', script.name);
                          return; // Skip this script
                      }
                      // ReDoS protection
                      if (script.matches.length > MAX_PATTERN_LENGTH) {
                          console.warn('Pattern too long for script:', script.name);
                          return;
                      }
                      const pattern = script.matches.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
                      const regex = new RegExp(`^${pattern}$`);
                      if (regex.test(url)) {
                      count++;
                      
                      // Safe DOM construction (no innerHTML with dynamic content)
                      const div = document.createElement("div");
                      div.style.cssText = "padding:8px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;";
                      
                      const nameSpan = document.createElement("span");
                      nameSpan.style.cssText = "font-weight:bold; font-size:13px;";
                      nameSpan.textContent = script.name; // Safe: textContent
                      
                      const btnContainer = document.createElement("div");
                      
                      const repairBtn = document.createElement("button");
                      repairBtn.className = "repair-btn";
                      repairBtn.dataset.id = script.id;
                      repairBtn.style.cssText = "width:auto; padding:3px 8px; font-size:10px; background:#FF9500; margin-right:5px; color:white; border:none; border-radius:4px; cursor:pointer;";
                      repairBtn.title = "Ask AI to fix this script";
                      repairBtn.textContent = i18n("btnFix");
                      
                      const delBtn = document.createElement("button");
                      delBtn.className = "del-btn";
                      delBtn.dataset.id = script.id;
                      delBtn.style.cssText = "width:auto; padding:3px 8px; font-size:10px; background:#FF3B30; color:white; border:none; border-radius:4px; cursor:pointer;";
                      delBtn.textContent = i18n("btnDelete");
                      
                      btnContainer.appendChild(repairBtn);
                      btnContainer.appendChild(delBtn);
                      div.appendChild(nameSpan);
                      div.appendChild(btnContainer);
                      scriptList.appendChild(div);
                      }
                  } catch (regexErr) {
                      console.error('Invalid match pattern:', script.matches, regexErr);
                  }
             });
         } catch(e) { console.error(e); }
    }
    
    if (count === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = "text-align: center; color: #999; font-size: 12px;";
        emptyDiv.textContent = i18n("noScriptsForPage");
        scriptList.appendChild(emptyDiv);
    }
    scriptCountBadge.innerText = count;

    // Add listeners
    document.querySelectorAll(".del-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const id = e.target.getAttribute("data-id");
            const { userScripts } = await chrome.storage.local.get("userScripts");
            const newScripts = userScripts.filter(s => s.id !== id);
            // Fix: Also remove the script code from storage to prevent leaks
            await chrome.storage.local.remove(`ujs_${id}`);
            await chrome.storage.local.set({ userScripts: newScripts });
            loadScriptsForCurrentTab();
        });
    });

    document.querySelectorAll(".repair-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
             const id = e.target.getAttribute("data-id");
             const complaint = prompt(i18n("fixPrompt"));
             if (complaint === null) return; // Cancelled



             statusDiv.innerText = i18n("analyzingFixing");
             const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
             
             chrome.runtime.sendMessage({
                 type: "REPAIR_SCRIPT",
                 tabId: tab.id,
                 scriptId: id,
                 complaint: complaint || "Script is not working as expected. Please fix selectors."
             }, (response) => {
                 if (response.status === "ok") {
                     alert(i18n("fixSuccess"));
                     chrome.tabs.reload(tab.id);
                     // window.close(); // Don't close, user might want to see
                     loadScriptsForCurrentTab();
                 } else {
                     alert(i18n("fixFailed") + response.error);
                 }
             });
        });
    });
}

// Remove old generateScriptBtn listeners since the button is removed from main UI
// Or if you want to keep the "Manual Generate" capability, you might need to add it back somewhere.
// But based on the "Unified UI", users should just use the main input with 'Script' mode.
// So we can remove the old listeners logic or keep it if hidden elements exist.
// Since we removed generateScriptBtn from HTML, we should remove this block to avoid errors.