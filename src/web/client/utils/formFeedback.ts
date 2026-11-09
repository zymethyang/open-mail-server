import { element } from "./element.js";
import { escapeHtml } from "./escapeHtml.js";

export function showFormError(form: ParentNode, summary: HTMLElement, message: string, fieldId: string): void {
  summary.hidden = false;
  summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(message)}</p>`;
  const field = fieldId ? form.querySelector<HTMLElement>(`#${fieldId}`) : null;
  if (!field) {
    summary.focus();
    return;
  }
  let fieldError = form.querySelector<HTMLElement>(`[data-error-for="${fieldId}"]`);
  if (!fieldError) {
    fieldError = document.createElement("p");
    fieldError.className = "field-error";
    fieldError.dataset.errorFor = fieldId;
    field.insertAdjacentElement("afterend", fieldError);
  }
  fieldError.textContent = message;
  field.setAttribute("aria-invalid", "true");
  field.setAttribute("aria-describedby", fieldError.id || `${fieldId}-error`);
  fieldError.id = fieldError.id || `${fieldId}-error`;
  field.focus();
}

export function clearFormErrors(form: ParentNode, summary: HTMLElement): void {
  summary.hidden = true;
  summary.innerHTML = "";
  form.querySelectorAll(".field-error").forEach((item) => item.remove());
  form.querySelectorAll("[aria-invalid]").forEach((item) => item.removeAttribute("aria-invalid"));
}

export function mainContent(): HTMLElement {
  return element<HTMLElement>("#main-content");
}

export function replaceMainContent(markup: string, generation: number, currentGeneration: number): void {
  if (generation !== currentGeneration) {
    return;
  }
  const main = mainContent();
  main.innerHTML = markup;
  main.scrollTop = 0;
  window.scrollTo(0, 0);
}
