import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import { element } from "../../utils/element.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { clearFormErrors, showFormError } from "../../utils/formFeedback.js";
import { loadBootstrap } from "../../session/loadBootstrap.js";

export function bindSetup(): void {
  element<HTMLFormElement>("#setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const summary = element<HTMLElement>("#setup-summary");
    clearFormErrors(form, summary);
    const domain = element<HTMLInputElement>("#setup-domain").value.trim().toLowerCase();
    const address = element<HTMLInputElement>("#setup-address").value.trim().toLowerCase();
    if (!address.endsWith(`@${domain}`)) {
      showFormError(form, summary, `The address must use @${domain}.`, "setup-address");
      return;
    }
    try {
      await requestJson(ApiEndpoint.Setup, {
        method: "POST",
        body: JSON.stringify({
          organizationName: element<HTMLInputElement>("#setup-organization").value,
          domain,
          displayName: element<HTMLInputElement>("#setup-name").value,
          address,
          password: element<HTMLInputElement>("#setup-password").value
        })
      });
      location.hash = "#overview";
      await loadBootstrap();
    } catch (error) {
      showFormError(form, summary, errorMessage(error), "setup-address");
    }
  });
}
