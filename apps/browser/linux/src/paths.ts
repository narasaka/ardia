import { homedir } from "node:os";
import { join } from "node:path";

const xdg = (variable: string, fallback: string) => process.env[variable] || join(homedir(), fallback);

export const dataDirectory = (): string => process.env.ARDIA_DATA_DIR || join(xdg("XDG_DATA_HOME", ".local/share"), "ardia");
export const configDirectory = (): string => (process.env.ARDIA_DATA_DIR ? join(process.env.ARDIA_DATA_DIR, "config") : join(xdg("XDG_CONFIG_HOME", ".config"), "ardia"));
export const isBackground = (): boolean => process.env.ARDIA_BACKGROUND === "1";
