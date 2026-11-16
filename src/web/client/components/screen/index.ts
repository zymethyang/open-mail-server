import { element } from "../../utils/element.js";

type ScreenName = "setup" | "sign-in" | "application";

const gateEntranceLastStaggerDelayMilliseconds = 240;
const gateEntranceDurationFallbackMilliseconds = 420;

let gateEntranceTimeoutIdentifier: number | undefined;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clearGateEntranceTimer(): void {
  if (gateEntranceTimeoutIdentifier !== undefined) {
    window.clearTimeout(gateEntranceTimeoutIdentifier);
    gateEntranceTimeoutIdentifier = undefined;
  }
}

function finishGateEntrance(screen: HTMLElement): void {
  clearGateEntranceTimer();
  screen.classList.remove("gate-entering");
}

function startGateEntrance(screen: HTMLElement): void {
  clearGateEntranceTimer();
  screen.classList.remove("gate-entering");
  if (prefersReducedMotion()) {
    return;
  }
  void screen.offsetWidth;
  screen.classList.add("gate-entering");
  const enterDurationRaw = getComputedStyle(screen).getPropertyValue("--gate-motion-enter").trim();
  const enterDurationMilliseconds = Number.parseFloat(enterDurationRaw);
  const durationMilliseconds = Number.isFinite(enterDurationMilliseconds)
    ? enterDurationMilliseconds
    : gateEntranceDurationFallbackMilliseconds;
  gateEntranceTimeoutIdentifier = window.setTimeout(() => {
    finishGateEntrance(screen);
  }, durationMilliseconds + gateEntranceLastStaggerDelayMilliseconds);
}

export function showScreen(name: ScreenName): void {
  const setupScreen = element<HTMLElement>("#setup-screen");
  const signInScreen = element<HTMLElement>("#sign-in-screen");
  const applicationShell = element<HTMLElement>("#application-shell");

  clearGateEntranceTimer();
  setupScreen.classList.remove("gate-entering");
  signInScreen.classList.remove("gate-entering");

  setupScreen.hidden = name !== "setup";
  signInScreen.hidden = name !== "sign-in";
  applicationShell.hidden = name !== "application";

  if (name === "setup") {
    startGateEntrance(setupScreen);
    return;
  }
  if (name === "sign-in") {
    startGateEntrance(signInScreen);
  }
}
