// 监听来自后台的消息
chrome.runtime.onMessage.addListener(handleMessages);

async function handleMessages(message, sender, sendResponse) {
    if (message.target !== 'offscreen') {
        return;
    }

    if (message.type === 'RESIZE_IMAGE') {
        resizeImage(message.data)
            .then(sendResponse)
            .catch((error) => sendResponse({ error: error.message }));
        return true; // 保持消息通道开启以进行异步响应
    }
}

async function resizeImage({ dataUrl, maxWidth, maxHeight, quality }) {
    try {
        const img = new Image();
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = dataUrl;
        });

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

        return {
            dataUrl: canvas.toDataURL('image/jpeg', quality / 100)
        };
    } catch (error) {
        throw new Error('Image resize failed: ' + error.message);
    }
}
