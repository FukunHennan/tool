# 24MHz / 8CH 逻辑分析仪

> 状态：Web 版已启用（`src/config/features.ts` 中 `logicAnalyzer: true`）。WebUSB 直连设备现有固件，只读识别 + ≤8MHz 定长采集；24MHz 需本地原生异步桥接，且本机克隆设备实测 12–24MHz 无法维持连续流。

## 1. 设计原则

逻辑分析仪工作区通过 WebUSB 访问设备，但不会暂停设备 CPU、写入 FX2 RAM、更新 EEPROM 或替换设备固件。系统只读取描述符和协议响应，并根据设备当前已经运行的固件选择采集适配器。

当前支持：

- fx2lafw 1.x：使用 `0xB0` 只读查询版本、`0xB1` 启动采集、Bulk IN 获取样本。
- Saleae Logic 原厂旧协议：Bulk OUT EP1 发送两字节采样率命令，Bulk IN EP2 获取样本。
- Saleae Logic 原厂新协议：使用新版采样率命令表，仍通过 Bulk OUT EP1 / Bulk IN EP2 采集。
- 8 个数字通道、20kHz–24MHz、基础频率/占空比/边沿测量、VCD 导出。

如果设备只处于 FX2 bootloader 状态且没有运行采集固件，PC Toolbox 会停止并说明当前活动端点不兼容，不会主动加载固件。本机克隆设备实测：原厂固件由主机端 RAM 加载（非 EEPROM），断电/重插后会回到 bootloader 状态；运行一次 Saleae Logic 官方软件（`C:\Program Files\Logic\Logic.exe`）即可恢复原厂固件，随后 Web 版可正常采集，直至再次断电。

Saleae 原始 FX2 设备上电后可能只有 `0925:3881` bootloader，活动 Alternate 0 没有任何端点。备用 Alternate 中出现的通用 FX2 USB 端点不等于逻辑采集引擎；切换备用设置不能让硬件开始采样。诊断页会将这种状态明确显示为“启动加载器”，并列出全部 Alternate 描述符供排查。

## 2. 只读识别

“读取固件状态”只执行以下操作：

1. 打开用户选择的 WebUSB 设备并读取 USB 配置与活动端点。
2. 使用 `0xB0` 尝试只读查询 fx2lafw 版本。
3. 如果不是 fx2lafw，则检查 `0925:3881` 是否存在原厂协议所需的 Bulk OUT EP1 与 Bulk IN EP2。
4. 输出识别协议、端点和结论，然后关闭设备。

诊断流程不再读取或写入 Cypress CPUCS，也不存在 `0xA0` 固件上传路径。

原厂 Saleae 固件不实现 fx2lafw 的 `0xB0` 版本命令，因此该请求被拒绝是协议识别信号之一，而不是设备故障。只要同时存在 Bulk OUT EP1 与 Bulk IN EP2，诊断状态会显示“原厂固件就绪”，不会再把 `0xB0` 的预期拒绝显示为错误。

## 3. Saleae 原厂协议

公开的 Saleae Logic 协议资料说明：每个样本为一个字节，原厂固件通过 EP1 OUT 接收两字节采样率命令，并通过 EP2 IN 返回最多 4096 字节的样本块。第一根探针位于样本最高位，因此适配器会进行位序归一化，使界面中的 D0–D7 顺序与探针顺序一致。

旧版协议的采样率按 48MHz 时钟分频：

```text
command = [0x01, 48_000_000 / samplerate - 1]
```

新版协议使用 `0xD5` 操作码和公开的采样率查找表。低于 200kHz 时，硬件以 200kHz 采集，浏览器按整数比例抽取样本。

## 4. 防卡死处理

- 连接后页面保存实际识别的协议，不再把所有设备都当作 fx2lafw。
- 采集期间显示实时百分比。
- Saleae 原厂协议每次最多请求 4096 字节。
- 新版原厂固件在 1MHz 使用实机验证的 `512 → 2048 → 4096…` 顺序读取；旧版原厂固件使用历史驱动的 `2048 → 4096…`。
- v4 报告已否定24MHz四槽滚动补包：前四个512字节请求几乎同时完成，但浏览器回调补交的第五个请求已经错过连续数据窗口。正式采集暂时阻止24MHz命令，直到全量预队列规模经实机验证。
- 任一 Saleae USB 数据读取连续 1.5 秒没有返回时，自动关闭设备以取消挂起传输，并显示端点、队列槽位及原始偏移；fx2lafw 读取超时为5秒。
- 采集成功或失败后都会释放 USB 接口；下一次采集需要重新连接。

实机 v4 探测结果确认：新版原厂固件在1MHz下可顺序完成 `512 + 2048 + 4096 × 3`；24MHz顺序读取在累计2048字节后停止，命令前预排队的 `2 × 512` 与 `4 × 512` 均返回。后续报告证明“保持四个未决请求并在完成后补交”仍来不及，因此不能把四包成功外推为持续采集成功。v5改为在命令前一次性预提交8/16个512字节、8个2048/4096字节以及64个4096字节请求，用于确定全量预队列能否覆盖默认250k样本。

## 5. 驱动边界

Windows 必须为设备提供浏览器可用的 WinUSB 接口。Saleae Logic 桌面软件使用其原生驱动和设备层，因此“桌面软件能用”不必然意味着 WebUSB 可以访问同一个接口。PC Toolbox 不会为了绕过驱动限制而改写固件。

如果设备协议可识别但 WebUSB 仍无法稳定传输，后续应使用本机硬件桥接服务调用设备原生驱动或 libusb，再由 EdgeOne 页面连接 localhost；这属于传输层适配，而不是设备固件修改。

### 本地异步桥接

实机速率扫描（本机 Saleae Logic 8 克隆，WinUSB/libusb 原生同步读）：
- 1 / 2 / 8 MHz：可完整连续读取 `16 × 4096 = 65536` 字节，零超时。
- 12 / 16 MHz：仅返回约 2048 字节即超时中断。
- 24 MHz：大多数运行仅返回 1–2 个块（约 6KB）即中断；仅有一次运行完整返回 `64 × 4096`，但 262144 字节在 35ms 内到达（≈7.5MB/s，快于 24MHz×8ch 的理论 3MB/s 实时流），且严格复现该参数（32 块与 64 块、管理员与非管理员）均只得到 6KB——判定为一次性的设备内部缓冲倾倒，不是可复现的连续流。

结论：该克隆设备 8MHz 以下可稳定采集；12–24MHz 不可靠。协议仍是原厂 `D5 <divider>` 写 EP1、样本读 EP2；差异只在主机传输调度和设备的内部缓冲行为。

本地桥接位于 `scripts/saleae_bridge.py`，仅监听 `127.0.0.1:43127`。每次高速采集按4096字节完整块读取，请求块数向上补齐至32的整数倍，最后在内存中裁剪为用户要求的采样点数。它不执行USB控制传输，也不访问固件、RAM或EEPROM。

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r scripts\requirements-logic-bridge.txt
.\.venv\Scripts\python.exe scripts\saleae_bridge.py
```

桥接默认允许来自 `http://127.0.0.1`、`http://localhost` 和 `http://[::1]` 任意端口的本地开发页面。通过 EdgeOne HTTPS 页面使用时，必须在运行桥接的电脑上显式加入该页面的精确 Origin；Origin 只包含协议、主机和可选端口，不包含路径：

```powershell
# 环境变量支持以逗号分隔多个精确 HTTPS Origin
$env:PC_TOOLBOX_ALLOWED_ORIGINS = "https://pc-toolbox.example.com,https://pc-toolbox.edgeone.app"
.\.venv\Scripts\python.exe scripts\saleae_bridge.py

# 或使用可重复的命令行参数
.\.venv\Scripts\python.exe scripts\saleae_bridge.py `
  --allow-origin "https://pc-toolbox.example.com" `
  --allow-origin "https://pc-toolbox.edgeone.app"
```

桥接不接受通配符 Origin，也不会把 HTTPS 站点自动加入白名单；响应只回显本次请求实际匹配的 Origin。Chrome/Edge 首次从公网 HTTPS 页面访问环回地址时可能显示“本地网络访问”权限提示。桥接会对受信 Origin 的 PNA 预检返回 `Access-Control-Allow-Private-Network: true`，拒绝未配置的公网来源。

网页检测到桥接后会显示“连接本地桥接”。WebUSB仍保留用于低速采集、诊断和协议探测，24MHz 采集仅能尝试原生异步桥接，且实测本机设备无法维持连续流。

## 6. 参考资料

- [sigrok：Saleae Logic 原厂 USB 协议与端点](https://sigrok.org/wiki/Saleae_Logic/Info)
- [sigrok：fx2lafw](https://sigrok.org/wiki/Fx2lafw)
- [Saleae：设备连接与固件加载说明](https://www.saleae.com/support/troubleshooting/device-connection-issues/logic-not-detected)

## 7. 原厂协议探测文件

当原厂端点已识别但采集仍无数据时，可点击“协议探测”。该功能执行固定的安全测试矩阵，不进行随机模糊测试：

- 不发送命令时分别读取 EP1 IN 与 EP2 IN。
- 使用已公开的新版 `D5 E0`、`D5 8E` 和旧版 `01 01`、`01 2F` 采样命令。
- 测试 512、2048、4096 字节读取长度。
- 比较“先写采样命令再读”和“先排队读取再写命令”的时序。
- 在同一个 USB 会话中执行 `512 → 2048 → 4096 → 4096 → 4096`，逐包记录结果，以区别“单包协议成功”和“连续流式采集成功”。v4 还会测试24MHz下顺序 `512×5`，以及在发送采样命令之前预排队2个、4个和混合长度的读取请求。
- 读取 EP1 IN，检查新版固件是否存在额外状态回应。

每项测试使用独立的打开/声明/关闭周期。需要注意：重新打开 USB handle 不会重置固件内部运行状态，因此这只是传输资源隔离，不是严格的设备状态隔离。探测器会依据端点布局只运行匹配的新版或旧版命令，不再交叉发送两代命令，并在最后运行一项已知有效的 24MHz 恢复测试。超时会关闭设备以取消 WebUSB 挂起传输，然后重新打开设备继续下一项。

导出的 `saleae-protocol-probe-*.json` 使用 `pc-toolbox.saleae-protocol-probe` schema；v5 报告包含：

- 浏览器和 USB 描述符环境。
- 每项测试的命令、端点、长度、顺序、状态、耗时和错误。
- 多包测试中每一个 Bulk IN 请求的序号、请求长度、实际长度、耗时、状态和前 16 字节。
- 完整回应字节的 Base64、前 64 字节十六进制预览。
- 唯一字节数量和 D0–D7 相邻样本翻转次数，便于判断回应是状态帧、常量填充还是逻辑样本流。

安全边界会同时写入报告：`firmwareWrites=false`、`controlTransfers=false`，只允许 EP1 OUT 和 EP1/EP2 IN。探测器不会访问 `0xA0`、CPUCS、RAM、EEPROM 或未知的 EP6 OUT。
