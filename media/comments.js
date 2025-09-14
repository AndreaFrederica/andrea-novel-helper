/* eslint-disable curly */
// media/comments.js
(() => {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
  
  // 安全的消息发送函数
  function postMessage(msg) {
    if (!vscode) {
      console.warn('VSCode API not available:', msg);
      return false;
    }
    try {
      console.log('Sending message:', msg);
      vscode.postMessage(msg);
      return true;
    } catch (err) {
      console.error('Failed to send message:', err, msg);
      return false;
    }
  }
  const root = document.getElementById('root');
  const track = document.getElementById('track');
  const searchEl = document.getElementById('search');
  const filterEl = document.getElementById('filter');
  let lineHeight = 20; // px
  let totalLines = 1;
  let items = []; // [{id,status,start,end,body}]
  let docUri = '';
  // Persisted collapsed state per doc
  let state = (vscode && vscode.getState && vscode.getState()) || {};
  let collapsedByDoc = state.collapsedByDoc || {};
  let syncing = false;
  // 滚动防抖相关变量（优化性能）
  let scrollTimeout = null;
  let lastScrollTime = 0;
  const SCROLL_DEBOUNCE_MS = 0; // 移除防抖延迟，实现即时响应
  let maxTop = 0; // 最大可达顶部行（用于 1:1 高度）
  // 程序驱动的滚动同步控制
  let syncingUntil = 0;
  const PROGRAM_SYNC_MIN = 120; // ms
  const PROGRAM_SYNC_MAX = 400; // ms
  const USER_SCROLL_SUPPRESS_MS = 800; // 用户在面板中滚动时，抑制一段时间内来自编辑器的滚动同步，避免回拉
  
  // 焦点感知相关变量
  let panelHasFocus = false;
  let panelHasMouseOver = false;
  let lastUserInteraction = 0;
  let suppressUntil = 0; // 抑制编辑器滚动同步的截止时间
  
  // 添加平滑滚动样式
  if (root) {
    root.style.scrollBehavior = 'smooth';
  }

  function clear() { while (track.firstChild) track.removeChild(track.firstChild); }

  function render() {
    clear();
    if (!items.length) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.textContent = '暂无批注';
      track.appendChild(div);
      return;
    }
    // 1:1 高度：scrollHeight = maxTop*lh + viewport
    const contentHeight = Math.max(0, Math.round(maxTop * lineHeight + root.clientHeight));
    track.style.height = contentHeight + 'px';
    // 过滤搜索
    const query = (searchEl && searchEl.value || '').trim().toLowerCase();
    const statusFilter = (filterEl && filterEl.value) || 'all';
    const filtered = items.filter(it => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (!query) return true;
      return String(it.body||'').toLowerCase().includes(query);
    });

    // 智能卡片布局：支持碰撞检测和紧密排列
    const sorted = filtered.slice().sort((a,b)=>a.start-b.start);
    const placedCards = []; // 存储已放置的卡片信息 {top, bottom, height}
    const MIN_SPACING = 8; // 最小间距，允许卡片更紧密排列
    
    for (const it of sorted) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.status = it.status;
      const collapsed = !!(collapsedByDoc[docUri] && collapsedByDoc[docUri][it.id]);
      if (collapsed) card.classList.add('collapsed');
      
      // 计算理想位置（基于代码行位置）
      let idealTop = Math.round(it.start * lineHeight) + 8;
      
      // 估算卡片高度（折叠状态下更小）
      const estimatedHeight = collapsed ? 60 : (it.messageCount || 1) * 80 + 100;
      
      // 碰撞检测：找到不与现有卡片重叠的位置
      let finalTop = idealTop;
      let hasCollision = true;
      
      while (hasCollision) {
        hasCollision = false;
        const proposedBottom = finalTop + estimatedHeight;
        
        for (const placed of placedCards) {
          // 检查是否与已放置的卡片重叠
          if (!(finalTop >= placed.bottom + MIN_SPACING || proposedBottom <= placed.top - MIN_SPACING)) {
            // 有重叠，将卡片移到冲突卡片下方
            finalTop = placed.bottom + MIN_SPACING;
            hasCollision = true;
            break;
          }
        }
      }
      
      // 记录卡片位置信息
      placedCards.push({
        top: finalTop,
        bottom: finalTop + estimatedHeight,
        height: estimatedHeight
      });
      
      card.style.top = finalTop + 'px';
      card.style.left = '0';
      const main = document.createElement('div');
      const caret = document.createElement('span'); caret.className='caret'; caret.textContent = collapsed ? '▸' : '▾';
      caret.title = collapsed ? '展开' : '折叠';
      caret.addEventListener('click', (e)=>{ e.stopPropagation(); toggleCollapsed(it.id); });
      const header = document.createElement('div'); header.className='header';
      header.appendChild(caret);
      const title = document.createElement('div'); title.textContent = '批注'; header.appendChild(title);
      main.appendChild(header);
      const meta = document.createElement('div'); meta.className='meta'; 
      const lineInfo = `行 ${it.start+1} - ${it.end+1}`;
      const statusInfo = it.status==='open'?'未解决':'已解决';
      const messageInfo = it.messageCount > 1 ? ` · ${it.messageCount}条消息` : '';
      meta.textContent = `${lineInfo} · ${statusInfo}${messageInfo}`; 
      main.appendChild(meta);
      // 渲染所有消息
      const messagesContainer = document.createElement('div'); messagesContainer.className='messages-container';
      if (it.messages && it.messages.length > 0) {
        it.messages.forEach((msg, index) => {
          const messageDiv = document.createElement('div');
          messageDiv.className = 'message';
          if (index > 0) messageDiv.style.marginTop = '8px';
          
          // 消息头部（作者和时间）
          if (it.messages.length > 1) {
            const messageHeader = document.createElement('div');
            messageHeader.className = 'message-header';
            messageHeader.style.fontSize = '11px';
            messageHeader.style.color = '#666';
            messageHeader.style.marginBottom = '4px';
            messageHeader.style.display = 'flex';
            messageHeader.style.justifyContent = 'space-between';
            messageHeader.style.alignItems = 'center';
            const author = msg.author || '匿名';
            const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
            const authorTime = document.createElement('span');
            authorTime.textContent = `${author}${time ? ' · ' + time : ''}`;
            messageHeader.appendChild(authorTime);
            
            // 为每条消息添加编辑按钮
            const editBtn = document.createElement('button');
            editBtn.textContent = '编辑';
            editBtn.className = 'vbtn';
            editBtn.style.fontSize = '10px';
            editBtn.style.padding = '2px 6px';
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              showEditMessage(card, it.id, msg.id, String(msg.body || ''));
            });
            messageHeader.appendChild(editBtn);
            
            messageDiv.appendChild(messageHeader);
          }
          
          // 消息内容
          const messageBody = document.createElement('div');
          messageBody.className = 'message-body';
          messageBody.innerHTML = renderMarkdown(String(msg.body || ''));
          messageDiv.appendChild(messageBody);
          
          messagesContainer.appendChild(messageDiv);
        });
      } else {
        // 兼容旧数据格式
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message';
        const messageBody = document.createElement('div');
        messageBody.className = 'message-body';
        messageBody.innerHTML = renderMarkdown(String(it.body || ''));
        messageDiv.appendChild(messageBody);
        messagesContainer.appendChild(messageDiv);
      }
      main.appendChild(messagesContainer);
      const actions = document.createElement('div'); actions.className='actions'; actions.style.marginTop='6px';
      const btnGoto = button('定位', () => postMessage({ type: 'reveal', id: it.id }));
      const btnReply = button('回复', () => showReply(card, it.id));
      // 只有单条消息时才显示编辑按钮，多条消息时每条消息都有自己的编辑按钮
      const btnEdit = (it.messages && it.messages.length > 1) ? null : button('编辑', () => showEdit(card, it.id, String(it.body||'')));
      const btnToggle = button(it.status === 'open' ? '解决' : '重开', () => postMessage({ type: 'toggleStatus', id: it.id }));
      const btnDelete = button('删除', () => { showConfirm('删除此批注？').then(ok => { if (ok) postMessage({ type: 'delete', id: it.id }); }); });
      if (btnEdit) {
        actions.append(btnGoto, btnReply, btnEdit, btnToggle, btnDelete);
      } else {
        actions.append(btnGoto, btnReply, btnToggle, btnDelete);
      }
      card.appendChild(main);
      card.appendChild(actions);
      if (collapsed) {
        const firstMessage = (it.messages && it.messages.length > 0) ? it.messages[0].body : (it.body || '');
        const snippet = document.createElement('div'); snippet.style.opacity='.8'; snippet.textContent = truncate(String(firstMessage), 32);
        messagesContainer.replaceChildren(snippet);
      }
      card.addEventListener('click', () => vscode && vscode.postMessage({ type: 'reveal', id: it.id }));
      track.appendChild(card);
    }
  }

  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'); }

  // 简单的markdown渲染函数
  function renderMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    
    // 处理换行符
    html = html.replace(/\n/g, '<br>');
    
    // 处理粗体 **text**
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 处理斜体 *text*
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 处理代码 `code`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 处理删除线 ~~text~~
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    
    return html;
  }

  function button(text, handler){ 
    const b=document.createElement('button'); 
    b.className='vbtn'; 
    b.textContent=text; 
    b.addEventListener('click',(e)=>{
      e.stopPropagation(); 
      try {
        handler();
      } catch (err) {
        console.error('Button handler error:', err);
      }
    }); 
    return b; 
  }

  function showReply(card, id){
    let box = card.querySelector('.reply');
    if (box) { box.remove(); return; }
    // 关闭可能打开的编辑框
    const edit = card.querySelector('.edit'); if (edit) edit.remove();
    box = document.createElement('div'); box.className='reply';
    const ta = document.createElement('textarea'); ta.placeholder='输入回复...'; ta.style.minHeight='48px';
    const row = document.createElement('div'); row.style.marginTop='6px'; row.style.display='flex'; row.style.gap='8px'; row.style.flexWrap='wrap';
    const send = button('发送', () => { 
       const v=(ta.value||'').trim(); 
       if(!v){ta.focus();return;} 
       if(postMessage({type:'reply', id, body:v})) {
         box.remove(); 
       }
     });
    const cancel = button('取消', () => { box.remove(); });
    row.appendChild(send); row.appendChild(cancel);
    box.appendChild(ta); box.appendChild(row); card.appendChild(box);
    ta.focus();
    // 添加键盘快捷键支持
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        send.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel.click();
      }
    });
  }

  function showEdit(card, id, current){
    let box = card.querySelector('.edit');
    if (box) { box.remove(); return; }
    // 关闭可能打开的回复框
    const reply = card.querySelector('.reply'); if (reply) reply.remove();
    box = document.createElement('div'); box.className='edit'; box.style.marginTop='6px';
    const ta = document.createElement('textarea'); ta.value = current; ta.style.minHeight='60px';
    const row = document.createElement('div'); row.style.marginTop='6px'; row.style.display='flex'; row.style.gap='8px'; row.style.flexWrap='wrap';
    const save = button('保存', () => { 
      const v=(ta.value||'').trim(); 
      if(!v){ta.focus();return;} 
      if(postMessage({ type:'editThread', id, body:v })) {
        box.remove(); 
      }
    });
    const cancel = button('取消', () => { box.remove(); });
    row.appendChild(save); row.appendChild(cancel);
    box.appendChild(ta); box.appendChild(row); card.appendChild(box);
    ta.focus();
    // 添加键盘快捷键支持
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel.click();
      }
    });
  }

  function showEditMessage(card, threadId, messageId, current){
    let box = card.querySelector('.edit');
    if (box) { box.remove(); return; }
    // 关闭可能打开的回复框
    const reply = card.querySelector('.reply'); if (reply) reply.remove();
    box = document.createElement('div'); box.className='edit'; box.style.marginTop='6px';
    const ta = document.createElement('textarea'); ta.value = current; ta.style.minHeight='60px';
    const row = document.createElement('div'); row.style.marginTop='6px'; row.style.display='flex'; row.style.gap='8px'; row.style.flexWrap='wrap';
    const save = button('保存', () => { 
      const v=(ta.value||'').trim(); 
      if(!v){ta.focus();return;} 
      if(postMessage({ type:'editMessage', threadId, messageId, body:v })) {
        box.remove(); 
      }
    });
    const cancel = button('取消', () => { box.remove(); });
    row.appendChild(save); row.appendChild(cancel);
    box.appendChild(ta); box.appendChild(row); card.appendChild(box);
    ta.focus();
    // 添加键盘快捷键支持
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel.click();
      }
    });
  }

  // 自定义确认对话框，替代原生confirm()以避免沙盒环境问题
  function showConfirm(message) {
    return new Promise((resolve) => {
      // 创建模态对话框
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      `;
      
      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #cccccc);
        padding: 20px;
        border-radius: 6px;
        min-width: 300px;
        max-width: 500px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      `;
      
      const messageEl = document.createElement('div');
      messageEl.textContent = message;
      messageEl.style.cssText = 'margin-bottom: 16px; font-size: 14px;';
      
      const buttonContainer = document.createElement('div');
      buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';
      
      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '确定';
      confirmBtn.style.cssText = `
        padding: 6px 12px;
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #ffffff);
        border: none;
        border-radius: 3px;
        cursor: pointer;
      `;
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.style.cssText = `
        padding: 6px 12px;
        background: var(--vscode-button-secondaryBackground, #3c3c3c);
        color: var(--vscode-button-secondaryForeground, #cccccc);
        border: none;
        border-radius: 3px;
        cursor: pointer;
      `;
      
      function cleanup() {
        document.body.removeChild(modal);
        document.removeEventListener('keydown', handleKeydown);
      }
      
      function handleKeydown(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          cleanup();
          resolve(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
          resolve(false);
        }
      }
      
      confirmBtn.addEventListener('click', () => {
        cleanup();
        resolve(true);
      });
      
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(false);
      });
      
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          cleanup();
          resolve(false);
        }
      });
      
      buttonContainer.appendChild(cancelBtn);
      buttonContainer.appendChild(confirmBtn);
      dialog.appendChild(messageEl);
      dialog.appendChild(buttonContainer);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
      
      document.addEventListener('keydown', handleKeydown);
      confirmBtn.focus();
    });
  }

  function toggleCollapsed(id){
    if (!collapsedByDoc[docUri]) collapsedByDoc[docUri] = {};
    collapsedByDoc[docUri][id] = !collapsedByDoc[docUri][id];
    persistState();
    render();
  }

  function truncate(s, n){ return s.length>n ? s.slice(0,n-1)+'…' : s; }
  
  // 显示通知消息
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 16px;
      border-radius: 4px;
      color: white;
      font-size: 14px;
      z-index: 1000;
      max-width: 300px;
      word-wrap: break-word;
      transition: opacity 0.3s ease;
    `;
    
    // 根据类型设置背景色
    switch (type) {
      case 'success':
        notification.style.backgroundColor = '#28a745';
        break;
      case 'error':
        notification.style.backgroundColor = '#dc3545';
        break;
      case 'warning':
        notification.style.backgroundColor = '#ffc107';
        notification.style.color = '#212529';
        break;
      default:
        notification.style.backgroundColor = '#17a2b8';
    }
    
    document.body.appendChild(notification);
    
    // 3秒后自动消失
    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }, 3000);
  }

  window.addEventListener('message', ev => {
    const msg = ev.data || {};
    console.log('Received message:', msg);
    if (msg.type === 'init') {
      console.log('Initializing with docUri:', msg.docUri);
      docUri = String(msg.docUri||'');
      if (!collapsedByDoc[docUri]) collapsedByDoc[docUri] = {};
      try { persistState(); } catch {}
      vscode && vscode.postMessage({ type: 'setStateDocUri', docUri });
      vscode && vscode.postMessage({ type: 'requestRefresh' });
      return;
    }
    if (msg.type === 'threads') {
      lineHeight = msg.lineHeight || lineHeight;
      totalLines = msg.totalLines || totalLines;
      items = Array.isArray(msg.items) ? msg.items : [];
      render();
      return;
    }
    if (msg.type === 'editorScroll') {
      console.log('Editor scroll event:', msg);
      if (typeof msg.lineHeight === 'number') lineHeight = msg.lineHeight;
      if (msg.meta && Number.isInteger(msg.meta.maxTop)) maxTop = msg.meta.maxTop;
      const ratio = Number(msg.ratio || 0);
      
      // 清除任何待处理的面板滚动事件
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
      }
      
      // 更新高度后再同步滚动
      const contentHeight = Math.max(0, Math.round(maxTop * lineHeight + root.clientHeight));
      track.style.height = contentHeight + 'px';
      const max = Math.max(1, root.scrollHeight - root.clientHeight);

      // 若用户刚在面板中滚动，则忽略来自编辑器的同步，避免回拉
      if (Date.now() < suppressUntil) {
        console.log('Editor scroll ignored due to recent user scroll', { suppressUntil });
        return;
      }
       
      // 优化同步锁定时间，提高响应性，并避免与用户滚动互相拉扯
      syncing = true;
      syncingUntil = Date.now() + PROGRAM_SYNC_MAX;
      // 临时禁用平滑，避免“抽搐”
      const prevBehavior = root.style.scrollBehavior;
      if (prevBehavior !== 'auto') root.style.scrollBehavior = 'auto';
      root.scrollTop = Math.max(0, Math.min(max, ratio * max));
      // 恢复原样式
      setTimeout(() => {
        root.style.scrollBehavior = prevBehavior || 'smooth';
      }, PROGRAM_SYNC_MIN);
      
      // 稍后解除锁定
      setTimeout(() => {
        syncing = false;
        console.log('Editor scroll sync unlocked');
      }, PROGRAM_SYNC_MIN);
      return;
    }
    if (msg.type === 'garbageCollectResult') {
      console.log('Garbage collection result:', msg);
      const message = msg.deletedCount > 0 
        ? `已清理 ${msg.deletedCount} 个已删除的批注`
        : '没有找到需要清理的已删除批注';
      showNotification(message, msg.deletedCount > 0 ? 'success' : 'info');
      return;
    }
    if (msg.type === 'restoreCommentResult') {
      console.log('Restore comment result:', msg);
      const message = msg.success 
        ? '批注已成功恢复'
        : '恢复批注失败';
      showNotification(message, msg.success ? 'success' : 'error');
      return;
    }
  });

  // Restore persisted state and notify extension when webview loads
  if (state && state.docUri) { docUri = state.docUri; }

  // Wire search / filter
  if (searchEl) searchEl.addEventListener('input', render);
  if (filterEl) filterEl.addEventListener('change', render);
  
  // Wire garbage collect button
  const garbageCollectBtn = document.getElementById('garbageCollectBtn');
  if (garbageCollectBtn) {
    garbageCollectBtn.addEventListener('click', () => {
      if (postMessage({ type: 'garbageCollect' })) {
        showNotification('正在清理已删除的批注...', 'info');
      }
    });
  }
  
  // 焦点感知事件监听
  root.addEventListener('mouseenter', () => {
    panelHasMouseOver = true;
    lastUserInteraction = Date.now();
  });
  
  root.addEventListener('mouseleave', () => {
    panelHasMouseOver = false;
  });
  
  root.addEventListener('focus', () => {
    panelHasFocus = true;
    lastUserInteraction = Date.now();
  }, true);
  
  root.addEventListener('blur', () => {
    panelHasFocus = false;
  }, true);
  
  // 检测用户主动滚动（鼠标滚轮、拖拽滚动条等）
  root.addEventListener('wheel', () => {
    lastUserInteraction = Date.now();
    suppressUntil = lastUserInteraction + USER_SCROLL_SUPPRESS_MS;
  }, { passive: true });

  root.addEventListener('mousedown', (e) => {
    // 无法可靠判断是否点在原生滚动条上，这里统一认为用户开始交互
    lastUserInteraction = Date.now();
    suppressUntil = lastUserInteraction + USER_SCROLL_SUPPRESS_MS;
  });
  
  function persistState(){ try{ state.docUri = docUri; state.collapsedByDoc = collapsedByDoc; vscode && vscode.setState(state); }catch{} }

  // 面板 -> 扩展：按比例上报滚动（带防抖）
  root.addEventListener('scroll', () => {
    if (syncing || Date.now() < syncingUntil) return;
    
    const now = Date.now();
    lastScrollTime = now;
    
    // 清除之前的定时器
    if (scrollTimeout) {
      clearTimeout(scrollTimeout);
    }
    
    // 设置防抖定时器
    scrollTimeout = setTimeout(() => {
      // 确保这是最后一次滚动事件
      if (Date.now() - lastScrollTime >= SCROLL_DEBOUNCE_MS - 10) {
        // 焦点感知：放宽同步条件，确保面板滚动能够正常工作
        const hasRecentInteraction = Date.now() - lastUserInteraction < 3000; // 3秒内的交互
        const shouldSync = panelHasFocus || panelHasMouseOver || hasRecentInteraction;
        
        console.log('Panel scroll sync check:', { 
          panelHasFocus, 
          panelHasMouseOver, 
          hasRecentInteraction, 
          shouldSync,
          timeSinceInteraction: Date.now() - lastUserInteraction 
        });
        
        if (!shouldSync) {
          console.log('Panel scroll blocked - no focus or recent interaction');
          return;
        }
        
        const max = Math.max(1, root.scrollHeight - root.clientHeight);
        const ratio = root.scrollTop / max;
        console.log('Panel scroll debounced:', { ratio, scrollTop: root.scrollTop, max });
        vscode && vscode.postMessage({ 
          type: 'panelScroll', 
          ratio, 
          panelHasFocus: panelHasFocus || panelHasMouseOver,
          lastInteraction: lastUserInteraction 
        });
      }
    }, SCROLL_DEBOUNCE_MS);
  }, { passive: true });
})();
