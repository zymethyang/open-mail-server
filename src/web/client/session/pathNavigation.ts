import { mapHashToPath, normalizeConsolePath } from "./consoleAccess.js";

let renderHandler: (() => Promise<void>) | null = null;

export function bindPathRenderer(handler: () => Promise<void>): void {
  renderHandler = handler;
}

export function currentPathName(): string {
  return normalizeConsolePath(location.pathname || "/");
}

export function navigateTo(pathName: string, replace = false): void {
  const target = normalizeConsolePath(pathName);
  if (currentPathName() === target && !location.hash) {
    void renderHandler?.();
    return;
  }
  if (replace) {
    history.replaceState(null, "", target);
  } else {
    history.pushState(null, "", target);
  }
  void renderHandler?.();
}

export function syncLegacyHashRoute(): boolean {
  if (!location.hash) {
    return false;
  }
  const mapped = mapHashToPath(location.hash);
  if (!mapped) {
    history.replaceState(null, "", location.pathname || "/");
    return false;
  }
  history.replaceState(null, "", mapped);
  return true;
}
