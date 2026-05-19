// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const workspaceName = document.getElementById('workspaceName');
    const workspacePath = document.getElementById('workspacePath');
    const recentWorkspaces = document.getElementById('recentWorkspaces');
    const statusRow = document.getElementById('statusRow');
    const helloEnabled = document.getElementById('helloEnabled');
    const forceManaged = document.getElementById('forceManaged');
    const firstSetupModal = document.getElementById('firstSetupModal');
    const firstSetupOpenHello = document.getElementById('firstSetupOpenHello');
    const firstSetupStartupHello = document.getElementById('firstSetupStartupHello');
    const extensions = document.getElementById('extensions');
    const notice = document.getElementById('notice');
    const gitSummary = document.getElementById('gitSummary');
    const gitScope = document.getElementById('gitScope');
    const gitName = document.getElementById('gitName');
    const gitEmail = document.getElementById('gitEmail');
    const initRepoBtn = document.getElementById('initRepoBtn');
    const gitDownloadBtn = document.getElementById('gitDownloadBtn');
    const initProjectCard = document.getElementById('initProjectCard');
    const initProjectStatus = document.getElementById('initProjectStatus');

    let currentState = undefined;
    let i18n = window.__HELLO_I18N__ || {};

    applyI18n();

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
            return;
        }

        const recentPath = button.getAttribute('data-recent-path');
        if (recentPath) {
            vscode.postMessage({ command: 'openRecentWorkspace', path: recentPath });
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
            i18n = message.data?.i18n || i18n;
            applyI18n();
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
            case 'openAnhSettings':
                vscode.postMessage({ command: 'openAnhSettings' });
                break;
            case 'openRecentList':
                vscode.postMessage({ command: 'openRecentList' });
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
            case 'submitFirstSetup':
                hideFirstSetup();
                vscode.postMessage({
                    command: 'submitFirstHelloPrompt',
                    data: {
                        openHello: firstSetupOpenHello ? !!firstSetupOpenHello.checked : true,
                        startupHello: firstSetupStartupHello ? !!firstSetupStartupHello.checked : true
                    }
                });
                break;
            case 'skipFirstSetup':
                hideFirstSetup();
                vscode.postMessage({ command: 'skipFirstHelloPrompt' });
                break;
        }
    }

    function render(state) {
        renderFirstSetup(state.config || {});
        renderWorkspace(state);
        renderProjectInit(state.projectInit || {});
        renderRecentWorkspaces(state.recentWorkspaces || []);
        renderConfig(state);
        renderGit(state.git || {});
        renderExtensions(state.recommendations || []);
    }

    function renderFirstSetup(cfg) {
        if (!firstSetupModal) return;
        const needed = !!cfg.firstHelloPromptNeeded;
        firstSetupModal.hidden = !needed;
        if (!needed) return;
        if (firstSetupOpenHello) firstSetupOpenHello.checked = true;
        if (firstSetupStartupHello) firstSetupStartupHello.checked = !!cfg.helloEnabled;
    }

    function hideFirstSetup() {
        if (firstSetupModal) firstSetupModal.hidden = true;
    }

    function renderWorkspace(state) {
        const workspace = state.workspace;
        if (workspace) {
            workspaceName.textContent = workspace.name || '已打开工作区';
            workspaceName.classList.remove('muted');
            workspacePath.textContent = workspace.path || '';
        } else {
            workspaceName.textContent = t('noWorkspace');
            workspaceName.classList.add('muted');
            workspacePath.textContent = t('noWorkspaceDesc');
        }

        const cfg = state.config || {};
        const badges = [];
        badges.push({ text: cfg.workspaceDisabled ? t('workspaceDisabled') : t('workspaceEnabled'), kind: cfg.workspaceDisabled ? 'warn' : 'ok' });
        badges.push({ text: cfg.effectiveVsCodeManagedDisabling ? t('followsVsCode') : t('usesAnhSwitch'), kind: cfg.effectiveVsCodeManagedDisabling ? 'ok' : '' });
        if (cfg.forceVsCodeManagedDisabling && !cfg.originalVsCodeManagedDisabling) {
            badges.push({ text: t('helloManagedTemporary'), kind: 'ok' });
        }
        statusRow.innerHTML = badges.map(badge => `<span class="badge ${badge.kind || ''}">${escapeHtml(badge.text)}</span>`).join('');
    }

    function renderProjectInit(projectInit) {
        if (!initProjectStatus) return;
        if (!projectInit.hasWorkspace) {
            initProjectStatus.textContent = t('needsWorkspace');
            initProjectStatus.className = 'badge warn card-status';
            if (initProjectCard) initProjectCard.setAttribute('title', t('noWorkspaceDesc'));
            return;
        }
        if (projectInit.initialized) {
            initProjectStatus.textContent = t('doneButton');
            initProjectStatus.className = 'badge ok card-status';
            if (initProjectCard) initProjectCard.setAttribute('title', t('projectInitializedDesc'));
            return;
        }
        const missing = Array.isArray(projectInit.missing) ? projectInit.missing : [];
        const partial = projectInit.configExists || projectInit.keywordConfigExists || projectInit.anyConfiguredExists || projectInit.anyPackageResourceExists;
        initProjectStatus.textContent = partial ? t('partialButton') : t('notInitializedButton');
        initProjectStatus.className = 'badge warn card-status';
        if (initProjectCard) {
            const missingText = missing.length ? `${t('missingItems')}：${missing.join(', ')}` : t('projectNotInitializedDesc');
            initProjectCard.setAttribute('title', missingText);
        }
    }

    function renderRecentWorkspaces(items) {
        if (!recentWorkspaces) return;
        if (!items.length) {
            recentWorkspaces.innerHTML = `<div class="path">${escapeHtml(t('noRecent'))}</div>`;
            return;
        }
        recentWorkspaces.innerHTML = items.map(item => `
            <button class="recent-item" data-recent-path="${escapeAttribute(item.path)}">
                <span class="workspace-name">${escapeHtml(item.name || basename(item.path))}</span>
                <span class="path">${escapeHtml(item.path || '')}</span>
            </button>
        `).join('');
    }

    function renderConfig(state) {
        const cfg = state.config || {};
        if (helloEnabled) helloEnabled.checked = !!cfg.helloEnabled;
        if (forceManaged) forceManaged.checked = !!cfg.forceVsCodeManagedDisabling;
    }

    function renderGit(git) {
        if (!gitSummary || !gitScope || !gitName || !gitEmail || !initRepoBtn || !gitDownloadBtn) return;
        if (!git.installed) {
            gitSummary.textContent = t('gitNotInstalled');
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
            ? t('gitNoWorkspace')
            : git.hasRepo
                ? t('gitRepoReady')
                : t('gitRepoMissing');
        const globalText = git.globalName && git.globalEmail
            ? `${t('globalIdentity')}：${git.globalName} <${git.globalEmail}>`
            : t('globalIdentityMissing');
        const localText = git.localName && git.localEmail
            ? `${t('localIdentity')}：${git.localName} <${git.localEmail}>`
            : t('localIdentityMissing');
        gitSummary.textContent = `${git.version || 'Git 已安装'}。${repoText} ${globalText}；${localText}`;
    }

    function renderExtensions(items) {
        if (!extensions) return;
        if (!items.length) {
            extensions.innerHTML = `<div class="muted">${escapeHtml(t('noExtensions'))}</div>`;
            return;
        }
        extensions.innerHTML = items.map(item => {
            const status = item.installed ? (item.active ? t('extensionInstalledActive') : t('extensionInstalled')) : t('extensionMissing');
            const statusKind = item.installed ? 'ok' : 'warn';
            const author = item.author || item.publisher || t('unknownAuthor');
            const category = item.category || t('recommendation');
            const marketplace = item.marketplaceUrl || '';
            const actionLabel = item.installed ? t('viewExtension') : t('openMarketplace');
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
                    <p class="extension-reason">${escapeHtml(t('recommendedReason'))}：${escapeHtml(item.reason || t('defaultReason'))}</p>
                    <div class="tile-actions">
                        <button class="primary" data-extension-id="${escapeAttribute(item.id)}" data-marketplace-url="${escapeAttribute(marketplace)}">${escapeHtml(actionLabel)}</button>
                    </div>
                </article>
            `;
        }).join('');
    }

    function applyI18n() {
        document.querySelectorAll('[data-i18n]').forEach(node => {
            const key = node.getAttribute('data-i18n');
            if (key && i18n[key]) node.textContent = i18n[key];
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
            const key = node.getAttribute('data-i18n-placeholder');
            if (key && i18n[key]) node.setAttribute('placeholder', i18n[key]);
        });
    }

    function t(key) {
        return i18n[key] || key;
    }

    function basename(value) {
        const parts = String(value || '').split(/[\\/]/).filter(Boolean);
        return parts[parts.length - 1] || value || '';
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
