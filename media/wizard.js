// @ts-nocheck
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const $ = id => document.getElementById(id);

    const stepTitles = ['欢迎', '项目信息', '项目配置', 'Git 账户', 'Git 仓库', '项目文件', '确认', '完成'];
    let currentStep = 0;
    let gitInstalled = false;
    let hasRepo = false;
    let hasGitUser = false;

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

    // ── Stepper ────────────────────────────────────────

    function renderStepper() {
        const container = $('stepper');
        container.innerHTML = stepTitles.map((title, index) => {
            const isActive = index === currentStep;
            const isDone = index < currentStep;
            const cls = isActive ? 'active' : isDone ? 'completed' : '';

            let inner;
            if (isDone) {
                inner = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">'
                    + '<path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
                    + '</svg>';
            } else {
                inner = String(index + 1);
            }

            const circle = '<div class="step-circle">' + inner + '</div>';
            const label = '<span class="step-label">' + title + '</span>';
            const line = index < stepTitles.length - 1 ? '<div class="stepper-line"></div>' : '';

            return '<div class="stepper-item ' + cls + '">' + circle + label + '</div>' + line;
        }).join('');
    }

    // ── Page Navigation ────────────────────────────────

    function renderPage() {
        const sections = document.querySelectorAll('.wizard-step');
        sections.forEach(section => {
            const step = Number(section.getAttribute('data-step'));
            const isActive = step === currentStep;
            section.classList.toggle('active', isActive);
            section.classList.remove('exiting');
        });

        renderStepper();

        $('back').disabled = currentStep === 0 || currentStep === 7;
        $('next').classList.toggle('hidden', currentStep >= 6);
        $('run').classList.toggle('hidden', currentStep !== 6);
        $('openGuide').classList.toggle('hidden', currentStep !== 7);
        $('close').classList.toggle('hidden', currentStep !== 7);

        if (currentStep === 6) {
            renderSummary();
        }
    }

    function goToStep(nextStep) {
        if (nextStep === currentStep || nextStep < 0 || nextStep >= stepTitles.length) return;

        const currentSection = document.querySelector('.wizard-step[data-step="' + currentStep + '"]');
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
        if (currentStep === 1) {
            if (!$('projectName').value.trim()) { notice('项目名称不能为空。'); return false; }
            if (!$('projectAuthor').value.trim()) { notice('作者不能为空。'); return false; }
        }
        if (currentStep === 3 && $('configureGitUser').checked) {
            if (!$('gitUserName').value.trim()) { notice('请输入 Git 用户名。'); return false; }
            if (!/.+@.+/.test($('gitUserEmail').value)) { notice('请输入有效的 Git 邮箱。'); return false; }
        }
        return true;
    }

    // ── Git State Sync ─────────────────────────────────

    function syncGitOptions() {
        $('gitInstallActions').classList.toggle('hidden', gitInstalled);
        $('configureGitUser').disabled = !gitInstalled;
        $('gitUserName').disabled = !gitInstalled || !$('configureGitUser').checked;
        $('gitUserEmail').disabled = !gitInstalled || !$('configureGitUser').checked;
        $('gitUserScope').disabled = !gitInstalled || !$('configureGitUser').checked;
        $('initGitRepo').disabled = !gitInstalled || hasRepo;
        $('initialCommit').disabled = !gitInstalled || (!hasRepo && !$('initGitRepo').checked);

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
                ? '当前工作区已经是 Git 仓库，可以选择创建初始提交。'
                : '当前工作区还不是 Git 仓库。推荐初始化仓库，方便追踪和回退改动。';
    }

    // ── Fill State from Extension ──────────────────────

    function fill(data) {
        gitInstalled = !!data.git.installed;
        hasRepo = !!data.git.hasRepo;
        hasGitUser = !!((data.git.localName && data.git.localEmail) || (data.git.globalName && data.git.globalEmail));

        $('state').textContent = data.workspaceRoot
            + ' | ' + (data.configExists ? '已有 anhproject.md' : '未创建 anhproject.md')
            + '，' + (data.keywordConfigExists ? '已有 project-config.json5' : '未创建 project-config.json5');

        if (!$('projectName').value) { $('projectName').value = data.workspaceName || '未命名项目'; }
        if (!$('projectAuthor').value) { $('projectAuthor').value = data.git.localName || data.git.globalName || '作者'; }

        $('gitUserName').value = data.git.localName || data.git.globalName || $('gitUserName').value;
        $('gitUserEmail').value = data.git.localEmail || data.git.globalEmail || $('gitUserEmail').value;

        $('configureGitUser').checked = gitInstalled && !hasGitUser;
        $('initGitRepo').checked = gitInstalled && !hasRepo;
        $('initialCommit').checked = gitInstalled && !hasRepo;

        syncGitOptions();
        renderPage();
    }

    // ── Collect Form Data ──────────────────────────────

    function collect() {
        return {
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
            initialCommit: $('initialCommit').checked && !$('initialCommit').disabled,
        };
    }

    // ── Summary ────────────────────────────────────────

    function renderSummary() {
        const data = collect();
        const items = [
            ['项目名称', data.projectName],
            ['作者', data.projectAuthor],
            ['标签', data.projectTags.join('、') || '无'],
            ['角色写入目标', data.rolesFile || '（默认）'],
            ['敏感词写入目标', data.sensitiveWordsFile || '（默认）'],
            ['词汇写入目标', data.vocabularyFile || '（默认）'],
            ['正则写入目标', data.regexPatternsFile || '（默认）'],
            ['默认角色索引键', data.defaultRoleLookupKeys.join('、') || '（默认）'],
            ['扩展索引键前缀', data.extendedLookupKeyPrefixes.join('、') || '（默认）'],
            ['角色文件关键词', data.characterFileKeywords.join('、') || '（默认）'],
            ['敏感词文件关键词', data.sensitiveWordsFileKeywords.join('、') || '（默认）'],
            ['词汇文件关键词', data.vocabularyFileKeywords.join('、') || '（默认）'],
            ['正则文件关键词', data.regexFileKeywords.join('、') || '（默认）'],
            ['Git 账户', data.configureGitUser ? '写入 ' + data.gitUserScope : '不修改'],
            ['Git 仓库', data.initGitRepo ? '初始化仓库' : (hasRepo ? '沿用已有仓库' : '不初始化')],
            ['初始提交', data.initialCommit ? '创建' : '不创建'],
            ['示例资源结构', data.createStructure ? '创建' : '不创建'],
            ['写作统计数据库', data.writingStatsMode === 'ignore' ? '不纳入版本控制' : '纳入版本控制'],
        ];
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
            currentStep = 7;
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

    $('back').addEventListener('click', () => {
        if (currentStep > 0) { goToStep(currentStep - 1); }
    });

    $('next').addEventListener('click', () => {
        if (validateStep() && currentStep < 6) { goToStep(currentStep + 1); }
    });

    $('run').addEventListener('click', () => {
        const data = collect();
        $('log').textContent = '正在执行...';
        vscode.postMessage({ command: 'run', data });
    });

    $('openGuide').addEventListener('click', () => vscode.postMessage({ command: 'openGuide' }));
    $('close').addEventListener('click', () => vscode.postMessage({ command: 'close' }));

    // ── Init ───────────────────────────────────────────

    renderStepper();
    renderPage();
    vscode.postMessage({ command: 'ready' });
})();
