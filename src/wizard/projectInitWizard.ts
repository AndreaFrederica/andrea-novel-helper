import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createCharacterGalleryFile, createSensitiveWordsFile, createVocabularyFile, createRegexPatternsFile, ensureDir } from './packageFileCreators';
import { generateMarkdownRoleTemplate } from '../templates/templateGenerators';
import { exec } from 'child_process';

// 标记：项目初始化向导是否正在运行（用于抑制其它 Git 配置弹窗等）
export let projectInitWizardRunning = false;

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
  const quoted = args.map(a => /^[A-Za-z0-9._:\/@=-]+$/.test(a) ? a : '"' + a.replace(/"/g, '\"') + '"');
  const cmd = `git ${quoted.join(' ')}`;
  return new Promise(resolve => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      resolve({ code: err ? (err as any).code || 1 : 0, stdout: stdout.trim(), stderr: stderr.trim(), cmd });
    });
  });
}

async function isGitInstalled(cwd: string): Promise<boolean> {
  const r = await runGit(['--version'], cwd);
  return r.code === 0;
}

async function getGitUserConfigState(cwd: string): Promise<{ hasAny: boolean; globalName: string; globalEmail: string; localName: string; localEmail: string; }> {
  const globalName = (await runGit(['config','--global','user.name'], cwd)).stdout;
  const globalEmail = (await runGit(['config','--global','user.email'], cwd)).stdout;
  const localName = (await runGit(['config','--local','user.name'], cwd)).stdout;
  const localEmail = (await runGit(['config','--local','user.email'], cwd)).stdout;
  const hasAny = !!((localName && localEmail) || (globalName && globalEmail));
  return { hasAny, globalName, globalEmail, localName, localEmail };
}

export function registerProjectInitWizard(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('AndreaNovelHelper.projectInitWizard', async () => {
      projectInitWizardRunning = true;
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) { vscode.window.showErrorMessage('未打开工作区'); return; }
      try {
      // -------- 新向导：先收集所有决策，再一次执行 --------
      let aborted = false;
      const abort = () => { aborted = true; };

      const gitInstalled = await isGitInstalled(ws);
      let needInitRepo = false;
      let hasRepo = fs.existsSync(path.join(ws, '.git'));
      let wantInitialCommit = false;
      let createStructure = false;
      let configureGitUser = false;
      let gitUserName = '';
      let gitUserEmail = '';
      let gitUserScope: 'global' | 'local' = 'global';
  let versionControlWritingStats: boolean | undefined = undefined; // 未询问前 undefined
  // 新增：通用忽略项选择
  let ignoreHistory = true; // .gitignore:.history/
  let wcIgnoreVscode = true; // .wcignore:.vscode/
  let wcIgnoreOutOfInsights = true; // .wcignore:.out-of-code-insights/

      // Git 用户配置优先（若安装了 Git）
  if (gitInstalled) {
        const configState = await getGitUserConfigState(ws);
        if (!configState.hasAny) {
          const pickCfg = await vscode.window.showQuickPick(['配置 Git 用户信息', '跳过'], { placeHolder: '未检测到 Git 用户名/邮箱，是否现在配置？(稍后统一执行)' });
          if (!pickCfg) { abort(); }
          else if (pickCfg === '配置 Git 用户信息') {
            configureGitUser = true;
            const name = await vscode.window.showInputBox({ prompt: '输入 Git 用户名 (user.name)', ignoreFocusOut: true, validateInput: v => v.trim() ? undefined : '不能为空' });
            if (!name) { abort(); }
            else { gitUserName = name.trim(); }
            if (!aborted) {
              const email = await vscode.window.showInputBox({ prompt: '输入 Git 邮箱 (user.email)', ignoreFocusOut: true, validateInput: v => /.+@.+/.test(v) ? undefined : '请输入有效邮箱' });
              if (!email) { abort(); } else { gitUserEmail = email.trim(); }
            }
            if (!aborted) {
              // 仅当已有仓库才提供 local 选项，否则让用户选择稍后是否初始化仓库
              const scopePickItems = hasRepo ? ['全局 (global)','仅当前仓库 (local)'] : ['全局 (global)','本向导稍后创建仓库后再写入 local'];
              const scopePick = await vscode.window.showQuickPick(scopePickItems, { placeHolder: '选择配置作用域（稍后执行）' });
              if (!scopePick) { abort(); }
              else if (scopePick.startsWith('全局')) { gitUserScope = 'global'; }
              else { gitUserScope = 'local'; }
            }
          }
        }
      } else {
        const act = await vscode.window.showWarningMessage('未检测到 Git。请先安装 Git 再重新运行向导。', { modal: true }, '打开下载页面', '退出向导');
        if (act === '打开下载页面') {
          void vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
        }
        // 视为向导失败，强制中止（后续会提示是否重新运行）
        abort();
      }

      if (!aborted && gitInstalled && !hasRepo) {
        const repoPick = await vscode.window.showQuickPick(['初始化 Git 仓库','跳过'], { placeHolder: '当前目录未初始化 Git，是否创建？(稍后执行)' });
        if (!repoPick) { abort(); } else if (repoPick === '初始化 Git 仓库') { needInitRepo = true; }
      }

      if (!aborted) {
        const structPick = await vscode.window.showQuickPick(['创建示例结构与文件','跳过'], { placeHolder: '是否创建 novel-helper 示例角色/词库结构？(稍后执行)' });
        if (!structPick) { abort(); } else if (structPick === '创建示例结构与文件') { createStructure = true; }
      }

      // 询问写作统计数据库是否纳入版本控制
      if (!aborted) {
        const wcPick = await vscode.window.showQuickPick([
          '不纳入（推荐，避免提交个人写作行为数据）',
          '纳入版本控制（可随仓库同步多端写作进度）'
        ], { placeHolder: '是否将写作统计数据库 (novel-helper/.anh-fsdb) 纳入版本控制？' });
        if (!wcPick) { abort(); } else { versionControlWritingStats = wcPick.startsWith('纳入') ? true : false; }
      }

      // 勾选忽略的辅助目录（与写作统计数据库无关，三项默认勾选）
      if (!aborted) {
        const picks = await vscode.window.showQuickPick([
          { label: '忽略 .history (推荐)', picked: true, description: '.gitignore: .history/' },
          { label: '忽略 .vscode (写作统计扫描排除 - 推荐)', picked: true, description: '.wcignore: .vscode/' },
          { label: '忽略 .out-of-code-insights (划词注解扩展数据目录 - 推荐)', picked: true, description: '.wcignore: .out-of-code-insights/' }
        ], { canPickMany: true, placeHolder: '选择需要忽略的辅助目录（推荐全部勾选）' });
        if (!picks) { abort(); }
        else {
          ignoreHistory = picks.some(p => p.label.startsWith('忽略 .history'));
          wcIgnoreVscode = picks.some(p => p.label.startsWith('忽略 .vscode'));
          wcIgnoreOutOfInsights = picks.some(p => p.label.includes('.out-of-code-insights'));
        }
      }

      if (!aborted && gitInstalled && (hasRepo || needInitRepo)) {
        const commitPick = await vscode.window.showQuickPick(['创建初始提交','跳过'], { placeHolder: '是否创建初始提交？(稍后执行)' });
        if (!commitPick) { abort(); } else if (commitPick === '创建初始提交') { wantInitialCommit = true; }
      }

      if (aborted) {
  const retry = await vscode.window.showInformationMessage('项目初始化向导未完成，是否重新运行？', { modal: true }, '重新运行','关闭');
        if (retry === '重新运行') { vscode.commands.executeCommand('AndreaNovelHelper.projectInitWizard'); }
        return;
      }

      // 最终确认概要
      const summary: string[] = [];
      if (gitInstalled) {
        if (configureGitUser) { summary.push(`配置Git用户(${gitUserScope})`); }
        if (needInitRepo) { summary.push('初始化仓库'); }
        else if (hasRepo) { summary.push('已有仓库'); }
      } else { summary.push('Git未安装'); }
      if (createStructure) { summary.push('创建示例结构'); }
  if (versionControlWritingStats === false) { summary.push('忽略写作统计数据库'); }
  else if (versionControlWritingStats === true) { summary.push('跟踪写作统计数据库'); }
  if (ignoreHistory) { summary.push('忽略 .history'); }
  if (wcIgnoreVscode) { summary.push('.wcignore 忽略 .vscode'); }
  if (wcIgnoreOutOfInsights) { summary.push('.wcignore 忽略 .out-of-code-insights'); }
      if (wantInitialCommit) { summary.push('初始提交'); }
  const confirm = await vscode.window.showInformationMessage(`确认执行: ${summary.join('，')} ?`, { modal: true }, '执行','取消');
  if (confirm !== '执行') { vscode.window.showInformationMessage('已取消执行', { modal: true }, '关闭'); return; }

      // -------- 执行阶段 --------
      try {
        if (gitInstalled) {
          if (needInitRepo) {
            const initRes = await runGit(['init'], ws);
            if (initRes.code !== 0) { vscode.window.showErrorMessage('Git 仓库初始化失败: '+initRes.stderr); }
            else { hasRepo = true; }
          }
          if (configureGitUser) {
            const scopeFlag = gitUserScope === 'global' ? '--global' : '--local';
            if (scopeFlag === '--local' && !hasRepo) {
              // 兜底：若仍无仓库（用户未选 init 但选了 local），改写为 global
              vscode.window.showWarningMessage('未创建仓库，Git 用户 local 配置改为全局。');
            }
            const finalScope = (scopeFlag === '--local' && hasRepo) ? '--local' : '--global';
            const setName = await runGit(['config', finalScope, 'user.name', gitUserName], ws);
            if (setName.code !== 0) { vscode.window.showErrorMessage('设置 user.name 失败: '+setName.stderr); }
            const setEmail = await runGit(['config', finalScope, 'user.email', gitUserEmail], ws);
            if (setEmail.code !== 0) { vscode.window.showErrorMessage('设置 user.email 失败: '+setEmail.stderr); }
          }
        }
        if (createStructure) {
          const root = path.join(ws, 'novel-helper');
          ensureDir(root);
          createCharacterGalleryFile(root);
          createSensitiveWordsFile(root);
          createVocabularyFile(root);
          createRegexPatternsFile(root);
          try {
            // 同步创建一个 Markdown 示例角色库（依赖模板）
            const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
            const rolesFileCfg = cfg.get<string>('rolesFile') || 'novel-helper/roles.json5';
            const mdPath = (() => {
              const absFromCfg = path.isAbsolute(rolesFileCfg) ? rolesFileCfg : path.join(ws, rolesFileCfg);
              const dir = path.dirname(absFromCfg);
              const stem = path.basename(absFromCfg).replace(/\.[^.]+$/, '');
              return path.join(dir, `${stem}.md`);
            })();
            if (!fs.existsSync(mdPath)) {
              fs.mkdirSync(path.dirname(mdPath), { recursive: true });
              fs.writeFileSync(mdPath, generateMarkdownRoleTemplate(), 'utf8');
            }
          } catch { /* ignore markdown creation errors */ }
        }
        // 应用写作统计数据库 gitignore 规则
        if (!aborted && versionControlWritingStats !== undefined) {
          try {
            const gitignorePath = path.join(ws, '.gitignore');
            const ignoreLine = 'novel-helper/.anh-fsdb/';
            let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
            const lines = content.split(/\r?\n/);
            const hasLine = lines.some(l => l.trim() === ignoreLine);
            if (versionControlWritingStats === false && !hasLine) {
              if (content && !content.endsWith('\n')) { content += '\n'; }
              content += ignoreLine + '\n';
              fs.writeFileSync(gitignorePath, content);
              vscode.window.showInformationMessage('已在 .gitignore 添加写作统计数据库忽略条目');
            } else if (versionControlWritingStats === true && hasLine) {
              const newContent = lines.filter(l => l.trim() !== ignoreLine).join('\n');
              fs.writeFileSync(gitignorePath, newContent);
              vscode.window.showInformationMessage('已从 .gitignore 移除写作统计数据库忽略条目');
            }
          } catch (e) {
            vscode.window.showWarningMessage('处理写作统计数据库 .gitignore 规则失败: ' + (e as any)?.message);
          }
        }
        // 处理通用忽略：.gitignore -> .history
        if (!aborted) {
          try {
            if (ignoreHistory) {
              const gitignorePath = path.join(ws, '.gitignore');
              let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
              const line = '.history/';
              if (!content.split(/\r?\n/).some(l => l.trim() === line)) {
                if (content && !content.endsWith('\n')) { content += '\n'; }
                content += line + '\n';
                fs.writeFileSync(gitignorePath, content);
                vscode.window.showInformationMessage('已在 .gitignore 添加 .history/ 忽略');
              }
            }
          } catch (e) {
            vscode.window.showWarningMessage('处理 .history 忽略失败: ' + (e as any)?.message);
          }
        }
        // 处理 .wcignore -> .vscode / .out-of-code-insights
        if (!aborted && (wcIgnoreVscode || wcIgnoreOutOfInsights)) {
          try {
            const wcignorePath = path.join(ws, '.wcignore');
            let content = fs.existsSync(wcignorePath) ? fs.readFileSync(wcignorePath, 'utf8') : '';
            const ensureLine = (line: string) => {
              const exists = content.split(/\r?\n/).some(l => l.trim() === line);
              if (!exists) {
                if (content && !content.endsWith('\n')) { content += '\n'; }
                content += line + '\n';
              }
            };
            if (wcIgnoreVscode) { ensureLine('.vscode/'); }
            if (wcIgnoreOutOfInsights) { ensureLine('.out-of-code-insights/'); }
            fs.writeFileSync(wcignorePath, content);
            vscode.window.showInformationMessage('已更新 .wcignore 忽略目录');
          } catch (e) {
            vscode.window.showWarningMessage('处理 .wcignore 忽略失败: ' + (e as any)?.message);
          }
        }
        if (gitInstalled && (hasRepo || needInitRepo) && wantInitialCommit) {
          const addRes = await runGit(['add','.'], ws);
          if (addRes.code !== 0) { vscode.window.showErrorMessage('git add 失败: '+addRes.stderr); }
          const commitMsg = 'chore: initial novel-helper structure';
          const commitRes = await runGit(['commit','-m', commitMsg], ws);
          if (commitRes.code !== 0) {
            vscode.window.showErrorMessage('初始提交失败: '+commitRes.stderr);
          } else {
            vscode.window.showInformationMessage('已创建初始提交', { modal: true }, '关闭');
          }
        }
  // 向导完成：确保工作区配置中没有禁用本扩展（将 workspaceDisabled 设为 false）
  try {
    const cfg = vscode.workspace.getConfiguration();
    // 将 workspaceDisabled 写入工作区级别（false 表示启用）
    await cfg.update('AndreaNovelHelper.workspaceDisabled', false, vscode.ConfigurationTarget.Workspace);
  } catch (e) {
    console.warn('无法写入 workspace 配置 AndreaNovelHelper.workspaceDisabled:', (e as any)?.message);
  }
  vscode.window.showInformationMessage('项目初始化向导已完成', { modal: true }, '关闭');
      } catch (e) {
        vscode.window.showErrorMessage('执行阶段出现错误: '+(e as any)?.message);
      } finally {
        projectInitWizardRunning = false;
      }
      } catch (e) {
        vscode.window.showErrorMessage('项目初始化向导异常: '+(e as any)?.message);
        projectInitWizardRunning = false;
      }
    })
  );
}
