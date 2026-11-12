import { ApiEndpoint } from "../../enums/apiEndpoint.js";
import { requestJson } from "../../http/jsonClient.js";
import { element } from "../../utils/element.js";
import { errorMessage } from "../../utils/errorMessage.js";
import { clearFormErrors, showFormError } from "../../utils/formFeedback.js";
import { loadBootstrap } from "../../session/loadBootstrap.js";
import type { SessionResponse } from "../../interfaces/sessionResponse.js";

export function resetSignInStep(): void {
  const codeStep = element<HTMLElement>("#sign-in-code-step");
  const passwordStep = element<HTMLElement>("#sign-in-password-step");
  codeStep.classList.remove("gate-step-enter");
  codeStep.hidden = true;
  passwordStep.hidden = false;
  passwordStep.classList.add("gate-step-enter");
  element<HTMLElement>("#sign-in-back").hidden = true;
  const code = element<HTMLInputElement>("#sign-in-code");
  code.required = false;
  code.value = "";
  element<HTMLInputElement>("#sign-in-address").required = true;
  element<HTMLInputElement>("#sign-in-password").required = true;
}

export function bindSignIn(): void {
  element<HTMLFormElement>("#sign-in-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const summary = element<HTMLElement>("#sign-in-summary");
    clearFormErrors(form, summary);
    const codeStep = element<HTMLElement>("#sign-in-code-step");
    try {
      if (!codeStep.hidden) {
        await requestJson(ApiEndpoint.SessionOneTimePassword, {
          method: "POST",
          body: JSON.stringify({ code: element<HTMLInputElement>("#sign-in-code").value })
        });
        resetSignInStep();
        await loadBootstrap();
        return;
      }
      const payload = await requestJson<SessionResponse>(ApiEndpoint.Session, {
        method: "POST",
        body: JSON.stringify({
          address: element<HTMLInputElement>("#sign-in-address").value,
          password: element<HTMLInputElement>("#sign-in-password").value
        })
      });
      if (payload.oneTimePasswordRequired) {
        const passwordStep = element<HTMLElement>("#sign-in-password-step");
        passwordStep.classList.remove("gate-step-enter");
        passwordStep.hidden = true;
        codeStep.hidden = false;
        codeStep.classList.add("gate-step-enter");
        element<HTMLElement>("#sign-in-back").hidden = false;
        element<HTMLInputElement>("#sign-in-code").required = true;
        element<HTMLInputElement>("#sign-in-address").required = false;
        element<HTMLInputElement>("#sign-in-password").required = false;
        element<HTMLInputElement>("#sign-in-code").focus();
        return;
      }
      await loadBootstrap();
    } catch (error) {
      const field = codeStep.hidden ? "sign-in-address" : "sign-in-code";
      showFormError(form, summary, errorMessage(error), field);
    }
  });
  element("#sign-in-back").addEventListener("click", () => {
    resetSignInStep();
    element<HTMLInputElement>("#sign-in-password").focus();
  });
}
