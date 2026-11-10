import type { Cell, Row, Worksheet } from "exceljs";
import type { EspChipInfo } from "./EspDetector";
import type { EspSecuritySummary } from "./espSecurity";
import { recommendPlatformIo } from "./platformioRecommendation";

type ReportRow = [string, string, string | number | Date | undefined, string];

const colors = {
  navy: "0B1726",
  teal: "16B8A6",
  tealDark: "0F766E",
  blue: "2563EB",
  text: "1F2937",
  muted: "64748B",
  pale: "E8F7F4",
  light: "F4F7FA",
  white: "FFFFFF",
  border: "D7E0E8",
};

function styleTitle(cell: Cell): void {
  cell.font = { name: "Microsoft YaHei", size: 18, bold: true, color: { argb: colors.white } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.navy } };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

function styleHeader(row: Row): void {
  row.height = 25;
  row.eachCell((cell) => {
    cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: colors.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.tealDark } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = { bottom: { style: "thin", color: { argb: colors.teal } } };
  });
}

function addReportSheet(
  workbook: import("exceljs").Workbook,
  name: string,
  title: string,
  subtitle: string,
  rows: ReportRow[],
): Worksheet {
  const sheet = workbook.addWorksheet(name, { properties: { tabColor: { argb: colors.teal } } });
  sheet.views = [{ state: "frozen", ySplit: 4, showGridLines: false }];
  sheet.columns = [
    { key: "category", width: 18 },
    { key: "item", width: 24 },
    { key: "value", width: 38 },
    { key: "analysis", width: 64 },
  ];
  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = title;
  styleTitle(sheet.getCell("A1"));
  sheet.getRow(1).height = 35;
  sheet.mergeCells("A2:D2");
  sheet.getCell("A2").value = subtitle;
  sheet.getCell("A2").font = { name: "Microsoft YaHei", size: 9, color: { argb: colors.muted } };
  sheet.getCell("A2").alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(2).height = 28;
  sheet.addRow([]);
  const header = sheet.addRow(["分类", "项目", "检测值", "解析与说明"]);
  styleHeader(header);

  const presentRows = rows.filter((values) => values[2] !== undefined && values[2] !== "");
  presentRows.forEach((values, index) => {
    const row = sheet.addRow(values);
    row.height = 30;
    row.eachCell((cell, column) => {
      cell.font = { name: "Microsoft YaHei", size: 9, color: { argb: colors.text } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      if (index % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: colors.light } };
      cell.border = { bottom: { style: "hair", color: { argb: colors.border } } };
      if (column === 1) cell.font = { ...cell.font, bold: true, color: { argb: colors.tealDark } };
      if (column === 3 && typeof cell.value === "number") cell.numFmt = "#,##0";
      if (column === 3 && typeof cell.value === "string" && /^0x/i.test(cell.value)) {
        const identifier = cell.value;
        cell.value = { richText: [{ text: identifier }] };
        cell.numFmt = "@";
      }
      if (cell.value instanceof Date) cell.numFmt = "yyyy-mm-dd hh:mm:ss";
    });
  });
  sheet.autoFilter = { from: "A4", to: `D${Math.max(4, presentRows.length + 4)}` };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  return sheet;
}

function overviewRows(info: EspChipInfo): ReportRow[] {
  return [
    ["设备", "芯片型号", info.chipName, info.description],
    ["设备", "芯片系列", info.analysis.family, "由芯片名称归类"],
    ["设备", "处理器架构", info.analysis.architecture, "按 Espressif 芯片系列解析"],
    ["设备", "芯片封装", info.analysis.packageName, "从芯片详细描述中提取"],
    ["设备", "Revision", info.revision ?? "未提供", "来自 ROM/eFuse 只读信息"],
    ["设备", "MAC 地址", info.macAddress, info.analysis.macOui ? `OUI 前缀 ${info.analysis.macOui}；分享报告时注意设备隐私` : "分享报告时注意设备隐私"],
    ["存储", "Flash 容量", info.flashSize, info.analysis.flashSizeBytes ? `${info.analysis.flashSizeBytes.toLocaleString("en-US")} Bytes` : "无法换算字节数"],
    ["存储", "Flash 厂商", info.analysis.flashManufacturer, info.flashManufacturerId ? `JEDEC 厂商代码 ${info.flashManufacturerId}` : "由 JEDEC 厂商代码解析"],
    ["通讯", "物理通讯方式", info.communication.physicalLink, [info.communication.bridgeVendor, info.communication.bridgeModel].filter(Boolean).join(" ")],
    ["通讯", "USB 标识", info.communication.usbVendorIdHex && info.communication.usbProductIdHex ? `${info.communication.usbVendorIdHex}:${info.communication.usbProductIdHex}` : undefined, info.communication.bridgeConfidence ? `识别可信度：${info.communication.bridgeConfidence}` : "浏览器提供的设备标识"],
    ["通讯", "连接速率", info.baudRate, `${info.communication.serialFormat}；单位 Baud`],
    ["报告", "检测时间", new Date(info.detectedAt), "浏览器本地时间由 Excel 显示"],
    ["总结", "硬件概述", info.analysis.summary, "自动解析结果，仅用于辅助识别"],
  ];
}

function communicationRows(info: EspChipInfo): ReportRow[] {
  const communication = info.communication;
  return [
    ["浏览器", "访问接口", communication.browserApi, "串口由浏览器直接访问，数据不经过 EdgeOne 服务器"],
    ["物理层", "连接方式", communication.physicalLink, "由 USB VID/PID 和设备类型推断"],
    ["桥接设备", "厂商", communication.bridgeVendor, `识别可信度：${communication.bridgeConfidence}`],
    ["桥接设备", "型号", communication.bridgeModel, "同一 VID/PID 可能覆盖同系列多个具体型号"],
    ["USB", "Vendor ID", communication.usbVendorIdHex, communication.usbVendorId === undefined ? "浏览器未提供" : `十进制 ${communication.usbVendorId}`],
    ["USB", "Product ID", communication.usbProductIdHex, communication.usbProductId === undefined ? "浏览器未提供" : `十进制 ${communication.usbProductId}`],
    ["串口", "波特率", communication.baudRate, "检测阶段连接速度"],
    ["串口", "数据格式", communication.serialFormat, "esptool-js 默认串口帧格式"],
    ["协议", "传输协议", communication.transportProtocol, "ESP ROM Bootloader 命令使用 SLIP 进行帧封装"],
    ["复位", "进入下载模式", communication.resetStrategy, "通过 USB-UART DTR/RTS 控制 BOOT/EN；部分开发板需手动按键"],
    ["加载器", "检测路径", communication.loaderPath, "Stub Loader 在 RAM 中临时运行，不写入 Flash"],
    ["原始信息", "esptool 端口描述", info.portInfo || "无", "由 esptool-js Transport.getInfo() 返回"],
  ];
}

function featureRows(info: EspChipInfo): ReportRow[] {
  const rows: ReportRow[] = [];
  info.analysis.radioCapabilities.forEach((feature) => rows.push(["无线能力", feature, "支持", "来自芯片 eFuse/ROM 特性识别"]));
  info.analysis.memoryCapabilities.forEach((feature) => rows.push(["存储能力", feature, "支持", "容量和电压后缀以 esptool-js 输出为准"]));
  info.analysis.otherCapabilities.forEach((feature) => rows.push(["其他能力", feature, "支持", "未归入无线或存储分类的原始特性"]));
  rows.push(["Flash", "厂商", info.analysis.flashManufacturer, info.flashId ? `JEDEC ID ${info.flashId}` : "由 JEDEC ID 解析"]);
  rows.push(["Flash", "地址范围", info.analysis.flashAddressRange, "按检测容量从地址 0 推算，不代表实际分区布局"]);
  rows.push(["标识", "MAC OUI", info.analysis.macOui, "仅提取前三个字节，未进行联网厂商查询"]);
  info.analysis.notes.forEach((note, index) => rows.push(["报告说明", `注意事项 ${index + 1}`, note, "自动生成"]));
  return rows;
}

function rawRows(info: EspChipInfo): ReportRow[] {
  return [
    ["芯片", "CHIP_NAME", info.chipName, "esptool-js ROM target"],
    ["芯片", "description", info.description, "getChipDescription()"],
    ["芯片", "revision", info.revision ?? "undefined", "getChipRevision()"],
    ["芯片", "features", info.features.join(" | "), "getChipFeatures()"],
    ["芯片", "crystalMhz", info.crystalMhz, "getCrystalFreq()"],
    ["芯片", "macAddress", info.macAddress, "readMac()"],
    ["Flash", "flashId", info.flashId, "readFlashId()"],
    ["Flash", "manufacturerId", info.flashManufacturerId, "Flash ID low byte"],
    ["Flash", "deviceId", info.flashDeviceId, "Flash ID device bytes"],
    ["Flash", "size", info.flashSize, "detectFlashSize()"],
    ["通讯", "portInfo", info.portInfo, "Transport.getInfo()"],
    ["通讯", "baudRate", info.baudRate, "ESPLoader baudrate"],
    ["报告", "detectedAt", new Date(info.detectedAt), "ISO timestamp"],
  ];
}

export async function createEspWorkbookBytes(info: EspChipInfo, security?: EspSecuritySummary): Promise<Uint8Array> {
  const excelModule = await import("exceljs");
  const ExcelJs = excelModule.default ?? excelModule;
  const workbook = new ExcelJs.Workbook();
  workbook.creator = "PC Toolbox";
  workbook.title = `${info.chipName} 芯片检测报告`;
  workbook.subject = "Espressif 芯片只读检测与解析";
  workbook.description = "由 PC Toolbox 通过 Web Serial 和 esptool-js 生成";
  workbook.created = new Date();
  workbook.modified = new Date();

  addReportSheet(workbook, "检测概览", `${info.chipName} 芯片检测报告`, "核心硬件信息、通讯方式与自动解析摘要", overviewRows(info));
  addReportSheet(workbook, "通讯链路", "串口通讯链路", "从浏览器 API 到 ESP ROM Bootloader 的完整通讯路径", communicationRows(info));
  addReportSheet(workbook, "特性解析", "芯片能力与信息解析", "分类展示无线、存储、Flash 与设备标识信息", featureRows(info));
  addReportSheet(workbook, "eFuse安全状态", "eFuse 安全状态", "仅接收 espefuse summary --format json 中的安全字段；不导出密钥块内容", security ? [
    ["安全", "Secure Boot", security.secureBootEnabled === undefined ? "未知" : security.secureBootEnabled ? "已启用" : "未启用", "SECURE_BOOT_EN"],
    ["安全", "Flash Encryption", security.flashEncryptionEnabled === undefined ? "未知" : security.flashEncryptionEnabled ? "已启用" : "未启用", "由 SPI_BOOT_CRYPT_CNT 中已置位 bit 数的奇偶性判断"],
    ["安全", "SPI_BOOT_CRYPT_CNT", security.spiBootCryptCount, "原始 eFuse 计数值"],
    ["安全", "禁用下载模式手动加密", security.downloadManualEncryptionDisabled === undefined ? "未知" : security.downloadManualEncryptionDisabled ? "是" : "否", "DIS_DOWNLOAD_MANUAL_ENCRYPT"],
    ["设备", "eFuse JSON MAC", security.macAddress, info.macAddress && security.macAddress ? (info.macAddress.toUpperCase() === security.macAddress ? "与 ROM 检测 MAC 一致" : "警告：与 ROM 检测 MAC 不一致") : "JSON 未提供可解析 MAC"],
    ["来源", "导入时间", new Date(security.importedAt), "用户导入的官方 espefuse JSON"],
    ...security.fields.map((field): ReportRow => ["安全字段", field.name, field.value === undefined ? field.rawValue : String(field.value), `raw=${field.rawValue ?? "无"}；readable=${field.readable ?? "未知"}；writeable=${field.writeable ?? "未知"}`]),
    ...security.warnings.map((warning, index): ReportRow => ["警告", `解析警告 ${index + 1}`, warning, "未使用默认值替代"]),
  ] : [
    ["状态", "eFuse JSON", "未导入", "浏览器版 esptool-js 不等同于完整 espefuse；Secure Boot 与 Flash Encryption 保持未知"],
    ["命令", "生成 JSON", "espefuse --port PORT --chip esp32s3 summary --format json --file efuses.json", "请在 Espressif 官方环境中执行后导入"],
  ]);
  const platformIo = recommendPlatformIo(info);
  addReportSheet(workbook, "PlatformIO推荐", "PlatformIO 配置推荐", "根据芯片系列和实测存储生成候选模板；开发板引脚仍需人工核对", platformIo ? [
    ["推荐", "置信度", platformIo.confidence, "置信度仅表示芯片与存储配置匹配程度"],
    ["配置", "platform", platformIo.platform, "PlatformIO开发平台"],
    ["配置", "board", platformIo.board, platformIo.boardName],
    ["配置", "framework", platformIo.framework, "默认开发框架"],
    ["配置", "platformio.ini", platformIo.ini, "可复制到项目根目录"],
    ["依据", "检测匹配", platformIo.reasons.join("；"), "来自本次只读检测"],
    ["限制", "板型确认", platformIo.warnings.join("；"), "ROM无法识别PCB品牌和引脚布局"],
    ["来源", "PlatformIO板卡定义", platformIo.sourceUrl, "官方文档"],
  ] : [["推荐", "状态", "未生成", "该芯片系列没有已验证的PlatformIO board规则"]]);
  addReportSheet(workbook, "原始数据", "检测原始数据", "保留检测 API 的原始返回值，方便审计和后续程序处理", rawRows(info));
  addReportSheet(workbook, "说明与来源", "报告说明与技术来源", "解析结论用于辅助识别，不替代芯片数据手册和开发板原理图", [
    ["安全", "检测模式", "只读", "不擦除 Flash、不烧录固件、不写入 eFuse"],
    ["来源", "esptool-js", "https://github.com/espressif/esptool-js", "Espressif 官方 JavaScript 串口工具"],
    ["来源", "esptool 文档", "https://docs.espressif.com/projects/esptool/en/latest/", "芯片检测、Bootloader 和串行协议说明"],
    ["限制", "桥接芯片识别", "基于 USB VID/PID", "可能只能识别到芯片系列，不能确定开发板品牌"],
    ["隐私", "MAC 地址", info.macAddress, "对外分享报告前可按需要脱敏"],
  ]);

  const data = await workbook.xlsx.writeBuffer();
  return new Uint8Array(data);
}

export async function exportEspWorkbook(info: EspChipInfo, security?: EspSecuritySummary): Promise<void> {
  const bytes = await createEspWorkbookBytes(info, security);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  const timestamp = new Date(info.detectedAt).toISOString().replace(/[:.]/g, "-");
  anchor.href = url;
  anchor.download = `${info.chipName.replace(/[^a-z0-9_-]/gi, "-")}-chip-report-${timestamp}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
