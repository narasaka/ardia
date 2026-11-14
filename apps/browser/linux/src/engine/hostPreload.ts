import { contextBridge } from "electron";

function keepPagesAliveWhenMoved() {
  const registry = CustomElementRegistry.prototype;
  const define = registry.define;
  registry.define = function (name: string, constructor: CustomElementConstructor, options?: ElementDefinitionOptions) {
    if (name === "webview" && !("connectedMoveCallback" in constructor.prototype)) Object.defineProperty(constructor.prototype, "connectedMoveCallback", { value() {}, configurable: true });
    return define.call(this, name, constructor, options);
  };
}

contextBridge.executeInMainWorld({ func: keepPagesAliveWhenMoved });
