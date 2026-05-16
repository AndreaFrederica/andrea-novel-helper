// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const workspaceName = document.getElementById('workspaceName');
    const workspacePath = document.getElementById('workspacePath');
    const statusRow = document.getElementById('statusRow');
    const helloEnabled = document.getElementById('helloEnabled');
    const forceManaged = document.getElementById('forceManaged');
    const extensions = document.getElementById('extensions');
    const notice = document.getElementById('notice');
    const gitSummary = document.getElementById('gitSummary');
    const gitScope = document.getElementById('gitScope');
    const gitName = document.getElementById('gitName');
    const gitEmail = document.getElementById('gitEmail');
    const initRepoBtn = document.getElementById('initRepoBtn');
    const gitDownloadBtn = document.getElementById('gitDownloadBtn');

    let currentState = undefined;

    document.body.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;

        const action = button.getAttribute('data-action');
        if (action) {
            runAction(action);
            return;
        }

        const commandId = button.getAttribute('data-cmd');
        if (commandId) {
            const arg = button.getAttribute('data-arg') || undefined;
            vscode.postMessage({ command: 'runCommand', id: commandId, arg });
            return;
        }

        const docId = button.getAttribute('data-doc');
        if (docId) {
            vscode.postMessage({ command: 'openDoc', docId });
            return;
        }

        const extensionId = button.getAttribute('data-extension-id');
        if (extensionId) {
            vscode.postMessage({
                command: 'openExtension',
                extensionId,
                marketplaceUrl: button.getAttribute('data-marketplace-url') || undefined
            });
        }
    });

    helloEnabled?.addEventListener('change', () => {
        vscode.postMessage({ command: 'setConfig', key: 'hello.enabled', value: helloEnabled.checked });
    });

    forceManaged?.addEventListener('change', () => {
        vscode.postMessage({ command: 'setConfig', key: 'hello.forceVsCodeManagedDisabling', value: forceManaged.checked });
    });

    gitScope?.addEventListener('change', () => {
        if (currentState) renderGit(currentState.git || {});
    });

    window.addEventListener('message', event => {
        const message = event.data || {};
        if (message.command === 'state') {
            currentState = message.data;
            render(message.data);
            hideNotice();
        } else if (message.command === 'error') {
            showNotice(message.message || '操作失败');
        }
    });

    function runAction(action) {
        switch (action) {
            case 'createWorkspace':
                vscode.postMessage({ command: 'createWorkspace' });
                break;
            case 'openWorkspace':
                vscode.postMessage({ command: 'openWorkspace' });
                break;
            case 'dismiss':
                vscode.postMessage({ command: 'dismiss' });
                break;
            case 'enableWorkspace':
                vscode.postMessage({ command: 'enableWorkspace' });
                break;
            case 'enableManagedMode':
                vscode.postMessage({ command: 'enableManagedMode' });
                break;
            case 'showGuide':
                vscode.postMessage({ command: 'runCommand', id: 'AndreaNovelHelper.showGuide' });
                break;
            case 'openWiki':
                vscode.postMessage({ command: 'openUrl', url: 'https://wiki.sirrus.cc/AndreaNovelHelper/' });
                break;
            case 'saveGitUser':
                vscode.postMessage({
                    command: 'configureGitUser',
                    data: {
                        scope: gitScope.value,
                        name: gitName?.value || '',
                        email: gitEmail?.value || ''
                    }
                });
                break;
            case 'initGitRepo':
                vscode.postMessage({ command: 'initGitRepo' });
                break;
            case 'openGitDownload':
                vscode.postMessage({ command: 'openGitDownload' });
                break;
            case 'refresh':
                vscode.postMessage({ command: 'refresh' });
                break;
        }
    }

    function render(state) {
        renderWorkspace(state);
        renderConfig(state);
        renderGit(state.git || {});
        renderExtensions(state.recommendations || []);
    }

    function renderWorkspace(state) {
        const workspace = state.workspace;
        if (workspace) {
            workspaceName.textContent = workspace.name || '已打开工作区';
            workspaceName.classList.remove('muted');
            workspacePath.textContent = workspace.path || '';
        } else {
            workspaceName.textContent = '尚未打开工作区';
            workspaceName.classList.add('muted');
            workspacePath.textContent = '可以先创建一个新项目文件夹，或打开已有小说项目。';
        }

        const cfg = state.config || {};
        const badges = [];
        badges.push({ text: cfg.workspaceDisabled ? '工作区禁用' : '工作区启用', kind: cfg.workspaceDisabled ? 'warn' : 'ok' });
        badges.push({ text: cfg.effectiveVsCodeManagedDisabling ? '跟随 VS Code 扩展开关' : '使用 ANH 工作区开关', kind: cfg.effectiveVsCodeManagedDisabling ? 'ok' : '' });
        if (cfg.forceVsCodeManagedDisabling && !cfg.originalVsCodeManagedDisabling) {
            badges.push({ text: '托管模式由 Hello 临时生效', kind: 'ok' });
        }
        statusRow.innerHTML = badges.map(badge => `<span class="badge ${badge.kind || ''}">${escapeHtml(badge.text)}</span>`).join('');
    }

    function renderConfig(state) {
        const cfg = state.config || {};
        if (helloEnabled) helloEnabled.checked = !!cfg.helloEnabled;
        if (forceManaged) forceManaged.checked = !!cfg.forceVsCodeManagedDisabling;
    }

    function renderGit(git) {
        if (!gitSummary || !gitScope || !gitName || !gitEmail || !initRepoBtn || !gitDownloadBtn) return;
        if (!git.installed) {
            gitSummary.textContent = '未检测到 Git。仍可创建和打开工作区；需要版本备份时请先安装 Git。';
            gitName.value = '';
            gitEmail.value = '';
            gitName.disabled = true;
            gitEmail.disabled = true;
            gitScope.disabled = true;
            initRepoBtn.style.display = 'none';
            gitDownloadBtn.style.display = '';
            return;
        }

        gitName.disabled = false;
        gitEmail.disabled = false;
        gitScope.disabled = false;
        gitDownloadBtn.style.display = 'none';
        initRepoBtn.style.display = git.hasWorkspace && !git.hasRepo ? '' : 'none';

        const localOption = gitScope.querySelector('option[value="local"]');
        if (localOption) {
            localOption.disabled = !git.hasWorkspace || !git.hasRepo;
        }
        if ((!git.hasWorkspace || !git.hasRepo) && gitScope.value === 'local') {
            gitScope.value = 'global';
        }

        const usingLocal = gitScope.value === 'local';
        gitName.value = usingLocal ? (git.localName || '') : (git.globalName || '');
        gitEmail.value = usingLocal ? (git.localEmail || '') : (git.globalEmail || '');

        const repoText = !git.hasWorkspace
            ? '未打开工作区，只能配置全局身份。'
            : git.hasRepo
                ? '当前工作区已是 Git 仓库，可配置全局或本仓库身份。'
                : '当前工作区还不是 Git 仓库，可先初始化仓库或只配置全局身份。';
        const globalText = git.globalName && git.globalEmail
            ? `全局：${git.globalName} <${git.globalEmail}>`
            : '全局身份未配置';
        const localText = git.localName && git.localEmail
            ? `本仓库：${git.localName} <${git.localEmail}>`
            : '本仓库身份未配置';
        gitSummary.textContent = `${git.version || 'Git 已安装'}。${repoText} ${globalText}；${localText}`;
    }

    function renderExtensions(items) {
        if (!extensions) return;
        if (!items.length) {
            extensions.innerHTML = '<div class="muted">推荐目录暂时为空。</div>';
            return;
        }
        extensions.innerHTML = items.map(item => {
            const status = item.installed ? (item.active ? '已安装并启用' : '已安装') : '未安装';
            const statusKind = item.installed ? 'ok' : 'warn';
            const author = item.author || item.publisher || '未知作者';
            const category = item.category || '推荐';
            const marketplace = item.marketplaceUrl || '';
            return `
                <article class="extension-card">
                    <div class="extension-head">
                        <div>
                            <div class="extension-name">${escapeHtml(item.name)}</div>
                            <div class="extension-meta">${escapeHtml(item.id)} · ${escapeHtml(author)} · ${escapeHtml(category)}</div>
                        </div>
                        <span class="badge ${statusKind}">${escapeHtml(status)}</span>
                    </div>
                    <p class="extension-reason">${escapeHtml(item.description || '')}</p>
                    <p class="extension-reason">推荐原因：${escapeHtml(item.reason || '适合 ANH 写作工作流。')}</p>
                    <div class="tile-actions">
                        <button class="primary" data-extension-id="${escapeAttribute(item.id)}" data-marketplace-url="${escapeAttribute(marketplace)}">${item.installed ? '查看扩展' : '打开商店'}</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    function showNotice(message) {
        notice.textContent = message;
        notice.style.display = 'block';
    }

    function hideNotice() {
        notice.textContent = '';
        notice.style.display = 'none';
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    vscode.postMessage({ command: 'ready' });
})();
