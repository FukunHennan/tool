#!/usr/bin/env pwsh
# 本地跑一遍与 CI 相同的检查。
# 用法：
#   pwsh scripts/check.ps1          # 自动模式：CI 用 npm ci，本地已有 node_modules 时用 npm install
#   pwsh scripts/check.ps1 -Fast    # 强制本地快速安装
#   pwsh scripts/check.ps1 -Plan    # 只打印将要执行的命令，不运行

param(
    [switch]$Fast,
    [switch]$Plan
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()

function Get-NpmInstallArguments {
    param([string]$Directory)

    $nodeModules = Join-Path $Directory 'node_modules'
    $useInstall = $Fast -or (-not $env:CI -and (Test-Path $nodeModules))
    if ($useInstall) {
        return @('install', '--no-audit', '--no-fund')
    }
    return @('ci', '--no-audit', '--no-fund')
}

function Invoke-NpmInstall {
    param([string]$Directory)

    $arguments = Get-NpmInstallArguments $Directory
    & npm @arguments
}

function Invoke-Check {
    param(
        [string]$Name,
        [string]$Directory,
        [string]$Command,
        [scriptblock]$Action
    )

    Write-Host "`n=== $Name" -ForegroundColor Cyan
    if ($Plan) {
        Write-Host "    $Command" -ForegroundColor Yellow
        return
    }

    Push-Location (Join-Path $root $Directory)
    try {
        & $Action
        if ($LASTEXITCODE -ne 0) { throw "退出码 $LASTEXITCODE" }
        Write-Host "    ok" -ForegroundColor Green
    }
    catch {
        Write-Host "    失败: $($_.Exception.Message)" -ForegroundColor Red
        $script:failures.Add($Name)
    }
    finally {
        Pop-Location
    }
}

$pcbDirectory = Join-Path $root 'projects/pcb-cabinet'
$espDirectory = Join-Path $root 'projects/esp-flasher'
$pcbInstallArguments = Get-NpmInstallArguments $pcbDirectory
$espInstallArguments = Get-NpmInstallArguments $espDirectory
$pcbInstallCommand = "npm $($pcbInstallArguments -join ' ')"
$espInstallCommand = "npm $($espInstallArguments -join ' ')"

Invoke-Check '出行地图 · Python 接口测试' 'projects/travel' 'python -m unittest discover -s tests' {
    python -m unittest discover -s tests
}

Invoke-Check '出行地图 · Node 存储测试' 'projects/travel' 'node --test tests/storage.test.cjs' {
    node --test tests/storage.test.cjs
}

Invoke-Check 'PCB 物料柜 · 安装依赖' 'projects/pcb-cabinet' $pcbInstallCommand {
    Invoke-NpmInstall $pcbDirectory
}

Invoke-Check 'PCB 物料柜 · 单元测试' 'projects/pcb-cabinet' 'npm test' {
    npm test
}

Invoke-Check 'PCB 物料柜 · 构建' 'projects/pcb-cabinet' 'npm run build' {
    npm run build
}

Invoke-Check 'ESP32 烧录器 · 安装依赖' 'projects/esp-flasher' $espInstallCommand {
    Invoke-NpmInstall $espDirectory
}

Invoke-Check 'ESP32 烧录器 · 单元测试' 'projects/esp-flasher' 'npm test' {
    npm test
}

Invoke-Check 'ESP32 烧录器 · 构建' 'projects/esp-flasher' 'npm run build' {
    npm run build
}

Invoke-Check '串口助手 · 桥接协议测试' 'projects/serial' 'python -m unittest discover -s tests' {
    python -m unittest discover -s tests
}

Invoke-Check '串口助手 · 逻辑层测试' 'projects/serial/web' 'node --test' {
    node --test
}

if ($failures.Count -gt 0) {
    Write-Host "`n失败项: $($failures -join '、')" -ForegroundColor Red
    exit 1
}

if (-not $Plan) {
    Write-Host "`n全部通过" -ForegroundColor Green
}
