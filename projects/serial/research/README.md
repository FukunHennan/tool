# 研究资料归档

本目录保存旧 Web 版（React + Web Serial）的研究成果，供 Rust 版移植参考。
旧项目已删除，这些是唯一留存副本。

## 内容

- `docs/` — 旧版全部设计文档（架构、Web Serial 设计、ESP 检测、逻辑分析仪协议、ADR）
- `SaleaeProtocolProbe.ts` — Saleae 原厂固件协议探针（24MHz/8CH，移植到 rusb 的参考）
- `Fx2LogicAnalyzer.ts` — fx2lafw 固件逻辑分析仪实现
- `NativeLogicBridge.ts` / `WaveformCanvas.tsx` — 波形前端参考
- `esp*.ts` — ESP 检测、Flash 备份、espefuse 安全解析、Excel 导出逻辑
- `saleae_bridge.py` / `saleae_*.py` — Python 原生采集桥（24MHz，被 Rust rusb 替代）

## 移植优先级

1. `SaleaeProtocolProbe.ts` → pctoolbox-analyzer（USB 协议）
2. `esp*.ts` → pctoolbox-esp（esptool-rs 协议）
3. `saleae_bridge.py` → 参考协议时序，不再保留 Python
4. `docs/*` → 已吸收进 docs/REFACTOR.md 与 ADR