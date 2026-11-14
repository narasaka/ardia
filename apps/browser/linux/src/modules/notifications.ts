import { Notification, nativeImage, shell } from "electron";
import { randomUUID } from "node:crypto";
import { defineModule, emit } from "../bridge";
import { activation, note } from "../log";
import { isBackground } from "../paths";
import { focusAppWindow } from "../windowFocus";

type NotificationOptions = {
  id?: string;
  title: string;
  body?: string;
  subtitle?: string;
  silent?: boolean;
  icon?: string;
  tabId?: string;
  windowId?: string;
  origin?: string;
  dismissible?: boolean;
  data?: Record<string, unknown>;
};

const shown = new Map<string, Notification>();

function respond(id: string, action: "click" | "close", options: NotificationOptions): void {
  if (!shown.has(id)) return;
  shown.delete(id);
  emit("ArdiaNotifications", "onNotificationResponse", { id, action, tabId: options.tabId ?? null, windowId: options.windowId ?? null, data: options.data ?? null });
}

async function postNotification(options: NotificationOptions): Promise<string | null> {
  const id = options.id || randomUUID();
  if (isBackground()) {
    activation(`notification (not shown): "${options.title}"`);
    return id;
  }
  if (!Notification.isSupported()) return null;
  shown.get(id)?.close();
  const icon = options.icon?.startsWith("data:") ? nativeImage.createFromDataURL(options.icon) : undefined;
  const body = [options.subtitle, options.body].filter(Boolean).join("\n");
  const notification = new Notification({ title: options.title, body, silent: !!options.silent, icon, urgency: "normal" });
  shown.set(id, notification);
  notification.on("click", () => {
    if (options.windowId) focusAppWindow(options.windowId);
    respond(id, "click", options);
  });
  notification.on("close", () => respond(id, "close", options));
  notification.on("failed", (_event, error) => {
    note("notifications", `a notification failed: ${error}`);
    shown.delete(id);
  });
  notification.show();
  return id;
}

async function removeNotifications(ids: string[]): Promise<void> {
  for (const id of ids ?? []) {
    const notification = shown.get(id);
    shown.delete(id);
    notification?.close();
  }
}

async function openNotificationSettings(): Promise<void> {
  if (isBackground()) return;
  const desktop = (process.env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  if (desktop.includes("kde")) await shell.openExternal("systemsettings://kcm_notifications").catch(() => {});
  else {
    const { spawn } = await import("node:child_process");
    const child = spawn("gnome-control-center", ["notifications"], { detached: true, stdio: "ignore" });
    child.on("error", () => note("notifications", "no notification settings app found"));
    child.unref();
  }
}

defineModule("ArdiaNotifications", {
  sync: { notificationCenterPath: () => "" },
  async: {
    notificationPermission: async () => (Notification.isSupported() ? "granted" : "denied"),
    requestNotificationPermission: async () => Notification.isSupported(),
    postNotification,
    removeNotifications,
    openNotificationSettings,
  },
});
