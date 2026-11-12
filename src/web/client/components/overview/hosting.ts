import { ServerPort } from "../../enums/serverPort.js";
import type { HostingInformation, ListenerReport, MailClientSettings, PublicPortReport } from "../../interfaces/models.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { fold } from "../../utils/presentation.js";

export function listenerList(listeners: ListenerReport[] | undefined, publicPorts: PublicPortReport | undefined): string {
  if (!listeners?.length) {
    return `<div class="empty"><h3>No listeners reported</h3><p>Restart the server and check port permissions.</p></div>`;
  }
  const checks = new Map((publicPorts?.checks || []).map((item) => [item.port, item]));
  const rows = listeners
    .map((listener) => {
      const status = listener.started ? "Ready" : `Unavailable: ${listener.detail}`;
      const check = checks.get(listener.port);
      let reachability = !listener.started ? "Not listening" : check?.result || "Not checked";
      if (!publicPorts?.address && reachability === "Unknown") {
        reachability = "Not checked";
      }
      const detail = check?.detail || publicPorts?.source || "";
      const tone = reachability === "Open" ? "status delivered" : reachability === "Closed" || reachability === "Not listening" ? "status-disabled" : "muted";
      return `<tr><td>${escapeHtml(listener.name)}</td><td>${listener.port}</td><td>${escapeHtml(listener.security)}</td><td>${escapeHtml(listener.purpose)}</td><td>${escapeHtml(status)}</td><td class="${tone}" title="${escapeHtml(detail)}">${escapeHtml(reachability)}</td></tr>`;
    })
    .join("");
  const address = publicPorts?.address
    ? `Checked ${escapeHtml(publicPorts.address)} (${escapeHtml(publicPorts.source)}).`
    : escapeHtml(publicPorts?.source || "The public address could not be checked.");
  return `<p class="hint">${address} Open means this server reached that address. Closed can mean a firewall or that the public address does not route back here.</p><div class="table-wrap"><table><caption class="visually-hidden">Protocol listeners</caption><thead><tr><th>Protocol</th><th>Port</th><th>Security</th><th>Purpose</th><th>Status</th><th>Public</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function renderMailClientSettingsCard(clients: MailClientSettings): string {
  return `<section class="card" id="mail-client-settings">
    <h2>Mail client settings</h2>
    <dl class="record-list">
      <div><dt>Incoming server</dt><dd>${escapeHtml(clients.incomingHost)} port ${clients.incomingPort}, ${escapeHtml(clients.incomingSecurity)}</dd></div>
      <div><dt>Outgoing server</dt><dd>${escapeHtml(clients.outgoingHost)} port ${clients.outgoingPort}, ${escapeHtml(clients.outgoingSecurity)}</dd></div>
      <div><dt>Username</dt><dd>Full email address</dd></div>
    </dl>
    ${fold(
      "Android",
      `<ol>
      <li>Add an IMAP account in the mail app.</li>
      <li>Use the host, port, and security values above.</li>
      <li>Username is the full email; password is the mailbox password.</li>
    </ol>`
    )}
    ${fold(
      "iOS",
      `<ol>
      <li>Add an IMAP account.</li>
      <li>Match the host, port, and TLS/SSL (or STARTTLS) values above.</li>
      <li>Sign in with the full email and mailbox password.</li>
    </ol>`
    )}
    ${fold(
      "Desktop",
      `<ol>
      <li>In Outlook, Thunderbird, or Apple Mail, choose IMAP.</li>
      <li>Enter the same host, port, and security values above.</li>
      <li>Username is the full email; password is the mailbox password.</li>
    </ol>`
    )}
  </section>`;
}

export function bindDnsRecordCopies(): void {
  document.querySelectorAll<HTMLButtonElement>("#dns-records [data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      void finishCopy(button, button.dataset.copy || "");
    });
  });
  const zoneButton = document.querySelector<HTMLButtonElement>("#copy-zone-file");
  zoneButton?.addEventListener("click", () => {
    const zoneFile = document.querySelector("#dns-zone-file")?.textContent || "";
    void finishCopy(zoneButton, zoneFile);
  });
}

function selectText(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

async function finishCopy(button: HTMLButtonElement, value: string): Promise<void> {
  const label = button.dataset.label || button.textContent || "Copy";
  button.dataset.label = label;
  const copiedNow = copyDuringClick(value);
  const copied = copiedNow || (await writeClipboard(value));
  if (!copied) {
    const zoneFile = document.querySelector<HTMLElement>("#dns-zone-file");
    const valueText = button.previousElementSibling;
    if (button.id === "copy-zone-file" && zoneFile) {
      selectText(zoneFile);
    } else if (valueText instanceof HTMLElement) {
      selectText(valueText);
    }
  }
  button.textContent = copied ? "Copied" : "Selected";
  window.setTimeout(() => {
    button.textContent = label;
  }, 1600);
}

function copyDuringClick(value: string): boolean {
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.width = "2em";
  area.style.height = "2em";
  area.style.padding = "0";
  area.style.border = "0";
  area.style.outline = "0";
  document.body.append(area);
  area.focus();
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-1000px";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

export function renderDnsRecords(hosting: HostingInformation | undefined): string {
  if (!hosting) {
    return "";
  }
  const webNote = hosting.secureWeb
    ? `The web console uses TLS on port ${ServerPort.Web}.`
    : "The web console is HTTP until a certificate is enabled.";
  return fold(
    "DNS records",
    `<div id="dns-records">
      <p class="hint">At your DNS host, point ${escapeHtml(hosting.domain)} at this server so others can deliver mail.</p>
      <div class="form-actions"><button id="copy-zone-file" class="quiet-button" type="button">Copy DNS records</button></div>
      <pre id="dns-zone-file" class="dns-zone">${escapeHtml(hosting.zoneFile || "")}</pre>
      <p class="hint">${escapeHtml(webNote)} Open the ports below on the firewall. The certificate should include ${escapeHtml(hosting.publicHostname)}.</p>
    </div>`,
    true
  );
}
