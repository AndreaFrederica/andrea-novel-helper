param(
  [switch]$Force
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extFile   = Join-Path $scriptDir "extensions.txt"
$outDir    = Join-Path $scriptDir "vsix"

if (-not (Test-Path $extFile)) {
  Write-Error "找不到 $extFile"
  exit 1
}
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function Parse-ExtId($id) {
  $id = $id.Trim()
  if (-not $id) { return $null }
  $version = $null
  if ($id.Contains("@")) {
    $parts = $id.Split("@",2)
    $id = $parts[0]; $version = $parts[1]
  }
  if (-not $id.Contains(".")) { throw "无效扩展标识：$id" }
  $p = $id.Split(".",2)
  [pscustomobject]@{ Publisher=$p[0]; Name=$p[1]; Version=$version; FullId=$id }
}

function Download-One($info) {
  $fileName = "$($info.Publisher).$($info.Name)"
  if ($info.Version) { $fileName += "-$($info.Version)" }
  $fileName += ".vsix"
  $outPath = Join-Path $outDir $fileName

  if ((Test-Path $outPath) -and -not $Force) {
    Write-Host "[Skip] $fileName 已存在"
    return
  }

  # 先试 Marketplace
  try {
    $uri = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery"
    $headers = @{ "Accept"="application/json;api-version=3.0-preview.1"; "Content-Type"="application/json" }
    $body = @{
      filters=@(@{criteria=@(@{filterType=7; value="$($info.Publisher).$($info.Name)"})})
      flags=131
    } | ConvertTo-Json -Depth 5
    $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $body
    $ext = $resp.results[0].extensions[0]
    $vers = @($ext.versions)
    $sel = if ($info.Version) { $vers | Where-Object version -eq $info.Version | Select-Object -First 1 } else { $vers[0] }
    if ($sel) {
      $url = ($sel.files | Where-Object assetType -eq "Microsoft.VisualStudio.Services.VSIXPackage")[0].source
      Write-Host "[MP] 下载 $($info.FullId) ..."
      Invoke-WebRequest -Uri $url -OutFile $outPath
      Write-Host "[OK ] $fileName"
      return
    }
  } catch { Write-Host "[MP] $($info.FullId) 失败" }

  # 回退 OpenVSX
  try {
    $url = if ($info.Version) {
      "https://open-vsx.org/api/$($info.Publisher)/$($info.Name)/$($info.Version)/file/$($info.Publisher).$($info.Name)-$($info.Version).vsix"
    } else {
      "https://open-vsx.org/api/$($info.Publisher)/$($info.Name)/latest/download"
    }
    Write-Host "[OV] 下载 $($info.FullId) ..."
    Invoke-WebRequest -Uri $url -OutFile $outPath
    Write-Host "[OK ] $fileName"
  } catch {
    Write-Warning "下载失败：$($info.FullId)"
  }
}

$items = Get-Content $extFile | Where-Object {$_ -and -not $_.Trim().StartsWith("#")}
foreach ($e in $items) {
  $info = Parse-ExtId $e
  if ($info) { Download-One $info }
}
