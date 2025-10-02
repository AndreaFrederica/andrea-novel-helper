# 智能打包脚本 - 自动处理文件锁定问题

param(
    [switch]$Webpack,
    [switch]$TypeScript,
    [switch]$Clean
)

function Remove-OldVsix {
    Write-Host "`n正在检查旧的 VSIX 文件..." -ForegroundColor Cyan
    $vsixFiles = Get-ChildItem -Filter "*.vsix"
    
    if ($vsixFiles) {
        foreach ($file in $vsixFiles) {
            $retryCount = 0
            $maxRetries = 3
            
            while ($retryCount -lt $maxRetries) {
                try {
                    Remove-Item $file.FullName -Force -ErrorAction Stop
                    Write-Host "✓ 已删除: $($file.Name)" -ForegroundColor Green
                    break
                }
                catch {
                    $retryCount++
                    if ($retryCount -lt $maxRetries) {
                        Write-Host "✗ 文件被锁定,等待 2 秒后重试... ($retryCount/$maxRetries)" -ForegroundColor Yellow
                        Start-Sleep -Seconds 2
                    }
                    else {
                        Write-Host "✗ 无法删除 $($file.Name)" -ForegroundColor Red
                        Write-Host "请手动关闭占用该文件的程序,或重启 VS Code" -ForegroundColor Yellow
                        return $false
                    }
                }
            }
        }
    }
    else {
        Write-Host "没有找到旧的 VSIX 文件" -ForegroundColor Gray
    }
    return $true
}

# 显示帮助
if (-not $Webpack -and -not $TypeScript) {
    Write-Host "用法:" -ForegroundColor Cyan
    Write-Host "  .\package.ps1 -Webpack      # 使用 Webpack 模式打包 (推荐)" -ForegroundColor White
    Write-Host "  .\package.ps1 -TypeScript   # 使用 TypeScript 模式打包" -ForegroundColor White
    Write-Host "  .\package.ps1 -Webpack -Clean  # 打包前清理编译产物" -ForegroundColor White
    exit
}

# 清理编译产物
if ($Clean) {
    Write-Host "`n正在清理编译产物..." -ForegroundColor Cyan
    Remove-Item -Recurse -Force out, dist -ErrorAction SilentlyContinue
    Write-Host "✓ 清理完成" -ForegroundColor Green
}

# 处理 Webpack 模式
if ($Webpack) {
    Write-Host "`n========== Webpack 模式打包 ==========" -ForegroundColor Magenta
    
    # 切换模式
    Write-Host "`n1. 切换到 Webpack 模式..." -ForegroundColor Cyan
    & .\switch-to-webpack.ps1
    
    # 编译 webview
    Write-Host "`n2. 编译 Webview..." -ForegroundColor Cyan
    npm run build:webview
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Webview 编译失败" -ForegroundColor Red
        exit 1
    }
    
    # 编译扩展
    Write-Host "`n3. 编译扩展 (Webpack)..." -ForegroundColor Cyan
    npm run build:extension
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ 扩展编译失败" -ForegroundColor Red
        exit 1
    }
    
    # 删除旧 VSIX
    if (-not (Remove-OldVsix)) {
        exit 1
    }
    
    # 打包
    Write-Host "`n4. 打包 VSIX..." -ForegroundColor Cyan
    npx vsce package
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✓ 打包成功!" -ForegroundColor Green
        $vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
        if ($vsixFile) {
            Write-Host "文件: $($vsixFile.Name)" -ForegroundColor White
            Write-Host "大小: $([math]::Round($vsixFile.Length / 1MB, 2)) MB" -ForegroundColor White
        }
    }
    else {
        Write-Host "`n✗ 打包失败" -ForegroundColor Red
    }
}

# 处理 TypeScript 模式
if ($TypeScript) {
    Write-Host "`n========== TypeScript 模式打包 ==========" -ForegroundColor Magenta
    
    # 切换模式
    Write-Host "`n1. 切换到 TypeScript 模式..." -ForegroundColor Cyan
    & .\switch-to-tsc.ps1
    
    # 编译 webview
    Write-Host "`n2. 编译 Webview..." -ForegroundColor Cyan
    npm run build:webview
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ Webview 编译失败" -ForegroundColor Red
        exit 1
    }
    
    # 编译扩展
    Write-Host "`n3. 编译扩展 (TypeScript)..." -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) {
        Write-Host "✗ 扩展编译失败" -ForegroundColor Red
        exit 1
    }
    
    # 删除旧 VSIX
    if (-not (Remove-OldVsix)) {
        exit 1
    }
    
    # 打包
    Write-Host "`n4. 打包 VSIX..." -ForegroundColor Cyan
    npx vsce package
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n✓ 打包成功!" -ForegroundColor Green
        $vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
        if ($vsixFile) {
            Write-Host "文件: $($vsixFile.Name)" -ForegroundColor White
            Write-Host "大小: $([math]::Round($vsixFile.Length / 1MB, 2)) MB" -ForegroundColor White
        }
    }
    else {
        Write-Host "`n✗ 打包失败" -ForegroundColor Red
    }
}
