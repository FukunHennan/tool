import { measureLogicChannels, type LogicCapture } from "./Fx2LogicAnalyzer";

const bridgeUrl = "http://127.0.0.1:43127";

export interface NativeBridgeHealth {
  name: string;
  protocol: string;
  transport: string;
  queueDepth: number;
  chunkSize: number;
  sampleRates: number[];
  firmwareWrites: false;
}

const reverseBits = Uint8Array.from({ length: 256 }, (_, value) => {
  let input = value;
  let output = 0;
  for (let bit = 0; bit < 8; bit += 1) { output = output << 1 | input & 1; input >>= 1; }
  return output;
});

export async function getNativeBridgeHealth(): Promise<NativeBridgeHealth | undefined> {
  try {
    const response = await fetch(`${bridgeUrl}/health`, { cache: "no-store" });
    if (!response.ok) return undefined;
    return await response.json() as NativeBridgeHealth;
  } catch {
    return undefined;
  }
}

export async function captureWithNativeBridge(
  sampleRate: number,
  sampleCount: number,
  onProgress: (message: string) => void,
): Promise<LogicCapture> {
  onProgress("本地桥接正在预提交 32 槽 WinUSB 异步队列…");
  const response = await fetch(`${bridgeUrl}/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sampleRate, sampleCount }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error ?? `本地桥接采集失败：HTTP ${response.status}`);
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw.length !== sampleCount) throw new Error(`本地桥接样本数量异常：预期 ${sampleCount}，实际 ${raw.length}`);
  const samples = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) samples[index] = reverseBits[raw[index]];
  const captureMs = response.headers.get("X-PC-Toolbox-Capture-Ms");
  onProgress(`本地桥接采集完成${captureMs ? ` · USB ${captureMs} ms` : ""}`);
  return {
    samples,
    sampleRate,
    capturedAt: new Date().toISOString(),
    durationSeconds: samples.length / sampleRate,
    measurements: measureLogicChannels(samples, sampleRate),
  };
}
