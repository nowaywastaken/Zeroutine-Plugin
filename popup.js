// =================配置区域=================
const API_KEY = ''; // ⚠️ 记得填你的 Key
const API_URL = 'https://openrouter.ai/api/v1/chat/completions'; 
// =========================================

const writeBtn = document.getElementById("writeBtn");
const userPrompt = document.getElementById("userPrompt");
const statusDiv = document.getElementById("status");

writeBtn.addEventListener("click", async () => {
  const prompt = userPrompt.value;
  if (!prompt) {
    statusDiv.innerText = "⚠️ 请下达指令（比如：登录、搜索xx）";
    return;
  }
  
  writeBtn.disabled = true;

  try {
    statusDiv.innerText = "👀 侦察兵正在分析战场（找框+找按钮）...";
    
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // === 第一步：扫描全场（框 + 按钮 + 文字） ===
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: analyzePageElements, // 👈 升级版的侦察兵
    });

    const pageData = result[0].result;
    
    // === 第二步：制定作战计划 ===
    statusDiv.innerText = "🧠 指挥官正在制定计划...";
    
    const bgText = pageData.text.substring(0, 2000);
    // 把框和按钮的信息都发给 AI
    const uiContext = JSON.stringify({
        inputs: pageData.inputs,
        buttons: pageData.buttons
    });
    
    const fullPrompt = `
      【网页背景文字】：${bgText}
      
      【网页UI元素清单】：${uiContext}
      
      【用户指令】：${prompt}
      
      【任务】：
      1. 分析用户意图和网页内容。
      2. 决定需要填写的输入框 (fill)。
      3. 决定填写完毕后需要点击的按钮 (click)。请找到最像“提交/登录/搜索/下一步”的那个按钮。
      
      【输出格式】：
      请务必只返回纯 JSON，格式如下：
      {
        "fill": {"输入框ID或Name": "要填的内容", ...},
        "click": "按钮的ID或Name" (如果没有合适的按钮可点，这一个字段可以是 null)
      }
    `;

    const aiResponseText = await callAI(fullPrompt);
    console.log("AI计划：", aiResponseText);

    // === 第三步：执行计划（填表 + 点击） ===
    statusDiv.innerText = "⚡️ 正在执行自动化操作...";

    const cleanJson = aiResponseText.replace(/```json/g, "").replace(/```/g, "").trim();
    const actionPlan = JSON.parse(cleanJson);

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: executeActionPlan, // 👈 升级版的执行者
      args: [actionPlan]
    });

    statusDiv.innerText = "✅ 任务完成！";

  } catch (error) {
    console.error(error);
    statusDiv.innerText = "❌ 出错：" + error.message;
  } finally {
    writeBtn.disabled = false;
  }
});

// ==========================================
// 🕵️‍♂️ 侦察兵 v2.0：找输入框 + 找按钮
// ==========================================
function analyzePageElements() {
  const bodyText = document.body.innerText;

  // 1. 找输入框 (Inputs)
  const inputEls = document.querySelectorAll('input, textarea');
  const inputList = [];
  inputEls.forEach((el) => {
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'image' || el.disabled) return;
    inputList.push({
        key: el.name || el.id || ("idx_" + inputList.length), 
        placeholder: el.placeholder || "",
        label: el.previousElementSibling?.innerText || "" // 简单猜一下旁边的字
    });
  });

  // 2. 找按钮 (Buttons)
  // 我们找 <button>, <input type="submit">, 和长得像按钮的 <a>
  const btnEls = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, div[role="button"]');
  const btnList = [];
  btnEls.forEach((el, index) => {
    // 只有看得见的按钮才算
    if (el.offsetParent === null) return; 
    
    let btnText = el.innerText || el.value || el.title || "未命名按钮";
    // 截断太长的按钮文字
    btnText = btnText.substring(0, 20).replace(/\n/g, "");

    btnList.push({
        key: el.id || el.name || ("btn_idx_" + index), // 唯一标识
        text: btnText // 比如 "登录", "Submit", "搜索"
    });
  });

  return {
    text: bodyText,
    inputs: inputList,
    buttons: btnList
  };
}

// ==========================================
// ⚡️ 执行者 v2.0：先填后点
// ==========================================
function executeActionPlan(plan) {
  // 1. 填空
  if (plan.fill) {
    for (const [key, value] of Object.entries(plan.fill)) {
      let el = document.querySelector(`[name="${key}"], #${key}`);
      // 备用查找逻辑
      if (!el && key.startsWith("idx_")) {
          let idx = parseInt(key.split("_")[1]);
          let all = document.querySelectorAll('input, textarea'); // 重新获取列表
           // 这里的逻辑简化了，实际需要保证顺序一致，但在不动DOM的情况下通常没问题
          el = all[idx]; // ⚠️ 简化处理，假设顺序没变
      }

      if (el) {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.style.backgroundColor = "#e8f0fe"; 
      }
    }
  }

  // 2. 点击 (延时 500毫秒 再点，让网页反应一下)
  if (plan.click) {
      setTimeout(() => {
          let btn = document.getElementById(plan.click) || document.querySelector(`[name="${plan.click}"]`);
          
          // 如果是用 btn_idx_ 找的
          if (!btn && plan.click.startsWith("btn_idx_")) {
             let idx = parseInt(plan.click.split("_")[2]);
             let allBtns = document.querySelectorAll('button, input[type="submit"], input[type="button"], a.btn, div[role="button"]');
             // 再次过滤隐藏的，确保索引对应
             let visibleBtns = Array.from(allBtns).filter(b => b.offsetParent !== null);
             btn = visibleBtns[idx];
          }

          if (btn) {
              console.log("正在点击按钮：", btn);
              btn.style.border = "3px solid red"; // 🔴 点击前标红，让你看清楚点了谁
              btn.click();
          } else {
              console.log("找不到要点的按钮:", plan.click);
          }
      }, 500);
  }
}

// ==========================================
// 🧠 AI 呼叫函数 (Prompt 微调)
// ==========================================
async function callAI(prompt) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
      "HTTP-Referer": "https://localhost:3000",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      response_format: { type: "json_object" }, 
      messages: [
        { role: "system", content: "你是一个自动化操作助手。请输出纯 JSON。" },
        { role: "user", content: prompt }
      ]
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}