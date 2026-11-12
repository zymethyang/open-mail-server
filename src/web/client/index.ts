import { ApiEndpoint } from "./enums/apiEndpoint.js";
import { stopWatchingMailbox } from "./components/mailbox/liveMailbox.js";
import { bindShellActions } from "./components/navigation/index.js";
import { bindSetup } from "./components/setup/index.js";
import { bindSignIn } from "./components/signIn/index.js";
import { bindComposerSelection } from "./components/mailbox/composer.js";
import { requestJson } from "./http/jsonClient.js";
import { loadBootstrap } from "./session/loadBootstrap.js";
import { bindRouteChanges } from "./router.js";
import { applicationState } from "./state/applicationState.js";
import { escapeHtml } from "./utils/escapeHtml.js";
import { errorMessage } from "./utils/errorMessage.js";

async function signOut(): Promise<void> {
  stopWatchingMailbox();
  if (applicationState.bootstrap) {
    applicationState.bootstrap.account = null;
  }
  applicationState.clearSessionView();
  history.replaceState(null, "", "/");
  await requestJson(ApiEndpoint.Session, { method: "DELETE" });
  await loadBootstrap();
}

bindSetup();
bindSignIn();
bindShellActions(signOut);
bindComposerSelection();
bindRouteChanges();

loadBootstrap().catch((error: unknown) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="error-summary">${escapeHtml(errorMessage(error))}</p>`);
});
