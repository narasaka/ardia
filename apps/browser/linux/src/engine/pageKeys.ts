import { resolvePageWindowsWith } from "../menus/keyboard";
import { guestOf } from "./guests";
import { appWindow } from "../windows";

resolvePageWindowsWith((contents) => {
  const guest = guestOf(contents);
  return guest?.windowId ? appWindow(guest.windowId) : null;
});
