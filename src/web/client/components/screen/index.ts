import { element } from "../../utils/element.js";

export type ScreenName = "setup" | "sign-in" | "application";

export function showScreen(name: ScreenName): void {
  element<HTMLElement>("#setup-screen").hidden = name !== "setup";
  element<HTMLElement>("#sign-in-screen").hidden = name !== "sign-in";
  element<HTMLElement>("#application-shell").hidden = name !== "application";
}
