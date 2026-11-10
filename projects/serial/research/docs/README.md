# 技术文档总览

本目录记录 PC Toolbox 的架构、实现约束、测试方法和部署流程。代码实现发生变化时，相应文档必须在同一个 Pull Request 中更新。

## 阅读顺序

1. [系统架构](architecture.md)：了解系统边界、模块划分和数据流。
2. [Web Serial 核心设计](web-serial-design.md)：了解串口状态机、读写流程与错误处理。
3. [ESP 芯片检测](esp-inspector.md)：了解检测流程、可读信息和连接排错。
4. [ESP诊断固件安全规范](esp-diagnostic-firmware.md)：了解完整Flash备份、安全门、GPIO限制和恢复校验。
5. [24MHz / 8CH 逻辑分析仪](logic-analyzer.md)：了解 WebUSB、fx2lafw、采集流程和硬件限制。
6. [工具平台与工作流架构](workflow-architecture.md)：了解工具注册、节点编排与运行时。
7. [协议扩展指南](protocol-guide.md)：了解如何添加 Modbus RTU 或自定义二进制协议。
8. [本地开发指南](development.md)：了解环境、命令和开发约定。
9. [测试策略](testing.md)：了解单元、集成和真机测试范围。
10. [EdgeOne 部署指南](deployment-edgeone.md)：了解构建、发布和回滚。

## 文档维护规则

- `README.md` 面向项目使用者，`docs/` 面向开发和维护人员。
- 架构上的重要取舍记录在 `docs/adr/`，已有 ADR 不直接改写结论；新决策通过新 ADR 覆盖。
- 公开接口、串口状态、数据帧定义或部署参数改变时必须更新文档。
- 示例中的密钥和设备标识必须使用虚构值。
- 未确认的设计用“待定”标记，不把假设写成既定事实。

## 当前待确认事项

- 下位机实际使用的波特率和其他串口参数。
- 数据是文本、Modbus RTU 还是自定义二进制协议。
- 单帧最大长度、校验算法、超时和重试规则。
- 是否需要实时曲线、设备参数表和固件升级。
- 是否需要账号、云端历史数据或远程控制。
