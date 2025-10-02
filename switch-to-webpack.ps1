# 切换到 Webpack 模式并打包

Write-Host "正在切换到 Webpack 模式..." -ForegroundColor Cyan

# 读取 package.json
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json

# 修改 main 字段
$packageJson.main = "./dist/extension.js"

# 保存 package.json
$packageJson | ConvertTo-Json -Depth 100 | Set-Content "package.json"

# 复制对应的 .vscodeignore
Copy-Item ".vscodeignore.webpack" ".vscodeignore" -Force

Write-Host "✓ 已切换到 Webpack 模式 (入口: ./dist/extension.js)" -ForegroundColor Green

# 删除旧的 VSIX 文件(如果存在)
$vsixFiles = Get-ChildItem -Filter "*.vsix"
if ($vsixFiles) {
    Write-Host "正在删除旧的 VSIX 文件..." -ForegroundColor Yellow
    foreach ($file in $vsixFiles) {
        try {
            Remove-Item $file.FullName -Force
            Write-Host "✓ 已删除: $($file.Name)" -ForegroundColor Green
        }
        catch {
            Write-Host "✗ 无法删除 $($file.Name): $_" -ForegroundColor Red
            Write-Host "提示: 请关闭所有使用该文件的程序" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n配置完成! 现在可以运行:" -ForegroundColor Cyan
Write-Host "  pixi run build_all_webpack  # 编译" -ForegroundColor White
Write-Host "  pixi run package            # 打包" -ForegroundColor White
