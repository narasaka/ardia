import { BrowserWindow, nativeImage, type NativeImage } from "electron";

export type Png = { png: Buffer; width: number; height: number };

const IDLE_CLOSE_MS = 30_000;
const DECODE_TIMEOUT_MS = 10_000;

let decoder: BrowserWindow | null = null;
let decoderReady: Promise<BrowserWindow> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function decoderWindow(): Promise<BrowserWindow> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(closeDecoder, IDLE_CLOSE_MS);
  if (decoderReady && decoder && !decoder.isDestroyed()) return decoderReady;
  const window = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { sandbox: true, contextIsolation: true, javascript: true, images: true } });
  decoder = window;
  decoderReady = window.loadURL("about:blank").then(() => window);
  window.once("closed", () => {
    if (decoder === window) {
      decoder = null;
      decoderReady = null;
    }
  });
  return decoderReady;
}

function closeDecoder() {
  idleTimer = null;
  if (decoder && !decoder.isDestroyed()) decoder.destroy();
  decoder = null;
  decoderReady = null;
}

const RASTERIZE = `(async (uri, largest) => {
  const image = new Image();
  image.src = uri;
  await image.decode();
  const natural = Math.max(image.naturalWidth, image.naturalHeight) || largest;
  const scale = Math.min(1, largest / natural);
  const width = Math.max(1, Math.round((image.naturalWidth || largest) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || largest) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
})`;

function withTimeout<Value>(work: Promise<Value>, ms: number): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => (clearTimeout(timer), resolve(value)),
      (error: unknown) => (clearTimeout(timer), reject(error)),
    );
  });
}

async function rasterize(bytes: Buffer, mime: string, largest: number): Promise<NativeImage | null> {
  const window = await decoderWindow();
  const uri = `data:${mime || "application/octet-stream"};base64,${bytes.toString("base64")}`;
  const png = (await withTimeout(window.webContents.executeJavaScript(`${RASTERIZE}(${JSON.stringify(uri)}, ${largest})`), DECODE_TIMEOUT_MS)) as unknown;
  if (typeof png !== "string" || !png.startsWith("data:image/png")) return null;
  const image = nativeImage.createFromDataURL(png);
  return image.isEmpty() ? null : image;
}

const isPngOrJpeg = (bytes: Buffer) =>
  (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) || (bytes[0] === 0xff && bytes[1] === 0xd8);

function fitted(image: NativeImage, largest: number): Png | null {
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  if (!width || !height) return null;
  const scale = Math.min(1, largest / Math.max(width, height));
  const sized = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: "best" }) : image;
  const size = sized.getSize();
  return { png: sized.toPNG(), width: size.width, height: size.height };
}

export async function toPng(bytes: Buffer, mime: string, largest: number): Promise<Png | null> {
  if (!bytes.length) return null;
  if (isPngOrJpeg(bytes)) {
    const direct = fitted(nativeImage.createFromBuffer(bytes), largest);
    if (direct) return direct;
  }
  try {
    const drawn = await rasterize(bytes, mime, largest);
    return drawn ? fitted(drawn, largest) : null;
  } catch {
    return null;
  }
}

export function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
