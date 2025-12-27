// 保存设置
const saveBtn = document.getElementById('saveBtn');
const apiKeyInput = document.getElementById('apiKey');
const statusDiv = document.getElementById('status');

// 初始化：加载现有的 Key
// 初始化：加载现有的 Key & Scripts
chrome.storage.local.get(['apiKey', 'userScripts'], (result) => {
    if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
    }
    renderScripts(result.userScripts || []);
});

saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    
    if (!key) {
        showStatus('❌ API Key 不能为空', 'error');
        return;
    }

    if (!key.startsWith('sk-orn-') && !key.startsWith('sk-or-')) { 
        // 简单的格式校验，OpenRouter Key 通常以 sk-or- 开头，但也不绝对，仅作为提示
        // 这里不做强校验，以免误杀
    }

    chrome.storage.local.set({ apiKey: key }, () => {
        showStatus('✅ 设置已保存', 'success');
        setTimeout(() => {
            statusDiv.innerText = '';
        }, 2000);
    });
});

function showStatus(msg, type) {
    statusDiv.textContent = msg;
    statusDiv.className = type;
}

// ===========================
// 📜 脚本管理逻辑 (Advanced)
// ===========================
const scriptContainer = document.getElementById("scriptContainer");

function renderScripts(scripts) {
    if (!scripts || scripts.length === 0) {
        scriptContainer.innerHTML = '<p style="color:#999; text-align:center; padding-top:20px;">还没有生成过任何脚本</p>';
        return;
    }

    scriptContainer.innerHTML = "";
    // Show newest first
    scripts.sort((a,b) => b.createdAt - a.createdAt).forEach(script => {
        const item = document.createElement("div");
        item.className = "script-item";
        
        const enabled = script.enabled !== false; // default true
        const statusBadge = enabled 
            ? '<span class="badge badge-on">ON</span>' 
            : '<span class="badge badge-off">OFF</span>';
            
        // Header
        const header = document.createElement("div");
        header.className = "script-header";
        header.innerHTML = `
            <div style="display:flex; align-items:center;">
                <span style="font-weight:bold; font-size:14px; color:#333;">${script.name}</span>
                ${statusBadge}
            </div>
            <div style="font-size:12px; color:#999;">${new Date(script.createdAt).toLocaleDateString()} ▼</div>
        `;
        header.onclick = (e) => {
            // toggle body
            const body = item.querySelector(".script-body");
            if(body.style.display === "block") {
                body.style.display = "none";
                header.querySelector("div:last-child").innerText = new Date(script.createdAt).toLocaleDateString() + " ▼";
            } else {
                body.style.display = "block";
                header.querySelector("div:last-child").innerText = "▲";
            }
        };

        // Body
        const body = document.createElement("div");
        body.className = "script-body";
        body.innerHTML = `
            <div class="editor-label">匹配规则 (Match Pattern)</div>
            <input type="text" class="input-sm matches-input" value="${script.matches}">
            
            <div class="editor-label">代码 (Javascript)</div>
            <textarea class="code-editor" spellcheck="false">${script.code}</textarea>
            
            <div class="action-row">
                 <button class="btn-sm" style="background:${enabled ? '#FF9500' : '#34C759'}" id="toggle-${script.id}">
                    ${enabled ? '禁用 (Disable)' : '启用 (Enable)'}
                 </button>
                 <button class="btn-sm" style="background:#FF3B30;" id="del-${script.id}">删除</button>
                 <button class="btn-sm" style="background:#007AFF;" id="save-${script.id}">保存修改</button>
            </div>
        `;
        
        item.appendChild(header);
        item.appendChild(body);
        scriptContainer.appendChild(item);
        
        // Bind Events
        item.querySelector(`#save-${script.id}`).onclick = () => {
            const newMatches = body.querySelector(".matches-input").value;
            const newCode = body.querySelector(".code-editor").value;
            updateScript(script.id, { matches: newMatches, code: newCode });
        };
        
        item.querySelector(`#del-${script.id}`).onclick = () => deleteScript(script.id);
        
        item.querySelector(`#toggle-${script.id}`).onclick = () => {
             updateScript(script.id, { enabled: !enabled });
        };
    });
}

function updateScript(id, changes) {
    chrome.storage.local.get("userScripts", (result) => {
        const scripts = result.userScripts || [];
        const index = scripts.findIndex(s => s.id === id);
        if (index !== -1) {
            // Apply changes
            scripts[index] = { ...scripts[index], ...changes };
            chrome.storage.local.set({ userScripts: scripts }, () => {
                showStatus('✅ 更新成功', 'success');
                renderScripts(scripts); // Re-render to show changes
            });
        }
    });
}

function deleteScript(id) {
    if (!confirm("确定要删除这个脚本吗?")) return;
    
    chrome.storage.local.get("userScripts", (result) => {
        const scripts = result.userScripts || [];
        const newScripts = scripts.filter(s => s.id !== id);
        chrome.storage.local.set({ userScripts: newScripts }, () => {
            renderScripts(newScripts);
            showStatus('🗑️ 脚本已删除', 'success');
        });
    });
}
