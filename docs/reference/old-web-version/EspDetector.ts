import { ESPLoader, Transport, type IEspLoaderTerminal } from "esptool-js";
import { serialService } from "../serial/SerialService";
import { analyzeChip, analyzeCommunication, type EspCommunicationInfo, type EspParsedInfo } from "./espAnalysis";

export interface EspChipInfo {
  chipName: string;
  description: string;
  revision?: number;
  features: string[];
  crystalMhz?: number;
  macAddress?: string;
  flashId?: string;
  flashManufacturerId?: string;
  flashDeviceId?: string;
  flashSize?: string;
  portInfo?: string;
  baudRate: number;
  communication: EspCommunicationInfo;
  analysis: EspParsedInfo;
  detectionWarnings: string[];
  detectedAt: string;
}

type LogListener = (message: string, level?: "info" | "error") => void;

class EspDetector {
  private detecting = false;
  private latestInfo: EspChipInfo | null = null;

  get lastResult(): EspChipInfo | null {
    return this.latestInfo;
  }

  get busy(): boolean {
    return this.detecting;
  }

  async detect(baudRate = 115200, onLog: LogListener = () => undefined): Promise<EspChipInfo> {
    if (this.detecting) throw new Error("ESP 检测正在进行中");
    if (serialService.connected) throw new Error("请先断开串口终端中的连接，再检测 ESP 芯片");
    if (!window.isSecureContext || !navigator.serial) throw new Error("当前浏览器环境不支持 Web Serial");

    this.detecting = true;
    let transport: Transport | undefined;
    let loader: ESPLoader | undefined;

    try {
      onLog("请选择 ESP 开发板对应的串口");
      const port = await navigator.serial.requestPort();
      const usbInfo = port.getInfo?.() ?? {};
      transport = new Transport(port as never, false);
      const terminal: IEspLoaderTerminal = {
        clean: () => undefined,
        write: (data) => onLog(data),
        writeLine: (data) => onLog(data),
      };

      loader = new ESPLoader({ transport, baudrate: baudRate, terminal, debugLogging: false });
      const activeLoader = loader;
      onLog("正在复位设备并同步 ROM Bootloader…");
      const description = await activeLoader.main("default_reset");
      const chip = activeLoader.chip;
      onLog(`已识别 ${description}`);

      const detectionWarnings: string[] = [];
      const readOptional = async <T,>(label: string, read: () => Promise<T>): Promise<T | undefined> => {
        try {
          return await read();
        } catch (error) {
          const detail = error instanceof Error ? error.message : "设备未返回该字段";
          detectionWarnings.push(`${label}：${detail}`);
          onLog(`${label}未读取：${detail}`, "error");
          return undefined;
        }
      };

      // ESPLoader commands share one Web Serial reader/writer pair. They must be
      // executed sequentially; concurrent calls race for WritableStream.getWriter().
      const features = await readOptional("芯片特性", () => chip.getChipFeatures(activeLoader)) ?? [];
      const crystalMhz = await readOptional("晶振频率", () => chip.getCrystalFreq(activeLoader));
      const macAddress = await readOptional("MAC 地址", () => chip.readMac(activeLoader));
      const flashIdValue = await readOptional("Flash ID", () => activeLoader.readFlashId());
      const flashSize = await readOptional("Flash 容量", () => activeLoader.detectFlashSize());
      const revision = chip.getChipRevision ? await readOptional("芯片 Revision", () => chip.getChipRevision!(activeLoader)) : undefined;

      const flashId = flashIdValue === undefined ? undefined : flashIdValue.toString(16).padStart(6, "0").toUpperCase();
      const manufacturer = flashIdValue === undefined ? undefined : flashIdValue & 0xff;
      const device = flashIdValue === undefined ? undefined : (flashIdValue >> 8) & 0xffff;
      const communication = analyzeCommunication(usbInfo.usbVendorId, usbInfo.usbProductId, baudRate);
      const analysis = analyzeChip(chip.CHIP_NAME, description, features, flashSize, manufacturer, macAddress);
      const info: EspChipInfo = {
        chipName: chip.CHIP_NAME,
        description,
        revision,
        features,
        crystalMhz,
        macAddress: macAddress?.toUpperCase(),
        flashId: flashId ? `0x${flashId}` : undefined,
        flashManufacturerId: manufacturer === undefined ? undefined : `0x${manufacturer.toString(16).padStart(2, "0").toUpperCase()}`,
        flashDeviceId: device === undefined ? undefined : `0x${device.toString(16).padStart(4, "0").toUpperCase()}`,
        flashSize,
        portInfo: transport.getInfo(),
        baudRate,
        communication,
        analysis,
        detectionWarnings,
        detectedAt: new Date().toISOString(),
      };
      this.latestInfo = info;
      onLog("芯片信息读取完成");
      return info;
    } catch (error) {
      const message = error instanceof Error ? error.message : "ESP 芯片检测失败";
      onLog(message, "error");
      throw error;
    } finally {
      if (loader) {
        try {
          await loader.after("hard_reset");
          onLog("设备已复位到正常运行模式");
        } catch {
          onLog("自动复位未完成，可按开发板 RESET 键", "error");
        }
      }
      if (transport) {
        try {
          await transport.disconnect();
        } catch {
          // The device may have disappeared during reset; the browser releases it.
        }
      }
      this.detecting = false;
    }
  }
}

export const espDetector = new EspDetector();
