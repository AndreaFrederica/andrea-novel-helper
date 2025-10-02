# 切换到 TypeScript 模式

Write-Host "正在切换到 TypeScript 模式..." -ForegroundColor Cyan

# 读取 package.json
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json

# 修改 main 字段
$packageJson.main = "./out/extension.js"

# 保存 package.json
$packageJson | ConvertTo-Json -Depth 100 | Set-Content "package.json"

# 复制对应的 .vscodeignore
Copy-Item ".vscodeignore.tsc" ".vscodeignore" -Force

Write-Host "✓ 已切换到 TypeScript 模式 (入口: ./out/extension.js)" -ForegroundColor Green

Write-Host "`n配置完成! 现在可以运行:" -ForegroundColor Cyan
Write-Host "  pixi run watch    # 监视编译" -ForegroundColor White
Write-Host "  pixi run build    # 编译一次" -ForegroundColor White
Write-Host "然后在 VS Code 中按 F5 选择 'Run Extension (TypeScript)'" -ForegroundColor White
