# ESP32-S3 诊断固件安全规范

## 1. 状态

PC Toolbox当前不包含诊断固件二进制，也不执行临时固件烧录；日常ESP页面不显示此流程。本规范仅保留后续独立高级工具所需的固件、上位机安全门、JSON协议和恢复流程最低要求。只有全部条件落实并经过实机验证后，才可以考虑启用诊断写入阶段。

## 2. 强制流程

```text
ROM只读检测
  → 导入并核对eFuse安全状态
  → 按实际容量备份完整Flash
  → 校验芯片型号、MAC、长度、SHA-256
  → 用户确认拆桨并断开电机电源
  → 校验诊断固件目标、版本和SHA-256
  → 临时写入诊断固件
  → 只执行允许的被动检查和候选配置测试
  → 收集版本化JSON报告
  → 恢复原始完整Flash
  → 再次读取并校验恢复后的Flash哈希
```

任何一步失败都必须停止，不得跳到写入阶段。原始备份只保存在用户本地，不上传EdgeOne。

## 3. 禁止事项

- 永久禁止自动写入、修改或“修复”eFuse。
- Secure Boot或Flash Encryption为未知/已启用时禁止写入临时诊断固件。
- 未完成完整Flash备份或哈希校验时禁止写入。
- 禁止遍历所有GPIO并轮流设置为输出。
- GPIO0、GPIO3、GPIO45和GPIO46属于ESP32-S3启动配置引脚，只允许被动读取。
- GPIO19和GPIO20用于原生USB/USB-JTAG时不得测试输出。
- GPIO26至GPIO32通常由Flash/PSRAM使用；Octal Flash/PSRAM配置下GPIO33至GPIO37也属于禁止主动测试范围。
- 禁止在螺旋桨未拆除或电机电源仍连接时进行任何主动GPIO测试。

## 4. 固件构建产物

诊断固件包必须包含：

- 固定的ESP-IDF版本和完整源代码。
- 仅支持明确芯片型号的合并固件镜像。
- `manifest.json`，包含协议版本、目标芯片、允许Flash容量、写入地址、固件长度和SHA-256。
- 候选板型数据库版本与来源。
- 构建日期、Git提交和许可证。
- GPIO主动测试白名单；不存在白名单的引脚只能被动读取。

上位机必须对固件重新计算SHA-256并与manifest比较，不能只相信文件名。

## 5. JSON协议

串口输出使用逐行JSON（JSON Lines），每条消息都带协议版本和会话ID。最终报告示例：

```json
{
  "schemaVersion": 1,
  "sessionId": "random-session-id",
  "chip": "ESP32-S3",
  "flashMB": 16,
  "psramMB": 8,
  "reservedPins": [26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37],
  "usbPins": [19, 20],
  "uartPins": [43, 44],
  "cameraProfile": "candidate_1",
  "cameraSensor": "OV2640",
  "cameraWorking": true,
  "i2cDevices": [
    {"address": "0x68", "name": "MPU6050"}
  ]
}
```

未检测到的字段必须为`null`或省略，并附带原因；不能填充候选板型的默认数据冒充实测值。

## 6. GPIO检查

固件可调用`gpio_dump_io_configuration()`或`gpio_get_io_config()`读取当前输入、输出、上下拉、驱动能力、GPIO矩阵信号和保留状态。`RESERVED`引脚直接进入禁止测试集合。

GPIO配置值代表诊断固件运行时状态，可能已经被bootloader或应用启动代码修改，不能当作原厂PCB走线的直接证明。报告需要区分：

- `observed`：硬件/API实际读到。
- `inferred`：根据矩阵信号或外设响应推断。
- `candidate`：来自候选板型数据库。
- `unknown`：没有证据。

## 7. 摄像头检测

摄像头检测只允许使用版本化的候选板型数据库：

1. 排除Flash/PSRAM、启动配置、USB和其他禁止引脚。
2. 对一个候选配置初始化SCCB/I²C。
3. 读取OV2640、OV3660等已支持传感器ID。
4. 只有传感器ID成功后才初始化数据总线。
5. 尝试获取一帧并验证非空、尺寸和基础数据一致性。
6. 成功后记录候选配置、证据和置信度；失败后完整释放外设。

禁止对全部GPIO排列组合进行盲目穷举。

## 8. 恢复验证

恢复必须使用同一设备、同一完整容量的备份。写回后重新读取完整Flash并计算SHA-256；只有与原manifest一致才显示“恢复成功”。长度正确但哈希不同必须显示失败，并保留恢复日志供人工处理。

## 9. 官方依据

- [ESP32-S3 GPIO配置检查与RESERVED标识](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html)
- [ESP32-S3 eFuse JSON summary](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/espefuse/summary-cmd.html)
- [esptool脚本接口与read_flash](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/esptool/scripting.html)
- [ESP32-S3 Flash Encryption](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/security/flash-encryption.html)
