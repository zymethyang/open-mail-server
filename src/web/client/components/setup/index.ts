import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import { element } from "../../utils/element.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { clearFormErrors, showFormError } from "../../utils/formFeedback.js";
import { navigateTo } from "../../session/pathNavigation.js";
import { loadBootstrap } from "../../session/loadBootstrap.js";

function setupErrorField(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("public ip")) {
    return "setup-public-address";
  }
  if (text.includes("password")) {
    return "setup-password";
  }
  if (text.includes("organization")) {
    return "setup-organization";
  }
  if (text.includes("email") || text.includes("address must")) {
    return "setup-address";
  }
  if (text.includes("domain")) {
    return "setup-domain";
  }
  if (text.includes("name")) {
    return "setup-name";
  }
  return "setup-address";
}

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
    const publicAddress = element<HTMLInputElement>("#setup-public-address").value.trim();
    if (!address.endsWith(`@${domain}`)) {
      showFormError(form, summary, `The address must use @${domain}.`, "setup-address");
      return;
    }
    if (!publicAddress) {
      showFormError(form, summary, "Enter the public IP address of this server.", "setup-public-address");
      return;
    }
    try {
      await requestJson(ApiEndpoint.Setup, {
        method: "POST",
        body: JSON.stringify({
          organizationName: element<HTMLInputElement>("#setup-organization").value,
          domain,
          publicAddress,
          displayName: element<HTMLInputElement>("#setup-name").value,
          address,
          password: element<HTMLInputElement>("#setup-password").value
        })
      });
      navigateTo("/admin/overview", true);
      await loadBootstrap();
    } catch (error) {
      const message = errorMessage(error);
      showFormError(form, summary, message, setupErrorField(message));
    }
  });
}
