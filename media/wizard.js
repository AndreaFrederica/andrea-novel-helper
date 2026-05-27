// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);

    const allSteps = [
        { id: 0, title: '欢迎' },
        { id: 1, title: '项目信息' },
        { id: 2, title: '项目配置' },
        { id: 3, title: 'Git 账户' },
        { id: 4, title: 'Git 仓库' },
        { id: 5, title: '项目文件' },
        { id: 6, title: '确认' },
        { id: 7, title: '完成' },
    ];
    let wizardMode = 'novice';
    let visibleSteps = [0, 1, 4, 5, 6, 7];
    let currentStep = 0;
    let gitInstalled = false;
    let hasRepo = false;
    let hasGitUser = false;
    let gitMissingWarned = false;

    // ── Helpers ────────────────────────────────────────

    function parseList(text) {
        return String(text || '').split(/[\r\n,，;；、\t]+/).map(v => v.trim()).filter(Boolean);
    }

    function escapeHtml(text) {
        return String(text || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    }

    function notice(text) {
        const el = $('notice');
        el.textContent = text || '';
        el.classList.toggle('show', !!text);
    }

    function getVisibleStepTitles() {
        return visibleSteps.map(stepId => {
            const step = allSteps.find(item => item.id === stepId);
            return step ? step.title : '';
        });
    }

    function getCurrentStepId() {
        return visibleSteps[currentStep] ?? 0;
    }

    function getCurrentStepTitle() {
        const step = allSteps.find(item => item.id === getCurrentStepId());
        return step ? step.title : '';
    }

    function rebuildVisibleSteps() {
        const previousStepId = getCurrentStepId();
        visibleSteps = [0, 1];
        if (wizardMode === 'pro') {
            visibleSteps.push(2);
        }
        visibleSteps.push(3, 4, 5, 6, 7);
        if (!visibleSteps.includes(previousStepId)) {
            const fallbackIndex = visibleSteps.findIndex(stepId => stepId > previousStepId);
            currentStep = fallbackIndex >= 0 ? fallbackIndex : visibleSteps.length - 1;
        } else {
            currentStep = visibleSteps.indexOf(previousStepId);
        }
    }

    function updateModeOptionStyles() {
        document.querySelectorAll('[data-mode-option]').forEach(option => {
            option.classList.toggle('selected', option.getAttribute('data-mode-option') === wizardMode);
        });
    }

    function syncModeUi() {
        document.body.dataset.mode = wizardMode;
        document.querySelectorAll('.expert-only').forEach(node => {
            node.classList.toggle('hidden', wizardMode !== 'pro');
        });
        $('noviceDefaults').classList.toggle('hidden', wizardMode !== 'novice');
        updateModeOptionStyles();
        rebuildVisibleSteps();
    }

    // ── Progress ───────────────────────────────────────

    function renderProgress() {
        const stepTitles = getVisibleStepTitles();
        const total = stepTitles.length;
        const current = currentStep + 1;
        const percent = total <= 1 ? 100 : (currentStep / (total - 1)) * 100;
        const currentText = '步骤 ' + current + '：' + getCurrentStepTitle();
        const progressCurrent = $('progressCurrent');
        const progressCount = $('progressCount');
        const progressFill = $('progressFill');
        const progressTrack = document.querySelector('.progress-track');
        const progressSteps = $('progressSteps');

        if (progressCurrent) {
            progressCurrent.textContent = currentText;
        }
        if (progressCount) {
            progressCount.textContent = current + ' / ' + total;
        }
        if (progressFill) {
            progressFill.style.width = percent + '%';
        }
        if (progressTrack) {
            progressTrack.setAttribute('aria-valuenow', String(current));
        }
        if (progressSteps) {
            progressSteps.textContent = stepTitles.join(' -> ');
        }
    }

    // ── Page Navigation ────────────────────────────────

    function renderPage() {
        const stepId = getCurrentStepId();
        const sections = document.querySelectorAll('.wizard-step');
        sections.forEach(section => {
            const step = Number(section.getAttribute('data-step'));
            const isActive = step === stepId;
            section.classList.toggle('active', isActive);
            section.classList.remove('exiting');
        });

        renderProgress();

        $('back').disabled = currentStep === 0 || stepId === 7;
        $('next').classList.toggle('hidden', stepId >= 6);
        $('run').classList.toggle('hidden', stepId !== 6);
        $('openGuide').classList.toggle('hidden', stepId !== 7);
        $('close').classList.toggle('hidden', stepId !== 7);

        if (stepId === 3 && !gitInstalled && !gitMissingWarned) {
            gitMissingWarned = true;
            vscode.postMessage({ command: 'warnGitMissing' });
        }
        if (stepId !== 3 && gitInstalled) {
            gitMissingWarned = false;
        }

        if (stepId === 6) {
            renderSummary();
        }
    }

    function goToStep(nextStep) {
        if (nextStep === currentStep || nextStep < 0 || nextStep >= visibleSteps.length) {
            return;
        }

        const currentSection = document.querySelector('.wizard-step[data-step="' + getCurrentStepId() + '"]');
        if (currentSection) {
            currentSection.classList.remove('active');
            currentSection.classList.add('exiting');
        }

        setTimeout(() => {
            currentStep = nextStep;
            renderPage();
        }, 180);
    }

    // ── Validation ─────────────────────────────────────

    function validateStep() {
        notice('');
        if (getCurrentStepId() === 1) {
            if (!$('projectName').value.trim()) { notice('项目名称不能为空。'); return false; }
            if (!$('projectAuthor').value.trim()) { notice('作者不能为空。'); return false; }
        }
        if (getCurrentStepId() === 3 && $('configureGitUser').checked) {
            if (!$('gitUserName').value.trim()) { notice('请输入 Git 用户名。'); return false; }
            if (!/.+@.+/.test($('gitUserEmail').value)) { notice('请输入有效的 Git 邮箱。'); return false; }
        }
        return true;
    }

    // ── Git State Sync ─────────────────────────────────

    function syncGitOptions() {
        const wantsGitIdentity = $('configureGitUser').checked;
        const canCommit = gitInstalled
            && (hasRepo || $('initGitRepo').checked)
            && (hasGitUser || wantsGitIdentity);

        $('gitInstallActions').classList.toggle('hidden', gitInstalled);
        $('configureGitUser').disabled = !gitInstalled;
        $('gitUserName').disabled = !gitInstalled || !wantsGitIdentity;
        $('gitUserEmail').disabled = !gitInstalled || !wantsGitIdentity;
        $('gitUserScope').disabled = !gitInstalled || !wantsGitIdentity;
        $('initGitRepo').disabled = !gitInstalled || hasRepo;
        $('initialCommit').disabled = !canCommit;
        if (!canCommit) {
            $('initialCommit').checked = false;
        }

        if (!gitInstalled) {
            $('gitHint').textContent = '未检测到 Git。建议先安装 Git，然后点击"刷新检测"。你也可以继续完成非 Git 的项目初始化。';
        } else if (!hasGitUser) {
            $('gitHint').textContent = '已安装 Git，但系统没有用户名和邮箱。建议勾选"配置 Git 用户信息"，创建全局 Git 作者信息。';
        } else {
            $('gitHint').textContent = '已检测到 Git 用户信息。你可以沿用现有配置，也可以勾选后覆盖。';
        }

        $('repoHint').textContent = !gitInstalled
            ? '未安装 Git，因此不会初始化仓库或创建提交。'
            : hasRepo
                ? (canCommit ? '当前工作区已经是 Git 仓库，可以选择创建初始提交。' : '当前工作区已经是 Git 仓库；若要创建提交，请先配置 Git 用户信息。')
                : (canCommit ? '当前工作区还不是 Git 仓库。推荐初始化仓库，方便追踪和回退改动。' : '当前工作区还不是 Git 仓库。若要直接创建初始提交，请先配置 Git 用户信息。');
    }

    // ── Fill State from Extension ──────────────────────

    function fill(data) {
        gitInstalled = !!data.git.installed;
        hasRepo = !!data.git.hasRepo;
        hasGitUser = !!((data.git.localName && data.git.localEmail) || (data.git.globalName && data.git.globalEmail));
        gitMissingWarned = false;

        const projectInit = data.projectInit || {};
        const missing = Array.isArray(projectInit.missing) ? projectInit.missing : [];
        const initText = projectInit.initialized
            ? '已完成初始化'
            : missing.length
                ? '未完成初始化，缺少：' + missing.join('、')
                : '未完成初始化';
        $('state').textContent = data.workspaceRoot
            + ' | ' + initText;

        if (!$('projectName').value) { $('projectName').value = data.workspaceName || '未命名项目'; }
        if (!$('projectAuthor').value) { $('projectAuthor').value = data.git.localName || data.git.globalName || '作者'; }

        $('gitUserName').value = data.git.localName || data.git.globalName || $('gitUserName').value;
        $('gitUserEmail').value = data.git.localEmail || data.git.globalEmail || $('gitUserEmail').value;

        $('configureGitUser').checked = gitInstalled && !hasGitUser;
        $('initGitRepo').checked = gitInstalled && !hasRepo;
        $('initialCommit').checked = gitInstalled && !hasRepo && hasGitUser;

        syncModeUi();
        syncGitOptions();
        renderPage();
    }

    // ── Collect Form Data ──────────────────────────────

    function collect() {
        return {
            wizardMode,
            projectName: $('projectName').value,
            projectDescription: $('projectDescription').value,
            projectAuthor: $('projectAuthor').value,
            projectSummary: $('projectSummary').value,
            projectTags: parseList($('projectTags').value),
            rolesFile: $('rolesFile').value,
            sensitiveWordsFile: $('sensitiveWordsFile').value,
            vocabularyFile: $('vocabularyFile').value,
            regexPatternsFile: $('regexPatternsFile').value,
            defaultRoleLookupKeys: parseList($('defaultRoleLookupKeys').value),
            extendedLookupKeyPrefixes: parseList($('extendedLookupKeyPrefixes').value),
            characterFileKeywords: parseList($('characterFileKeywords').value),
            sensitiveWordsFileKeywords: parseList($('sensitiveWordsFileKeywords').value),
            vocabularyFileKeywords: parseList($('vocabularyFileKeywords').value),
            regexFileKeywords: parseList($('regexFileKeywords').value),
            initGitRepo: $('initGitRepo').checked && !$('initGitRepo').disabled,
            configureGitUser: $('configureGitUser').checked && !$('configureGitUser').disabled,
            gitUserName: $('gitUserName').value,
            gitUserEmail: $('gitUserEmail').value,
            gitUserScope: $('gitUserScope').value,
            createStructure: $('createStructure').checked,
            writingStatsMode: $('writingStatsMode').value,
            ignoreHistory: $('ignoreHistory').checked,
            wcIgnoreVscode: $('wcIgnoreVscode').checked,
            wcIgnoreOutOfInsights: $('wcIgnoreOutOfInsights').checked,
            openWithRoleManager: $('openWithRoleManager').checked,
            initialCommit: $('initialCommit').checked && !$('initialCommit').disabled,
        };
    }

    // ── Summary ────────────────────────────────────────

    function renderSummary() {
        const data = collect();
        const items = [
            ['向导模式', wizardMode === 'pro' ? '专业版' : '小白版'],
            ['项目名称', data.projectName],
            ['作者', data.projectAuthor],
            ['标签', data.projectTags.join('、') || '无'],
            ['Git 账户', data.configureGitUser ? '写入 ' + data.gitUserScope : '不修改'],
            ['Git 仓库', data.initGitRepo ? '初始化仓库' : (hasRepo ? '沿用已有仓库' : '不初始化')],
            ['初始提交', data.initialCommit ? '创建' : '不创建'],
            ['示例资源结构', data.createStructure ? '创建' : '不创建'],
            ['写作统计数据库', data.writingStatsMode === 'ignore' ? '不纳入版本控制' : '纳入版本控制'],
            ['角色卡编辑器打开 JSON5', data.openWithRoleManager ? '启用' : '不启用'],
        ];

        if (wizardMode === 'pro') {
            items.splice(4, 0,
                ['角色写入目标', data.rolesFile || '（默认）'],
                ['敏感词写入目标', data.sensitiveWordsFile || '（默认）'],
                ['词汇写入目标', data.vocabularyFile || '（默认）'],
                ['正则写入目标', data.regexPatternsFile || '（默认）'],
                ['默认角色索引键', data.defaultRoleLookupKeys.join('、') || '（默认）'],
                ['扩展索引键前缀', data.extendedLookupKeyPrefixes.join('、') || '（默认）'],
                ['角色文件关键词', data.characterFileKeywords.join('、') || '（默认）'],
                ['敏感词文件关键词', data.sensitiveWordsFileKeywords.join('、') || '（默认）'],
                ['词汇文件关键词', data.vocabularyFileKeywords.join('、') || '（默认）'],
                ['正则文件关键词', data.regexFileKeywords.join('、') || '（默认）']
            );
        } else {
            items.splice(4, 0,
                ['项目配置', '使用推荐默认值'],
                ['资源识别规则', '使用系统默认']
            );
        }

        $('summary').innerHTML = items.map(item =>
            '<div><strong>' + escapeHtml(item[0]) + '：</strong>' + escapeHtml(item[1]) + '</div>'
        ).join('');
    }

    // ── Message Handler ────────────────────────────────

    window.addEventListener('message', event => {
        const msg = event.data || {};
        if (msg.command === 'state') { fill(msg.data); }
        if (msg.command === 'error') { notice(msg.message || '执行失败'); }
        if (msg.command === 'done') {
            currentStep = Math.max(0, visibleSteps.indexOf(7));
            $('log').innerHTML = (msg.log || []).map(line =>
                '<div>' + escapeHtml(line) + '</div>'
            ).join('') || '已完成。';
            renderPage();
        }
    });

    // ── Event Listeners ────────────────────────────────

    $('reload').addEventListener('click', () => vscode.postMessage({ command: 'reload' }));
    $('openGitDownload').addEventListener('click', () => vscode.postMessage({ command: 'openGitDownload' }));
    $('configureGitUser').addEventListener('change', syncGitOptions);
    $('initGitRepo').addEventListener('change', syncGitOptions);
    document.querySelectorAll('input[name="wizardMode"]').forEach(input => {
        input.addEventListener('change', event => {
            wizardMode = event.target && event.target.value === 'pro' ? 'pro' : 'novice';
            syncModeUi();
            renderPage();
        });
    });

    $('back').addEventListener('click', () => {
        if (currentStep > 0) { goToStep(currentStep - 1); }
    });

    $('next').addEventListener('click', () => {
        if (validateStep() && currentStep < visibleSteps.length - 2) { goToStep(currentStep + 1); }
    });

    $('run').addEventListener('click', () => {
        const data = collect();
        $('log').textContent = '正在执行...';
        vscode.postMessage({ command: 'run', data });
    });

    $('openGuide').addEventListener('click', () => vscode.postMessage({ command: 'openGuide' }));
    $('close').addEventListener('click', () => vscode.postMessage({ command: 'close' }));

    // ── Init ───────────────────────────────────────────

    renderProgress();
    syncModeUi();
    renderPage();
    vscode.postMessage({ command: 'ready' });
})();
