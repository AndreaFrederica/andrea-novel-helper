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
  let maxTop = 0; // 最大可达顶部行（用于 1:1 高度）

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

    // 避免卡片过于靠近：按起始行排序并做最小间距布局
    const sorted = filtered.slice().sort((a,b)=>a.start-b.start);
    const placed = [];
    const MIN_SPACING = Math.max(24, Math.round(lineHeight * 1.2));
    for (const it of sorted) {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.status = it.status;
      const collapsed = !!(collapsedByDoc[docUri] && collapsedByDoc[docUri][it.id]);
      if (collapsed) card.classList.add('collapsed');
      let top = Math.round(it.start * lineHeight) + 8;
      if (placed.length) {
        const prev = placed[placed.length-1];
        const spacing = collapsed ? Math.max(16, Math.round(lineHeight * 0.6)) : MIN_SPACING;
        if (top < prev + spacing) top = prev + spacing;
      }
      placed.push(top);
      card.style.top = top + 'px';
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
      const btnDelete = button('删除', () => { if (confirm('删除此批注？')) postMessage({ type: 'delete', id: it.id }); });
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

  function toggleCollapsed(id){
    if (!collapsedByDoc[docUri]) collapsedByDoc[docUri] = {};
    collapsedByDoc[docUri][id] = !collapsedByDoc[docUri][id];
    persistState();
    render();
  }

  function truncate(s, n){ return s.length>n ? s.slice(0,n-1)+'…' : s; }

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
      console.log('Updating threads with items:', msg.items, 'lineHeight:', msg.lineHeight, 'totalLines:', msg.totalLines);
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
      // 更新高度后再同步滚动
      const contentHeight = Math.max(0, Math.round(maxTop * lineHeight + root.clientHeight));
      track.style.height = contentHeight + 'px';
      const max = Math.max(1, root.scrollHeight - root.clientHeight);
      syncing = true;
      root.scrollTop = Math.max(0, Math.min(max, ratio * max));
      requestAnimationFrame(()=> syncing = false);
      return;
    }
  });

  // Restore persisted state and notify extension when webview loads
  if (state && state.docUri) { docUri = state.docUri; }

  // Wire search / filter
  if (searchEl) searchEl.addEventListener('input', render);
  if (filterEl) filterEl.addEventListener('change', render);

  function persistState(){ try{ state.docUri = docUri; state.collapsedByDoc = collapsedByDoc; vscode && vscode.setState(state); }catch{} }

  // 面板 -> 扩展：按比例上报滚动
  root.addEventListener('scroll', () => {
    if (syncing) return;
    const max = Math.max(1, root.scrollHeight - root.clientHeight);
    const ratio = root.scrollTop / max;
    vscode && vscode.postMessage({ type: 'panelScroll', ratio });
  }, { passive: true });
})();
