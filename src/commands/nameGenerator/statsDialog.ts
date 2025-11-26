import * as vscode from 'vscode';

/**
 * 显示统计对话框
 */
export async function showStatsDialog(stats: any): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		'nameStats',
		'名字生成统计',
		vscode.ViewColumn.One,
		{}
	);

	const html = `
	<!DOCTYPE html>
	<html lang="zh-CN">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>名字生成统计</title>
		<style>
			body { font-family: var(--vscode-font-family); padding: 20px; }
			.stats-section { margin-bottom: 30px; }
			.stats-title { font-size: 16px; font-weight: bold; margin-bottom: 15px; color: var(--vscode-editor-foreground); }
			.stat-item { display: flex; justify-content: space-between; margin: 8px 0; padding: 5px 0; border-bottom: 1px solid var(--vscode-panel-border); }
			.stat-label { color: var(--vscode-descriptionForeground); }
			.stat-value { font-weight: bold; color: var(--vscode-editor-foreground); }
		</style>
	</head>
	<body>
		<h2>名字生成统计</h2>

		<div class="stats-section">
			<div class="stats-title">总体统计</div>
			<div class="stat-item">
				<span class="stat-label">总生成次数:</span>
				<span class="stat-value">${stats.totalGenerated}</span>
			</div>
		</div>

		<div class="stats-section">
			<div class="stats-title">按文化分类</div>
			${Object.entries(stats.byCulture).map(([culture, count]) => `
				<div class="stat-item">
					<span class="stat-label">${culture}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>

		<div class="stats-section">
			<div class="stats-title">按性别分类</div>
			${Object.entries(stats.byGender).map(([gender, count]) => `
				<div class="stat-item">
					<span class="stat-label">${gender}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>

		<div class="stats-section">
			<div class="stats-title">按风格分类</div>
			${Object.entries(stats.byStyle).map(([style, count]) => `
				<div class="stat-item">
					<span class="stat-label">${style}:</span>
					<span class="stat-value">${count}</span>
				</div>
			`).join('')}
		</div>
	</body>
	</html>
	`;

	panel.webview.html = html;
}