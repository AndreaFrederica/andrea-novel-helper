// WebDAV管理面板前端脚本
(function() {
    const vscode = acquireVsCodeApi();
    
    let accounts = [];
    let syncProgress = { status: 'idle', total: 0, completed: 0, current: '' };
    let fileDiffs = [];
    let currentDiffData = null;
    let activeTab = 'onlyLocal';
    let projectLink = null;

    // DOM元素
    const accountsList = document.getElementById('accountsList');
    const addAccountBtn = document.getElementById('addAccountBtn');
    const linkProjectBtn = document.getElementById('linkProjectBtn');
    const unlinkProjectBtn = document.getElementById('unlinkProjectBtn');
    const editLinkBtn = document.getElementById('editLinkBtn');
    const linkStatusText = document.getElementById('linkStatusText');
    const linkInfo = document.getElementById('linkInfo');
    const linkedAccount = document.getElementById('linkedAccount');
    const linkedPath = document.getElementById('linkedPath');
    const syncTwoWayBtn = document.getElementById('syncTwoWayBtn');
    const syncPushBtn = document.getElementById('syncPushBtn');
    const syncPullBtn = document.getElementById('syncPullBtn');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    const diffsList = document.getElementById('diffsList');
    const refreshDiffsBtn = document.getElementById('refreshDiffsBtn');
    const diffSummary = document.getElementById('diffSummary');
    const diffTabs = document.getElementById('diffTabs');
    const remoteFileTree = document.getElementById('remoteFileTree');
        const refreshRemoteTreeBtn = document.getElementById('refreshRemoteTreeBtn');
        const browseRemoteBtn = document.getElementById('browseRemoteBtn');
        const encryptionKey = document.getElementById('encryptionKey');
        const showKeyBtn = document.getElementById('showKeyBtn');
        const setEncryptionKeyBtn = document.getElementById('setEncryptionKeyBtn');
        const clearEncryptionKeyBtn = document.getElementById('clearEncryptionKeyBtn');
        const encryptionStatus = document.getElementById('encryptionStatus');
        const toggleEncryptionBtn = document.getElementById('toggleEncryptionBtn');

    // 初始化事件监听器
    function initEventListeners() {
        addAccountBtn.addEventListener('click', showAddAccountDialog);
        linkProjectBtn.addEventListener('click', showLinkProjectDialog);
        if (unlinkProjectBtn) {
            unlinkProjectBtn.addEventListener('click', unlinkProject);
        }
        if (editLinkBtn) {
            editLinkBtn.addEventListener('click', showEditLinkDialog);
        }
        syncTwoWayBtn.addEventListener('click', () => startSync('two-way'));
        syncPushBtn.addEventListener('click', () => startSync('push'));
        syncPullBtn.addEventListener('click', () => startSync('pull'));
        refreshDiffsBtn.addEventListener('click', refreshDiffs);
        refreshRemoteTreeBtn.addEventListener('click', refreshRemoteTree);
        browseRemoteBtn.addEventListener('click', browseRemote);
        
        if (showKeyBtn) {
            showKeyBtn.addEventListener('click', togglePasswordVisibility);
        }
        if (setEncryptionKeyBtn) {
            setEncryptionKeyBtn.addEventListener('click', setEncryptionKey);
        }
        if (clearEncryptionKeyBtn) {
            clearEncryptionKeyBtn.addEventListener('click', clearEncryptionKey);
        }
        
        // 添加标签切换事件监听器
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-btn')) {
                switchTab(e.target.dataset.tab);
            }
        });
    }

    // 监听来自扩展的消息
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'accountsUpdated':
                accounts = message.data || [];
                renderAccounts();
                break;
            case 'projectLinkUpdated':
                projectLink = message.data;
                renderProjectLink();
                break;
            case 'syncProgressUpdated':
                syncProgress = message.data;
                updateSyncProgress();
                break;
            case 'diffsUpdated':
                fileDiffs = message.data || [];
                renderDiffs();
                break;
            case 'showDiff':
                currentDiffData = message.data;
                renderFileDiffs();
                break;
            case 'remoteTreeUpdated':
                renderRemoteFileTree(message.data);
                break;
            case 'encryptionStatusUpdated':
                updateEncryptionStatus(message.data);
                break;
        }
    });

    // 渲染账户列表
    function renderAccounts() {
        if (!accountsList) return;
        
        if (accounts.length === 0) {
            accountsList.innerHTML = '<div class="empty-state">暂无WebDAV账户，点击上方按钮添加</div>';
            return;
        }

        accountsList.innerHTML = accounts.map(account => `
            <div class="account-item" data-id="${account.id}">
                <div class="account-info">
                    <div class="account-name">${escapeHtml(account.name || account.url)}</div>
                    <div class="account-url">${escapeHtml(account.url)}</div>
                    <div class="account-status ${account.enabled ? 'enabled' : 'disabled'}">
                        ${account.enabled ? '✓ 已启用' : '✗ 已禁用'}
                    </div>
                </div>
                <div class="account-actions">
                    <button class="btn btn-small" onclick="editAccount('${account.id}')" title="编辑">
                        ✏️
                    </button>
                    <button class="btn btn-small btn-danger" onclick="deleteAccount('${account.id}')" title="删除">
                        🗑️
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 显示添加账户对话框
    function showAddAccountDialog() {
        const dialog = createAccountDialog();
        document.body.appendChild(dialog);
    }

    // 创建账户对话框
    function createAccountDialog(account = null) {
        const isEdit = !!account;
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        
        dialog.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${isEdit ? '编辑账户' : '添加WebDAV账户'}</h3>
                    <button class="modal-close" onclick="closeModal(this)">×</button>
                </div>
                <div class="modal-body">
                    <form id="accountForm">
                        <div class="form-group">
                            <label for="accountName">账户名称</label>
                            <input type="text" id="accountName" value="${account?.name || ''}" placeholder="输入账户名称" required>
                        </div>
                        <div class="form-group">
                            <label for="accountUrl">WebDAV URL</label>
                            <input type="url" id="accountUrl" value="${account?.url || ''}" placeholder="https://example.com/webdav" required>
                        </div>
                        <div class="form-group">
                            <label for="accountUsername">用户名</label>
                            <input type="text" id="accountUsername" value="${account?.username || ''}" placeholder="输入用户名" required>
                        </div>
                        <div class="form-group">
                            <label for="accountPassword">密码</label>
                            <input type="password" id="accountPassword" value="${account?.password || ''}" placeholder="输入密码" required>
                        </div>
                        <div class="form-group">
                            <label for="remotePath">远程路径</label>
                            <input type="text" id="remotePath" value="${account?.remotePath || '/'}" placeholder="/" required>
                        </div>
                        <div class="form-group">
                            <label>
                                <input type="checkbox" id="accountEnabled" ${account?.enabled !== false ? 'checked' : ''}>
                                启用此账户
                            </label>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal(this)">取消</button>
                    <button type="button" class="btn btn-primary" onclick="saveAccount(this, ${isEdit})">
                        ${isEdit ? '保存' : '添加'}
                    </button>
                </div>
            </div>
        `;
        
        return dialog;
    }

    // 保存账户
    window.saveAccount = function(button, isEdit) {
        const form = document.getElementById('accountForm');
        const formData = new FormData(form);
        
        const accountData = {
            name: document.getElementById('accountName').value,
            url: document.getElementById('accountUrl').value,
            username: document.getElementById('accountUsername').value,
            password: document.getElementById('accountPassword').value,
            remotePath: document.getElementById('remotePath').value,
            enabled: document.getElementById('accountEnabled').checked
        };

        // 验证表单
        if (!accountData.name || !accountData.url || !accountData.username || !accountData.password) {
            alert('请填写所有必填字段');
            return;
        }

        // 发送到扩展
        vscode.postMessage({
            command: isEdit ? 'editAccount' : 'addAccount',
            data: accountData
        });

        closeModal(button);
    };

    // 编辑账户
    window.editAccount = function(accountId) {
        const account = accounts.find(a => a.id === accountId);
        if (account) {
            const dialog = createAccountDialog(account);
            document.body.appendChild(dialog);
        }
    };

    // 删除账户
    window.deleteAccount = function(accountId) {
        if (confirm('确定要删除此账户吗？')) {
            vscode.postMessage({
                command: 'deleteAccount',
                data: { id: accountId }
            });
        }
    };

    // 关闭模态框
    window.closeModal = function(element) {
        const modal = element.closest('.modal-overlay');
        if (modal) {
            modal.remove();
        }
    };

    // 渲染项目关联状态
    function renderProjectLink() {
        if (!linkStatusText || !linkInfo) return;

        if (projectLink && projectLink.isLinked) {
            linkStatusText.textContent = '当前项目已关联到WebDAV';
            linkStatusText.className = 'link-status-text linked';
            linkInfo.style.display = 'block';
            
            if (linkedAccount) {
                linkedAccount.textContent = projectLink.accountName;
            }
            if (linkedPath) {
                linkedPath.textContent = projectLink.remotePath;
            }
        } else {
            linkStatusText.textContent = '当前项目未关联到WebDAV';
            linkStatusText.className = 'link-status-text';
            linkInfo.style.display = 'none';
        }
    }

    // 显示关联项目对话框
    function showLinkProjectDialog() {
        if (accounts.length === 0) {
            alert('请先添加WebDAV账户');
            return;
        }

        const dialog = createLinkProjectDialog();
        document.body.appendChild(dialog);
    }

    // 显示编辑关联对话框
    function showEditLinkDialog() {
        if (accounts.length === 0) {
            alert('请先添加WebDAV账户');
            return;
        }

        const dialog = createLinkProjectDialog(projectLink);
        document.body.appendChild(dialog);
    }

    // 创建关联项目对话框
    function createLinkProjectDialog(existingLink = null) {
        const isEdit = !!existingLink;
        const dialog = document.createElement('div');
        dialog.className = 'modal-overlay';
        
        const accountOptions = accounts.map(account => 
            `<option value="${account.id}" ${existingLink && existingLink.accountId === account.id ? 'selected' : ''}>
                ${escapeHtml(account.name || account.url)}
            </option>`
        ).join('');
        
        dialog.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3>${isEdit ? '编辑项目关联' : '关联项目到WebDAV'}</h3>
                    <button class="modal-close" onclick="closeModal(this)">×</button>
                </div>
                <div class="modal-body">
                    <form id="linkProjectForm">
                        <div class="form-group">
                            <label for="linkAccountSelect">选择WebDAV账户</label>
                            <select id="linkAccountSelect" required>
                                ${accountOptions}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="linkRemotePath">远程路径</label>
                            <input type="text" id="linkRemotePath" value="${existingLink?.remotePath || '/'}" placeholder="/" required>
                            <small class="form-help">项目在WebDAV服务器上的路径</small>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" onclick="closeModal(this)">取消</button>
                    <button type="button" class="btn btn-primary" onclick="saveLinkProject(this, ${isEdit})">
                        ${isEdit ? '保存' : '关联'}
                    </button>
                </div>
            </div>
        `;
        
        return dialog;
    }

    // 保存项目关联
    window.saveLinkProject = function(element, isEdit) {
        const modal = element.closest('.modal');
        const accountId = modal.querySelector('#linkAccountSelect').value;
        const remotePath = modal.querySelector('#linkRemotePath').value.trim();

        if (!accountId || !remotePath) {
            alert('请填写所有必填字段');
            return;
        }

        vscode.postMessage({
            command: isEdit ? 'editProjectLink' : 'linkProject',
            data: {
                accountId: accountId,
                remotePath: remotePath
            }
        });

        closeModal(element);
    };

    // 取消项目关联
    function unlinkProject() {
        if (confirm('确定要取消项目关联吗？')) {
            vscode.postMessage({
                command: 'unlinkProject'
            });
        }
    }

    // 开始同步
    function startSync(direction) {
        if (accounts.length === 0) {
            alert('请先添加WebDAV账户');
            return;
        }

        vscode.postMessage({
            command: 'syncNow',
            data: { direction }
        });
    }

    // 更新同步进度
    function updateSyncProgress() {
        if (!progressFill || !progressText) return;

        const { status, total, completed, current, error } = syncProgress;
        
        let progressPercent = 0;
        if (total > 0) {
            progressPercent = (completed / total) * 100;
        }

        progressFill.style.width = `${progressPercent}%`;
        
        switch (status) {
            case 'idle':
                progressText.textContent = '就绪';
                progressFill.className = 'progress-fill';
                break;
            case 'syncing':
                progressText.textContent = current || '同步中...';
                progressFill.className = 'progress-fill syncing';
                break;
            case 'completed':
                progressText.textContent = '同步完成';
                progressFill.className = 'progress-fill completed';
                setTimeout(() => {
                    progressFill.style.width = '0%';
                    progressText.textContent = '就绪';
                    progressFill.className = 'progress-fill';
                }, 2000);
                break;
            case 'error':
                progressText.textContent = `错误: ${error || '同步失败'}`;
                progressFill.className = 'progress-fill error';
                break;
        }
    }

    // 刷新远程文件树
    function refreshRemoteTree() {
        vscode.postMessage({ command: 'refreshRemoteTree' });
    }

    // 浏览远程目录
    function browseRemote() {
        vscode.postMessage({ command: 'browseRemote', data: { path: '/' } });
    }

    // 渲染远程文件树
    function renderRemoteFileTree(data) {
        if (!remoteFileTree) return;
        
        if (data.error) {
            remoteFileTree.innerHTML = `<div class="error-message">${escapeHtml(data.error)}</div>`;
            return;
        }
        
        if (!data.tree || !data.tree.children || data.tree.children.length === 0) {
            remoteFileTree.innerHTML = '<div class="no-tree-message">远程目录为空</div>';
            return;
        }
        
        remoteFileTree.innerHTML = renderTreeNode(data.tree, true);
        
        // 添加展开/折叠事件监听
        remoteFileTree.addEventListener('click', (e) => {
            if (e.target.classList.contains('tree-toggle')) {
                const item = e.target.closest('.tree-item');
                item.classList.toggle('expanded');
                e.stopPropagation();
            }
        });
    }

    // 渲染树节点
    function renderTreeNode(node, isRoot = false) {
        if (!node) return '';
        
        const isDirectory = node.type === 'directory';
        const hasChildren = node.children && node.children.length > 0;
        const icon = isDirectory ? (hasChildren ? '📁' : '📂') : '📄';
        const toggleIcon = hasChildren ? '▶' : '';
        
        let html = '';
        
        if (!isRoot) {
            const sizeText = node.size ? ` (${formatFileSize(node.size)})` : '';
            const modifiedText = node.modified ? ` - ${formatDate(node.modified)}` : '';
            
            html += `<div class="tree-item ${hasChildren ? 'has-children' : ''}" data-path="${escapeHtml(node.path)}">`;
            html += `<div class="tree-node">`;
            if (hasChildren) {
                html += `<span class="tree-toggle">${toggleIcon}</span>`;
            } else {
                html += `<span class="tree-spacer"></span>`;
            }
            html += `<span class="tree-icon">${icon}</span>`;
            html += `<span class="tree-name">${escapeHtml(node.name)}</span>`;
            html += `<span class="tree-info">${sizeText}${modifiedText}</span>`;
            html += `</div>`;
        }
        
        if (hasChildren) {
            html += `<div class="tree-children ${isRoot ? 'root-children' : ''}">`;
            for (const child of node.children) {
                html += renderTreeNode(child);
            }
            html += `</div>`;
        }
        
        if (!isRoot) {
            html += `</div>`;
        }
        
        return html;
    }

    // 格式化文件大小
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 格式化日期
    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // 加密相关函数
    function togglePasswordVisibility() {
        const encryptionKey = document.getElementById('encryptionKey');
        const showKeyBtn = document.getElementById('showKeyBtn');
        
        if (encryptionKey.type === 'password') {
            encryptionKey.type = 'text';
            showKeyBtn.innerHTML = '密钥隐藏';
            showKeyBtn.title = '隐藏密钥';
        } else {
            encryptionKey.type = 'password';
            showKeyBtn.innerHTML = '密钥显示';
            showKeyBtn.title = '显示密钥';
        }
    }

    function setEncryptionKey() {
        const encryptionKey = document.getElementById('encryptionKey');
        const key = encryptionKey.value.trim();
        
        if (!key) {
            alert('请输入加密密钥');
            return;
        }
        
        vscode.postMessage({
            command: 'setEncryptionKey',
            data: { key: key }
        });
    }

    function clearEncryptionKey() {
        vscode.postMessage({
            command: 'clearEncryptionKey'
        });
        
        // 清空输入框
        const encryptionKey = document.getElementById('encryptionKey');
        if (encryptionKey) {
            encryptionKey.value = '';
        }
    }

    function updateEncryptionStatus(data) {
        const encryptionStatus = document.getElementById('encryptionStatus');
        const toggleEncryptionBtn = document.getElementById('toggleEncryptionBtn');
        
        if (encryptionStatus) {
            const statusText = encryptionStatus.querySelector('.status-text');
            if (statusText) {
                if (data.enabled) {
                    statusText.textContent = '加密状态: 已启用';
                    statusText.className = 'status-text enabled';
                } else {
                    statusText.textContent = '加密状态: 未设置';
                    statusText.className = 'status-text disabled';
                }
            }
        }
        
        if (toggleEncryptionBtn) {
            if (data.enabled) {
                toggleEncryptionBtn.innerHTML = '🔓 禁用加密';
                toggleEncryptionBtn.className = 'btn btn-warning';
            } else {
                toggleEncryptionBtn.innerHTML = '🔒 启用加密';
                toggleEncryptionBtn.className = 'btn btn-secondary';
            }
        }
        
        if (data.message) {
            alert(data.message);
        }
    }

    // 刷新差异
    function refreshDiffs() {
        if (accounts.length > 0) {
            // 使用第一个账户进行差异对比
            vscode.postMessage({ 
                command: 'showDiff', 
                data: { accountId: accounts[0].id } 
            });
        } else {
            vscode.postMessage({ command: 'getDiffs' });
        }
    }
    
    // 渲染文件差异
    function renderFileDiffs() {
        if (!currentDiffData) {
            diffsList.innerHTML = '<div class="no-diff-message">暂无差异数据</div>';
            diffSummary.style.display = 'none';
            diffTabs.style.display = 'none';
            return;
        }
        
        // 显示统计信息
        updateDiffSummary(currentDiffData.summary);
        diffSummary.style.display = 'block';
        diffTabs.style.display = 'block';
        
        // 显示数量限制警告
        if (currentDiffData.hasMoreDiffs) {
            const warningDiv = document.createElement('div');
            warningDiv.className = 'diff-warning';
            warningDiv.innerHTML = '⚠️ 差异文件过多，仅显示前 1000 个差异。建议优化项目结构或使用 .gitignore 排除不必要的文件。';
            warningDiv.style.cssText = 'background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 8px 12px; margin: 8px 0; border-radius: 4px; font-size: 12px;';
            
            // 插入到差异列表前面
            const diffContainer = diffsList.parentNode;
            const existingWarning = diffContainer.querySelector('.diff-warning');
            if (existingWarning) {
                existingWarning.remove();
            }
            diffContainer.insertBefore(warningDiv, diffsList);
        } else {
            // 移除已存在的警告
            const existingWarning = diffsList.parentNode.querySelector('.diff-warning');
            if (existingWarning) {
                existingWarning.remove();
            }
        }
        
        // 渲染当前标签的文件列表
        renderCurrentTabFiles();
    }
    
    // 更新差异统计
    function updateDiffSummary(summary) {
        document.getElementById('localCount').textContent = summary.totalLocal;
        document.getElementById('remoteCount').textContent = summary.totalRemote;
        document.getElementById('onlyLocalCount').textContent = summary.onlyLocalCount;
        document.getElementById('onlyRemoteCount').textContent = summary.onlyRemoteCount;
        document.getElementById('modifiedCount').textContent = summary.modifiedCount;
        document.getElementById('identicalCount').textContent = summary.identicalCount;
        
        // 更新标签计数
        document.getElementById('tabOnlyLocalCount').textContent = summary.onlyLocalCount;
        document.getElementById('tabOnlyRemoteCount').textContent = summary.onlyRemoteCount;
        document.getElementById('tabModifiedCount').textContent = summary.modifiedCount;
        document.getElementById('tabIdenticalCount').textContent = summary.identicalCount;
    }
    
    // 切换标签
    function switchTab(tabName) {
        // 更新活动标签
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        activeTab = tabName;
        renderCurrentTabFiles();
    }
    
    // 虚拟滚动配置
    const VIRTUAL_SCROLL_CONFIG = {
        itemHeight: 80, // 每个文件项的高度（像素）
        bufferSize: 5,  // 缓冲区大小（额外渲染的项目数）
        containerHeight: 400 // 容器高度（像素）
    };
    
    let virtualScrollState = {
        scrollTop: 0,
        startIndex: 0,
        endIndex: 0,
        visibleCount: 0
    };
    
    // 渲染当前标签的文件
    function renderCurrentTabFiles() {
        if (!currentDiffData) return;
        
        let files = [];
        let emptyMessage = '';
        
        switch (activeTab) {
            case 'onlyLocal':
                files = currentDiffData.onlyLocal || [];
                emptyMessage = '没有仅存在于本地的文件';
                break;
            case 'onlyRemote':
                files = currentDiffData.onlyRemote || [];
                emptyMessage = '没有仅存在于远程的文件';
                break;
            case 'modified':
                files = currentDiffData.modified || [];
                emptyMessage = '没有已修改的文件';
                break;
            case 'identical':
                files = currentDiffData.identical || [];
                emptyMessage = '没有相同的文件';
                break;
        }
        
        if (files.length === 0) {
            diffsList.innerHTML = `<div class="no-diff-message">${emptyMessage}</div>`;
            return;
        }
        
        // 如果文件数量较少，使用普通渲染
        if (files.length <= 100) {
            renderAllFiles(files);
        } else {
            // 使用虚拟滚动渲染
            renderVirtualScrollFiles(files);
        }
    }
    
    // 普通渲染所有文件
    function renderAllFiles(files) {
        let html = '<div class="file-list">';
        
        files.forEach(file => {
            html += renderFileItem(file);
        });
        
        html += '</div>';
        diffsList.innerHTML = html;
    }
    
    // 虚拟滚动渲染文件
    function renderVirtualScrollFiles(files) {
        const totalHeight = files.length * VIRTUAL_SCROLL_CONFIG.itemHeight;
        const visibleCount = Math.ceil(VIRTUAL_SCROLL_CONFIG.containerHeight / VIRTUAL_SCROLL_CONFIG.itemHeight);
        
        // 创建虚拟滚动容器
        const virtualContainer = document.createElement('div');
        virtualContainer.className = 'virtual-scroll-container';
        virtualContainer.style.cssText = `
            height: ${VIRTUAL_SCROLL_CONFIG.containerHeight}px;
            overflow-y: auto;
            position: relative;
        `;
        
        // 创建总高度占位符
        const spacer = document.createElement('div');
        spacer.className = 'virtual-scroll-spacer';
        spacer.style.cssText = `
            height: ${totalHeight}px;
            position: relative;
        `;
        
        // 创建可见内容容器
        const visibleContent = document.createElement('div');
        visibleContent.className = 'virtual-scroll-content';
        visibleContent.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
        `;
        
        spacer.appendChild(visibleContent);
        virtualContainer.appendChild(spacer);
        
        // 初始化虚拟滚动状态
        virtualScrollState.visibleCount = visibleCount;
        
        // 渲染初始可见项
        updateVirtualScrollContent(files, visibleContent, 0);
        
        // 添加滚动事件监听器
        virtualContainer.addEventListener('scroll', () => {
            const scrollTop = virtualContainer.scrollTop;
            updateVirtualScrollContent(files, visibleContent, scrollTop);
        });
        
        // 替换diffsList内容
        diffsList.innerHTML = '';
        diffsList.appendChild(virtualContainer);
    }
    
    // 更新虚拟滚动内容
    function updateVirtualScrollContent(files, container, scrollTop) {
        const startIndex = Math.floor(scrollTop / VIRTUAL_SCROLL_CONFIG.itemHeight);
        const endIndex = Math.min(
            startIndex + virtualScrollState.visibleCount + VIRTUAL_SCROLL_CONFIG.bufferSize * 2,
            files.length
        );
        
        const actualStartIndex = Math.max(0, startIndex - VIRTUAL_SCROLL_CONFIG.bufferSize);
        
        // 更新容器位置
        container.style.transform = `translateY(${actualStartIndex * VIRTUAL_SCROLL_CONFIG.itemHeight}px)`;
        
        // 渲染可见项
        let html = '';
        for (let i = actualStartIndex; i < endIndex; i++) {
            if (files[i]) {
                html += renderFileItem(files[i]);
            }
        }
        
        container.innerHTML = html;
        
        // 更新状态
        virtualScrollState.scrollTop = scrollTop;
        virtualScrollState.startIndex = actualStartIndex;
        virtualScrollState.endIndex = endIndex;
    }
    
    // 渲染单个文件项
    function renderFileItem(file) {
        if (activeTab === 'modified') {
            // 修改的文件显示本地和远程信息
            return `
                <div class="file-item modified-file">
                    <div class="file-header">
                        <span class="file-name">${escapeHtml(file.path)}</span>
                        <span class="file-status modified">已修改</span>
                    </div>
                    ${file.reason ? `
                        <div class="file-reason">
                            <span class="reason-label">修改原因:</span>
                            <span class="reason-text">${escapeHtml(file.reason)}</span>
                        </div>
                    ` : ''}
                    <div class="file-details">
                        <div class="file-version">
                            <span class="version-label">本地:</span>
                            <span class="file-size">${formatSize(file.local.size)}</span>
                            <span class="file-time">${formatTime(file.local.lastModified)}</span>
                        </div>
                        <div class="file-version">
                            <span class="version-label">远程:</span>
                            <span class="file-size">${formatSize(file.remote.size)}</span>
                            <span class="file-time">${formatTime(file.remote.mtime || file.remote.lastModified || file.remote.lastmod)}</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            // 其他类型的文件
            const statusClass = activeTab === 'onlyLocal' ? 'local-only' : 
                              activeTab === 'onlyRemote' ? 'remote-only' : 'identical';
            const statusText = activeTab === 'onlyLocal' ? '仅本地' : 
                             activeTab === 'onlyRemote' ? '仅远程' : '相同';
            
            return `
                <div class="file-item">
                    <div class="file-header">
                        <span class="file-name">${escapeHtml(file.path || file.name)}</span>
                        <span class="file-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="file-details">
                        <span class="file-size">${formatSize(file.size)}</span>
                        <span class="file-time">${formatTime(file.mtime || file.lastModified || file.lastmod)}</span>
                    </div>
                </div>
            `;
        }
    }
    
    // 格式化时间
    function formatTime(timeStr) {
        if (!timeStr) return '未知';
        const date = new Date(timeStr);
        return date.toLocaleString('zh-CN');
    }

    // 渲染文件差异
    function renderDiffs() {
        if (!diffsList) return;
        
        if (fileDiffs.length === 0) {
            diffsList.innerHTML = '<div class="empty-state">暂无文件差异</div>';
            return;
        }

        diffsList.innerHTML = fileDiffs.map(diff => `
            <div class="diff-item ${diff.status}">
                <div class="diff-info">
                    <div class="diff-path">${escapeHtml(diff.path)}</div>
                    <div class="diff-status">${getStatusText(diff.status)}</div>
                    ${diff.localSize !== undefined || diff.remoteSize !== undefined ? `
                        <div class="diff-sizes">
                            ${diff.localSize !== undefined ? `本地: ${formatSize(diff.localSize)}` : ''}
                            ${diff.remoteSize !== undefined ? ` 远程: ${formatSize(diff.remoteSize)}` : ''}
                        </div>
                    ` : ''}
                </div>
                ${diff.status === 'conflict' ? `
                    <div class="diff-actions">
                        <button class="btn btn-small" onclick="resolveConflict('${diff.path}', 'local')">
                            使用本地
                        </button>
                        <button class="btn btn-small" onclick="resolveConflict('${diff.path}', 'remote')">
                            使用远程
                        </button>
                    </div>
                ` : ''}
            </div>
        `).join('');
    }

    // 解决冲突
    window.resolveConflict = function(path, resolution) {
        vscode.postMessage({
            command: 'resolveConflict',
            data: { path, resolution }
        });
    };

    // 获取状态文本
    function getStatusText(status) {
        const statusMap = {
            'added': '新增',
            'modified': '修改',
            'deleted': '删除',
            'conflict': '冲突'
        };
        return statusMap[status] || status;
    }

    // 格式化文件大小
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // HTML转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 初始化标志，防止重复初始化
    let initialized = false;
    
    function initialize() {
        if (initialized) return;
        initialized = true;
        
        initEventListeners();
        
        // 请求初始数据
        vscode.postMessage({ command: 'getAccounts' });
        vscode.postMessage({ command: 'getProjectLink' });
        vscode.postMessage({ command: 'getDiffs' });
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();