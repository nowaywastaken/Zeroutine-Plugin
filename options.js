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

// Settings
const saveBtn = document.getElementById('saveBtn');
const apiKeyInput = document.getElementById('apiKey');
const providerUrlInput = document.getElementById('providerUrl');
const modelNameInput = document.getElementById('modelName');
const statusDiv = document.getElementById('status');

// Initialize: Load existing Key & Scripts & Model Config
chrome.storage.local.get(['apiKey', 'userScripts', 'providerUrl', 'modelName'], (result) => {
    if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
    }
    // Set values or defaults
    providerUrlInput.value = result.providerUrl || "https://openrouter.ai/api/v1/chat/completions";
    modelNameInput.value = result.modelName || "google/gemini-2.5-flash";
    
    renderScripts(result.userScripts || []);
});

saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    let url = providerUrlInput.value.trim();
    let model = modelNameInput.value.trim();
    
    // Defaults if empty
    if (!url) url = "https://openrouter.ai/api/v1/chat/completions";
    if (!model) model = "google/gemini-2.5-flash";

    if (!key) {
        showStatus(i18n('errorApiKeyEmpty'), 'error');
        return;
    }

    chrome.storage.local.set({ 
        apiKey: key,
        providerUrl: url,
        modelName: model
    }, () => {
        showStatus(i18n('settingsSaved'), 'success');
        
        // Update input values to reflect defaults if they were empty
        providerUrlInput.value = url;
        modelNameInput.value = model;
    });
});

function showStatus(msg, type) {
    // 1. Update legacy div if visible (optional, but good for accessibility/fallback)
    if(statusDiv && statusDiv.offsetParent !== null) {
        statusDiv.textContent = msg;
        statusDiv.className = type;
        setTimeout(() => statusDiv.textContent = '', 3000);
    }

    // 2. Show Floating Toast
    const existing = document.querySelector('.toast-notification');
    if(existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);

    // Trigger animation
    // Use requestAnimationFrame to ensure DOM insertion is done before adding class
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===========================
// 📑 Tab Logic
// ===========================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active from all
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    
    // Add active to current
    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});


// ===========================
// 📜 脚本管理逻辑 (Advanced)
// ===========================
const scriptContainer = document.getElementById("scriptContainer");

function renderScripts(scripts) {
    if (!scripts || scripts.length === 0) {
        scriptContainer.innerHTML = '<p style="color:#999; text-align:center; padding-top:20px;">' + i18n('noScriptsYet') + '</p>';
        return;
    }

    scriptContainer.innerHTML = "";
    // Show newest first
    scripts.sort((a,b) => b.createdAt - a.createdAt).forEach(script => {
        const item = document.createElement("div");
        item.className = "script-item";
        
        const enabled = script.enabled !== false; // default true
            
        // Header - Safe DOM construction
        const header = document.createElement("div");
        header.className = "script-header";
        
        const headerLeft = document.createElement("div");
        headerLeft.style.cssText = "display:flex; align-items:center;";
        
        const nameSpan = document.createElement("span");
        nameSpan.style.cssText = "font-weight:bold; font-size:14px; color:#333;";
        nameSpan.textContent = script.name; // Safe: textContent
        
        const badge = document.createElement("span");
        badge.className = enabled ? "badge badge-on" : "badge badge-off";
        badge.textContent = enabled ? "ON" : "OFF";
        
        headerLeft.appendChild(nameSpan);
        headerLeft.appendChild(badge);
        
        const headerRight = document.createElement("div");
        headerRight.style.cssText = "font-size:12px; color:#999;";
        headerRight.textContent = new Date(script.createdAt).toLocaleDateString() + " ▼";
        
        header.appendChild(headerLeft);
        header.appendChild(headerRight);

        // Body - Safe DOM construction
        const body = document.createElement("div");
        body.className = "script-body";
        
        // Match pattern section
        const matchLabel = document.createElement("div");
        matchLabel.className = "editor-label";
        matchLabel.textContent = i18n('labelMatchPattern');
        
        const matchInput = document.createElement("input");
        matchInput.type = "text";
        matchInput.className = "input-sm matches-input";
        matchInput.value = script.matches || '';
        
        // Code section
        const codeLabel = document.createElement("div");
        codeLabel.className = "editor-label";
        codeLabel.textContent = i18n('labelCode');
        
        const codeEditor = document.createElement("div");
        codeEditor.className = "code-editor language-javascript";
        codeEditor.style.cssText = "overflow:auto; resize:vertical;";
        codeEditor.textContent = i18n('loading');
        
        // History section
        const historySection = document.createElement("div");
        historySection.style.marginTop = "10px";
        
        const historyToggle = document.createElement("a");
        historyToggle.href = "#";
        historyToggle.style.cssText = "font-size:12px; color:#007AFF; text-decoration:none;";
        historyToggle.id = `toggle-history-${script.id}`;
        historyToggle.textContent = i18n('viewHistory');
        
        const historyList = document.createElement("div");
        historyList.className = "history-list";
        historyList.id = `history-list-${script.id}`;
        historyList.textContent = i18n('loading');
        
        historySection.appendChild(historyToggle);
        historySection.appendChild(historyList);
        
        // Action row
        const actionRow = document.createElement("div");
        actionRow.className = "action-row";
        
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "btn-sm";
        toggleBtn.style.background = enabled ? '#FF9500' : '#34C759';
        toggleBtn.id = `toggle-${script.id}`;
        toggleBtn.textContent = enabled ? i18n('btnDisable') : i18n('btnEnable');
        
        const delBtn = document.createElement("button");
        delBtn.className = "btn-sm";
        delBtn.style.background = "#FF3B30";
        delBtn.id = `del-${script.id}`;
        delBtn.textContent = i18n('btnDelete');
        
        const saveBtn = document.createElement("button");
        saveBtn.className = "btn-sm";
        saveBtn.style.background = "#007AFF";
        saveBtn.id = `save-${script.id}`;
        saveBtn.textContent = i18n('btnSaveChanges');
        
        actionRow.appendChild(toggleBtn);
        actionRow.appendChild(delBtn);
        actionRow.appendChild(saveBtn);
        
        // Assemble body
        body.appendChild(matchLabel);
        body.appendChild(matchInput);
        body.appendChild(codeLabel);
        body.appendChild(codeEditor);
        body.appendChild(historySection);
        body.appendChild(actionRow);
        
        item.appendChild(header);
        item.appendChild(body);
        scriptContainer.appendChild(item);
        
        // Lazy Load Code & History on toggle
        let codeLoaded = false;
        let jar = null;

        const toggleBody = async () => {
            if(body.style.display === "block") {
                body.style.display = "none";
                header.querySelector("div:last-child").innerText = new Date(script.createdAt).toLocaleDateString() + " ▼";
            } else {
                body.style.display = "block";
                header.querySelector("div:last-child").innerText = "▲";
                
                if (!codeLoaded) {
                     const key = `ujs_${script.id}`;
                     const res = await chrome.storage.local.get(key);
                     const code = res[key] || "// No code found";
                     
                     const editorEl = body.querySelector(".code-editor");
                     // Init CodeJar
                     jar = CodeJar(editorEl, (el) => {
                        // Prism highlight
                        if (window.Prism) {
                             el.innerHTML = Prism.highlight(el.textContent, Prism.languages.javascript, 'javascript');
                        } else {
                             el.textContent = el.textContent;
                        }
                     });
                     
                     jar.updateCode(code);
                     
                     // Render History List
                     renderHistoryList(script, body.querySelector(".history-list"), jar);
                     
                     codeLoaded = true;
                }
            }
        }; 
        
        header.onclick = toggleBody;

        // Toggle History Visibility
        item.querySelector(`#toggle-history-${script.id}`).onclick = (e) => {
            e.preventDefault();
            const list = item.querySelector(`#history-list-${script.id}`);
            list.style.display = list.style.display === "block" ? "none" : "block";
        };
        item.querySelector(`#save-${script.id}`).onclick = () => {
            let newMatches = body.querySelector(".matches-input").value;
            const newCode = jar ? jar.toString() : ""; // get code from jar
            
            // Metadata Parsing Integration
            const meta = parseMetadata(newCode);
            let updates = { code: newCode };
            
            if (meta) {
                if (meta.name) updates.name = meta.name;
                if (meta.match) {
                    updates.matches = meta.match; // Overwrite matches if found in code
                    newMatches = meta.match; // Update local var for UI consistency if needed
                }
                showStatus(i18n('metadataParsed'), 'success');
            }
            // Always take manual matches input if metadata didn't overwrite it OR let metadata win. 
            // Strategy: logic above lets metadata win if present. If not, use input.
            if (!meta || !meta.match) {
                updates.matches = newMatches; 
            }

            updateScript(script.id, updates);
        };
        
        item.querySelector(`#del-${script.id}`).onclick = () => deleteScript(script.id);
        
        item.querySelector(`#toggle-${script.id}`).onclick = () => {
             updateScript(script.id, { enabled: !enabled });
        };
    });
}

// Update logic (Complex Split Save with History)
async function updateScript(id, changes) {
    const { userScripts } = await chrome.storage.local.get("userScripts");
    const scripts = userScripts || [];
    const index = scripts.findIndex(s => s.id === id);
    
    if (index !== -1) {
        const writes = {};
        let currentScript = scripts[index];

        // 1. Separate Code changes & Push History
        if (changes.code !== undefined) {
            // A. Get Old Code first
            const oldKey = `ujs_${id}`;
            const oldData = await chrome.storage.local.get(oldKey);
            const oldCode = oldData[oldKey] || "";

            // B. Push to History
            if (!currentScript.history) currentScript.history = [];
            currentScript.history.unshift({
                // versionId: crypto.randomUUID(), // simple timestamp is enough for now
                timestamp: Date.now(),
                code: oldCode,
                reason: "Manual Edit"
            });
            // Limit history
            if(currentScript.history.length > 15) currentScript.history = currentScript.history.slice(0, 15);

            writes[oldKey] = changes.code;
            delete changes.code; 
        }

        // 2. Update Metadata
        scripts[index] = { ...currentScript, ...changes, updatedAt: Date.now() };
        writes["userScripts"] = scripts;

        await chrome.storage.local.set(writes);
        showStatus(i18n('updateSuccess'), 'success');
        renderScripts(scripts); 
    }
}

function renderHistoryList(script, listContainer, editor) {
    const history = script.history || [];
    if (history.length === 0) {
        listContainer.textContent = '';
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'padding:10px; color:#999; text-align:center;';
        emptyDiv.textContent = i18n('noHistoryVersions');
        listContainer.appendChild(emptyDiv);
        return;
    }

    listContainer.innerHTML = "";
    history.forEach((h, idx) => {
        const row = document.createElement("div");
        row.className = "history-item";
        
        const dateStr = new Date(h.timestamp).toLocaleString();
        const reason = h.reason || "Update";
        
        // Safe DOM construction
        const infoDiv = document.createElement("div");
        
        const indexSpan = document.createElement("span");
        indexSpan.className = "history-meta";
        indexSpan.textContent = `${idx + 1}. `;
        
        const reasonSpan = document.createElement("span");
        reasonSpan.style.cssText = "font-weight:bold; color:#555;";
        reasonSpan.textContent = reason; // Safe: textContent
        
        const dateDiv = document.createElement("div");
        dateDiv.className = "history-meta";
        dateDiv.style.fontSize = "10px";
        dateDiv.textContent = dateStr;
        
        infoDiv.appendChild(indexSpan);
        infoDiv.appendChild(reasonSpan);
        infoDiv.appendChild(dateDiv);
        
        const rollbackBtn = document.createElement("button");
        rollbackBtn.className = "btn-sm";
        rollbackBtn.style.cssText = "background:#5856D6; padding:2px 8px; font-size:10px;";
        rollbackBtn.textContent = i18n('btnRollback');
        
        row.appendChild(infoDiv);
        row.appendChild(rollbackBtn);
        
        rollbackBtn.onclick = async () => {
            if(!confirm(i18n('confirmRollback'))) return;
            
            // Rollback Logic
            // We just update the editor value and let user click save, 
            // OR we assume rollback means "save immediately". 
            // Let's do save immediately for convenience.
            
            await updateScript(script.id, { 
                code: h.code, 
                // Don't pollute history with a separate "rollback" entry? 
                // Actually updateScript will allow it as "Manual Edit". That's fine.
            });
            
            // Refresh editor
            if (editor && editor.updateCode) {
                 editor.updateCode(h.code);
            } else if (editor) {
                 // Fallback if editor was passed as element (should not happen with new logic)
                 editor.value = h.code;
            }
        };
        
        listContainer.appendChild(row);
    });
}

function deleteScript(id) {
    if (!confirm(i18n('confirmDelete'))) return;
    
    chrome.storage.local.get("userScripts", (result) => {
        const scripts = result.userScripts || [];
        const newScripts = scripts.filter(s => s.id !== id);
        
        // Remove code as well
        chrome.storage.local.remove(`ujs_${id}`);
        
        chrome.storage.local.set({ userScripts: newScripts }, () => {
            renderScripts(newScripts);
            showStatus(i18n('scriptDeleted'), 'success');
        });
    });
}

// 🛠 Helper: Parse Tampermonkey Metadata
function parseMetadata(code) {
    const blockMatch = code.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
    if (!blockMatch) return null;
    
    const block = blockMatch[1];
    const result = {};
    
    // Parse @name
    const nameMatch = block.match(/@name\s+(.*)/);
    if (nameMatch) result.name = nameMatch[1].trim();
    
    // Parse @match (Take the first one found for now)
    const matchMatch = block.match(/@match\s+(.*)/);
    if (matchMatch) result.match = matchMatch[1].trim();

    // Parse @include as fallback
    if (!result.match) {
         const includeMatch = block.match(/@include\s+(.*)/);
         if (includeMatch) result.match = includeMatch[1].trim();
    }
    
    return Object.keys(result).length > 0 ? result : null;
}

// ===========================
// 🧠 记忆管理逻辑
// ===========================

// 初始化时加载记忆统计
document.addEventListener('DOMContentLoaded', () => {
    loadMemoryStats();
});

// 切换到 Memory 标签时刷新
document.querySelector('[data-tab="memory"]')?.addEventListener('click', () => {
    setTimeout(loadMemoryStats, 100);
});

async function loadMemoryStats() {
    const MEMORY_STORAGE_KEY = 'projectMemory';
    const data = await chrome.storage.local.get(MEMORY_STORAGE_KEY);
    const store = data[MEMORY_STORAGE_KEY] || { domains: {} };
    
    // 计算统计
    let totalSelectors = 0;
    let totalTemplates = 0;
    const domainList = [];
    
    for (const [domain, memory] of Object.entries(store.domains || {})) {
        const selectorCount = Object.keys(memory.selectorPatterns || {}).length;
        const templateCount = Object.keys(memory.taskTemplates || {}).length;
        
        totalSelectors += selectorCount;
        totalTemplates += templateCount;
        
        domainList.push({
            domain,
            selectors: selectorCount,
            templates: templateCount,
            lastAccessed: memory.lastAccessed
        });
    }
    
    // 按最近访问排序
    domainList.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    
    // 更新统计数字
    document.getElementById('statDomains').textContent = domainList.length;
    document.getElementById('statSelectors').textContent = totalSelectors;
    document.getElementById('statTemplates').textContent = totalTemplates;
    
    // 渲染域名列表
    const listContainer = document.getElementById('domainList');
    listContainer.innerHTML = '';
    
    if (domainList.length === 0) {
        listContainer.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">暂无记忆数据</p>';
        return;
    }
    
    domainList.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f0f0f0;';
        
        const leftDiv = document.createElement('div');
        
        const domainSpan = document.createElement('span');
        domainSpan.style.cssText = 'font-weight: 500; color: #333;';
        domainSpan.textContent = item.domain;
        
        const metaDiv = document.createElement('div');
        metaDiv.style.cssText = 'font-size: 11px; color: #999; margin-top: 3px;';
        const lastAccess = item.lastAccessed ? new Date(item.lastAccessed).toLocaleDateString() : '未知';
        metaDiv.textContent = `${item.selectors} 选择器 · ${item.templates} 模板 · 最后访问: ${lastAccess}`;
        
        leftDiv.appendChild(domainSpan);
        leftDiv.appendChild(metaDiv);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-sm';
        deleteBtn.style.cssText = 'background: #FF3B30; padding: 4px 8px; font-size: 11px;';
        deleteBtn.textContent = '删除';
        deleteBtn.onclick = async () => {
            if (!confirm(`确定删除 ${item.domain} 的所有记忆？`)) return;
            
            const freshData = await chrome.storage.local.get(MEMORY_STORAGE_KEY);
            const freshStore = freshData[MEMORY_STORAGE_KEY] || { domains: {} };
            delete freshStore.domains[item.domain];
            await chrome.storage.local.set({ [MEMORY_STORAGE_KEY]: freshStore });
            
            showStatus('已删除域名记忆', 'success');
            loadMemoryStats();
        };
        
        row.appendChild(leftDiv);
        row.appendChild(deleteBtn);
        listContainer.appendChild(row);
    });
}

// 导出记忆
document.getElementById('exportMemoryBtn')?.addEventListener('click', async () => {
    const MEMORY_STORAGE_KEY = 'projectMemory';
    const data = await chrome.storage.local.get(MEMORY_STORAGE_KEY);
    const store = data[MEMORY_STORAGE_KEY] || { domains: {} };
    
    const exportData = {
        version: 1,
        exportedAt: Date.now(),
        domains: store.domains
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `zeroutine-memory-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    showStatus('记忆已导出', 'success');
});

// 导入记忆
document.getElementById('importMemoryBtn')?.addEventListener('click', () => {
    document.getElementById('memoryFileInput')?.click();
});

document.getElementById('memoryFileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        const imported = JSON.parse(text);
        
        if (!imported.domains) {
            throw new Error('无效的记忆数据格式');
        }
        
        const MEMORY_STORAGE_KEY = 'projectMemory';
        const data = await chrome.storage.local.get(MEMORY_STORAGE_KEY);
        const store = data[MEMORY_STORAGE_KEY] || { version: 1, domains: {} };
        
        // 合并
        for (const [domain, memory] of Object.entries(imported.domains)) {
            if (store.domains[domain]) {
                store.domains[domain].selectorPatterns = {
                    ...store.domains[domain].selectorPatterns,
                    ...memory.selectorPatterns
                };
                store.domains[domain].taskTemplates = {
                    ...store.domains[domain].taskTemplates,
                    ...memory.taskTemplates
                };
            } else {
                store.domains[domain] = memory;
            }
        }
        
        await chrome.storage.local.set({ [MEMORY_STORAGE_KEY]: store });
        showStatus(`已导入 ${Object.keys(imported.domains).length} 个域名的记忆`, 'success');
        loadMemoryStats();
    } catch (err) {
        showStatus('导入失败: ' + err.message, 'error');
    }
    
    // 清空 input
    e.target.value = '';
});

// 清除全部记忆
document.getElementById('clearMemoryBtn')?.addEventListener('click', async () => {
    if (!confirm('确定清除所有项目记忆？此操作不可撤销！')) return;
    
    await chrome.storage.local.remove('projectMemory');
    showStatus('已清除所有记忆', 'success');
    loadMemoryStats();
});
