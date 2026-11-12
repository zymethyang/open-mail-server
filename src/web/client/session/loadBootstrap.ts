import { ApiEndpoint } from "../enums/apiEndpoint.js";
import { watchSignedInMailbox } from "../components/mailbox/liveMailbox.js";
import { requestJson } from "../http/jsonClient.js";
import { homePath } from "./consoleAccess.js";
import type { Bootstrap } from "../interfaces/models.js";
import { renderRoute } from "../router.js";
import { currentPathName, navigateTo, syncLegacyHashRoute } from "./pathNavigation.js";
import { showScreen } from "../components/screen/index.js";
import { resetSignInStep } from "../components/signIn/index.js";
import { applicationState } from "../state/applicationState.js";
import { element } from "../utils/element.js";

export async function loadBootstrap(): Promise<void> {
  const previousAddress = applicationState.bootstrap?.account?.address || "";
  applicationState.bootstrap = await requestJson<Bootstrap>(ApiEndpoint.Bootstrap);
  const nextAddress = applicationState.bootstrap.account?.address || "";
  if (previousAddress !== nextAddress) {
    applicationState.clearSessionView();
  }
  watchSignedInMailbox();
  if (applicationState.bootstrap.needsSetup) {
    showScreen("setup");
    if (applicationState.bootstrap.configuredDomain) {
      const domain = element<HTMLInputElement>("#setup-domain");
      domain.value = applicationState.bootstrap.configuredDomain;
      domain.readOnly = true;
    }
    return;
  }
  if (!applicationState.bootstrap.account) {
    showScreen("sign-in");
    element("#sign-in-title").textContent = applicationState.bootstrap.organization?.displayName || "Sign in";
    element("#sign-in-detail").textContent = `Sign in with your ${applicationState.bootstrap.organization?.domain || "company"} mailbox.`;
    resetSignInStep();
    return;
  }
  showScreen("application");
  syncLegacyHashRoute();
  const pathName = currentPathName();
  if (pathName === "/" || pathName === "") {
    navigateTo(homePath(applicationState.bootstrap.account.role), true);
    return;
  }
  await renderRoute();
}
