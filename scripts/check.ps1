#!/usr/bin/env pwsh
# 本地跑一遍与 CI 完全相同的检查（对应 docs/ci/tests.yml）。
# 用法：pwsh scripts/check.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()

function Invoke-Check {
    param([string]$Name, [string]$Directory, [scriptblock]$Action)
    Write-Host "`n=== $Name" -ForegroundColor Cyan
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

Invoke-Check '出行地图 · Python 接口测试' 'projects/travel' { python -m unittest discover -s tests }
Invoke-Check '出行地图 · Node 存储测试' 'projects/travel' { node --test tests/storage.test.cjs }
Invoke-Check 'PCB 物料柜 · 安装依赖' 'projects/pcb-cabinet' { npm ci --no-audit --no-fund }
Invoke-Check 'PCB 物料柜 · 单元测试' 'projects/pcb-cabinet' { npm test }
Invoke-Check 'PCB 物料柜 · 构建' 'projects/pcb-cabinet' { npm run build }
Invoke-Check 'ESP32 烧录器 · 单元测试与构建' 'projects/esp-flasher' {
  npm ci --no-audit --no-fund
  npm test
  npm run build
}
Invoke-Check '串口助手 · 桥接协议测试' 'projects/serial' { python -m unittest discover -s tests }
Invoke-Check '串口助手 · 逻辑层测试' 'projects/serial/web' { node --test }

if ($failures.Count -gt 0) {
    Write-Host "`n失败项: $($failures -join '、')" -ForegroundColor Red
    exit 1
}
Write-Host "`n全部通过" -ForegroundColor Green
