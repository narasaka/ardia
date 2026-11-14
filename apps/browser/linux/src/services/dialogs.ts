import { BrowserWindow, dialog } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";
import { isBackground } from "../paths";

export async function askSavePath(defaultName: string, filters: Electron.FileFilter[], message?: string): Promise<string | null> {
  const owner = BrowserWindow.getFocusedWindow();
  const options: Electron.SaveDialogOptions = { defaultPath: join(homedir(), defaultName), filters, ...(message ? { message } : {}) };
  if (isBackground()) {
    console.info(`[ardia dialogs] save panel for ${defaultName}`);
    return null;
  }
  const { canceled, filePath } = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
  return canceled || !filePath ? null : filePath;
}
