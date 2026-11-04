const setupScreen = document.querySelector("#setup-screen");
const signInScreen = document.querySelector("#sign-in-screen");
const applicationShell = document.querySelector("#application-shell");
const mainContent = document.querySelector("#main-content");
const navigation = document.querySelector("#primary-navigation");
const state = {
  bootstrap: null,
  folderName: "inbox",
  messageIdentifier: "",
  compose: null,
  composeAttachments: [],
  userQuery: "",
  userStatus: "",
  composerRange: null
};
let mailChartObserver = null;
let mailChartObservedElement = null;
let mailChartDismissPointer = null;

function icon(path) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="${path}"></path></svg>`;
}

const icons = {
  overview: icon("M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3"),
  logs: icon("M6 4h12v16H6zM8 8h8M8 12h8M8 16h5"),
  people: icon("M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19v-1a3 3 0 0 0-2-2.8M16 5.1a3 3 0 0 1 0 5.8"),
  mail: icon("M4 6h16v12H4zM4 7l8 6 8-6"),
  settings: icon("M4 7h16M4 12h16M4 17h16M8 5v4M14 10v4M10 15v4")
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function showScreen(name) {
  setupScreen.hidden = name !== "setup";
  signInScreen.hidden = name !== "sign-in";
  applicationShell.hidden = name !== "application";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showFormError(form, summary, message, fieldId) {
  summary.hidden = false;
  summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(message)}</p>`;
  const field = fieldId ? form.querySelector(`#${fieldId}`) : null;
  if (!field) {
    summary.focus();
    return;
  }
  let fieldError = form.querySelector(`[data-error-for="${fieldId}"]`);
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

function clearFormErrors(form, summary) {
  summary.hidden = true;
  summary.innerHTML = "";
  form.querySelectorAll(".field-error").forEach((item) => item.remove());
  form.querySelectorAll("[aria-invalid]").forEach((item) => item.removeAttribute("aria-invalid"));
}

function navigationItems() {
  const administrator = state.bootstrap.account?.role === "administrator";
  const items = [];
  if (administrator) {
    items.push(
      ["#overview", "Overview", icons.overview],
      ["#logs", "Logs", icons.logs],
      ["#users", "User management", icons.people],
      ["#settings", "Settings", icons.settings]
    );
  }
  items.push(["#mailbox", "Mailbox", icons.mail]);
  return items;
}

function renderNavigation() {
  const current = location.hash || "#overview";
  navigation.innerHTML = navigationItems()
    .map(([href, label, picture]) => {
      const active = current.startsWith(href) ? ' aria-current="page"' : "";
      return `<a class="nav-link" href="${href}"${active}>${picture}<span>${label}</span></a>`;
    })
    .join("");
  document.querySelector("#organization-label").textContent = state.bootstrap.organization?.displayName || "Company";
  document.querySelector("#account-label").textContent = state.bootstrap.account?.address || "";
}

function listenerList(listeners, publicPorts) {
  if (!listeners?.length) {
    return `<div class="empty"><h3>No listeners reported</h3><p>Start the server again and check the console for port permissions.</p></div>`;
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
  return `<p class="hint">${address} Open means this server could connect to that address. Closed can mean a firewall, or that the network does not route the public address back to this machine.</p><div class="table-wrap"><table><caption class="visually-hidden">Protocol listeners</caption><thead><tr><th>Protocol</th><th>Port</th><th>Security</th><th>Purpose</th><th>Status</th><th>Public</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function mailChartSeries(day) {
  const incoming = Number.isFinite(day.incoming) ? day.incoming : Number(day.delivered) || 0;
  const outgoing = Number.isFinite(day.outgoing) ? day.outgoing : Number(day.sent) || 0;
  return {
    incoming: Math.max(0, incoming),
    outgoing: Math.max(0, outgoing)
  };
}

function formatMailChartDate(value) {
  const parts = String(value || "").split("-");
  if (parts.length !== 3) {
    return String(value || "");
  }
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const dayOfMonth = Number(parts[2]);
  if (!year || !month || !dayOfMonth) {
    return String(value || "");
  }
  return new Date(Date.UTC(year, month - 1, dayOfMonth)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

function mailChartAxis(peak) {
  if (peak <= 0) {
    return { maximum: 1, values: [0, 1] };
  }
  if (peak <= 4) {
    const values = [];
    for (let value = 0; value <= peak; value += 1) {
      values.push(value);
    }
    return { maximum: peak, values };
  }
  const roughStep = peak / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  let niceStep = 10;
  if (normalized <= 1) {
    niceStep = 1;
  } else if (normalized <= 2) {
    niceStep = 2;
  } else if (normalized <= 5) {
    niceStep = 5;
  }
  const step = niceStep * magnitude;
  const maximum = Math.ceil(peak / step) * step;
  const values = [];
  for (let value = 0; value <= maximum; value += step) {
    values.push(value);
  }
  return { maximum, values };
}

function mailChartLabelIndexes(dayCount, plotWidth) {
  const stride = Math.max(1, Math.ceil((dayCount * 52) / Math.max(plotWidth, 1)));
  const indexes = [];
  for (let index = 0; index < dayCount; index += stride) {
    indexes.push(index);
  }
  const lastIndex = dayCount - 1;
  if (indexes[indexes.length - 1] !== lastIndex) {
    if (indexes.length > 1 && lastIndex - indexes[indexes.length - 1] < stride / 2) {
      indexes[indexes.length - 1] = lastIndex;
    } else {
      indexes.push(lastIndex);
    }
  }
  return new Set(indexes);
}

function mailChartPoint(index, count, dayCount, bounds, scaleMaximum) {
  const span = Math.max(dayCount - 1, 1);
  const x = dayCount === 1 ? bounds.left + bounds.width / 2 : bounds.left + (index / span) * bounds.width;
  const y = bounds.top + bounds.height - (count / scaleMaximum) * bounds.height;
  return { x, y };
}

function mailChartAreaPath(points, baseline) {
  if (!points.length) {
    return "";
  }
  const commands = [`M ${points[0].x.toFixed(1)} ${baseline.toFixed(1)}`];
  for (const point of points) {
    commands.push(`L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
  }
  commands.push(`L ${points[points.length - 1].x.toFixed(1)} ${baseline.toFixed(1)} Z`);
  return commands.join(" ");
}

function mailChartMarkup(days, width) {
  const height = 248;
  const plotLeft = 48;
  const plotRight = 12;
  const plotTop = 16;
  const plotBottom = 32;
  const plotWidth = Math.max(width - plotLeft - plotRight, 1);
  const plotHeight = height - plotTop - plotBottom;
  const bounds = { left: plotLeft, top: plotTop, width: plotWidth, height: plotHeight };
  const baseline = plotTop + plotHeight;
  const series = days.map((day) => mailChartSeries(day));
  const peak = Math.max(0, ...series.flatMap((item) => [item.incoming, item.outgoing]));
  const axis = mailChartAxis(peak);
  const labelIndexes = mailChartLabelIndexes(days.length, plotWidth);
  const incomingPoints = series.map((item, index) => mailChartPoint(index, item.incoming, days.length, bounds, axis.maximum));
  const outgoingPoints = series.map((item, index) => mailChartPoint(index, item.outgoing, days.length, bounds, axis.maximum));
  const grid = axis.values
    .map((value) => {
      const y = plotTop + plotHeight - (value / axis.maximum) * plotHeight;
      return `<line class="mail-chart-grid" x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotLeft + plotWidth}" y2="${y.toFixed(1)}"></line><text class="mail-chart-axis" x="${plotLeft - 8}" y="${y.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${value.toLocaleString()}</text>`;
    })
    .join("");
  const dateLabels = days
    .map((day, index) => {
      if (!labelIndexes.has(index)) {
        return "";
      }
      return `<text class="mail-chart-axis" x="${incomingPoints[index].x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(day.date.slice(5))}</text>`;
    })
    .join("");
  const pointMarkup = (points, className) =>
    points
      .map(
        (point, index) =>
          `<circle class="mail-chart-point ${className}" data-index="${index}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.25"></circle>`
      )
      .join("");
  const tableRows = days
    .map((day, index) => {
      const counts = series[index];
      return `<tr><td>${escapeHtml(formatMailChartDate(day.date))}</td><td>${counts.incoming.toLocaleString()}</td><td>${counts.outgoing.toLocaleString()}</td></tr>`;
    })
    .join("");
  return `<div class="mail-chart-legend"><span><i></i>Incoming</span><span class="outgoing"><i></i>Outgoing</span></div>
    <div class="mail-chart-plot" tabindex="0" role="group" aria-label="Incoming and outgoing email for the last 14 days">
      <svg class="mail-chart-svg" viewBox="0 0 ${width} ${height}" data-width="${width}" data-plot-left="${plotLeft}" data-plot-width="${plotWidth}" role="img" aria-label="Line chart of incoming and outgoing email">
        ${grid}
        <path class="mail-chart-incoming-area" d="${mailChartAreaPath(incomingPoints, baseline)}"></path>
        <path class="mail-chart-outgoing-area" d="${mailChartAreaPath(outgoingPoints, baseline)}"></path>
        <polyline class="mail-chart-incoming-line" points="${incomingPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}"></polyline>
        <polyline class="mail-chart-outgoing-line" points="${outgoingPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}"></polyline>
        ${pointMarkup(incomingPoints, "incoming")}
        ${pointMarkup(outgoingPoints, "outgoing")}
        <line class="mail-chart-cursor" x1="0" y1="${plotTop}" x2="0" y2="${baseline}" hidden></line>
        ${dateLabels}
        <rect class="mail-chart-hit" x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}"></rect>
      </svg>
      <div class="mail-chart-tooltip" role="tooltip" hidden></div>
    </div>
    <table class="visually-hidden"><caption>Incoming and outgoing email for the last 14 days</caption><thead><tr><th>Date</th><th>Incoming</th><th>Outgoing</th></tr></thead><tbody>${tableRows}</tbody></table>`;
}

function updateMailChartHover(chart, days, index) {
  const day = days[index];
  if (!day) {
    return;
  }
  const counts = mailChartSeries(day);
  const tooltip = chart.querySelector(".mail-chart-tooltip");
  tooltip.hidden = false;
  tooltip.innerHTML = `<p class="mail-chart-tooltip-date">${escapeHtml(formatMailChartDate(day.date))}</p>
    <p class="mail-chart-tooltip-row"><i></i><span>Incoming</span><strong>${counts.incoming.toLocaleString()}</strong></p>
    <p class="mail-chart-tooltip-row"><i class="outgoing"></i><span>Outgoing</span><strong>${counts.outgoing.toLocaleString()}</strong></p>`;
  chart.querySelectorAll(".mail-chart-point").forEach((point) => {
    const active = point.dataset.index === String(index);
    point.setAttribute("r", active ? "5" : "3.25");
    point.classList.toggle("is-active", active);
  });
  const cursor = chart.querySelector(".mail-chart-cursor");
  const activePoint = chart.querySelector(`.mail-chart-point[data-index="${index}"]`);
  if (cursor && activePoint) {
    cursor.setAttribute("x1", activePoint.getAttribute("cx"));
    cursor.setAttribute("x2", activePoint.getAttribute("cx"));
    cursor.removeAttribute("hidden");
  }
}

function clearMailChartHover(chart) {
  if (!chart?.isConnected) {
    return;
  }
  const tooltip = chart.querySelector(".mail-chart-tooltip");
  if (tooltip) {
    tooltip.hidden = true;
    tooltip.innerHTML = "";
  }
  chart.querySelectorAll(".mail-chart-point").forEach((point) => {
    point.setAttribute("r", "3.25");
    point.classList.remove("is-active");
  });
  chart.querySelector(".mail-chart-cursor")?.setAttribute("hidden", "");
}

function placeMailChartTooltip(chart) {
  const tooltip = chart.querySelector(".mail-chart-tooltip");
  const plot = chart.querySelector(".mail-chart-plot");
  const svg = chart.querySelector(".mail-chart-svg");
  const activePoint = chart.querySelector(".mail-chart-point.incoming.is-active");
  if (!tooltip || tooltip.hidden || !plot || !svg || !activePoint) {
    return;
  }
  const plotBounds = plot.getBoundingClientRect();
  const svgBounds = svg.getBoundingClientRect();
  const scale = svgBounds.width / Number(svg.dataset.width || svgBounds.width);
  const anchorX = svgBounds.left - plotBounds.left + Number(activePoint.getAttribute("cx")) * scale;
  const anchorY = svgBounds.top - plotBounds.top + Number(activePoint.getAttribute("cy")) * scale;
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  let left = anchorX - tooltipWidth / 2;
  let top = anchorY - tooltipHeight - 16;
  if (top < 8) {
    top = anchorY + 18;
  }
  left = Math.max(8, Math.min(left, plotBounds.width - tooltipWidth - 8));
  top = Math.max(8, Math.min(top, plotBounds.height - tooltipHeight - 8));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function mailChartIndexFromPointer(chart, pointerEvent) {
  const svg = chart.querySelector(".mail-chart-svg");
  const dayCount = chart.querySelectorAll(".mail-chart-point.incoming").length;
  if (!svg || dayCount < 1) {
    return 0;
  }
  const bounds = svg.getBoundingClientRect();
  const scale = bounds.width / Number(svg.dataset.width || bounds.width);
  const localX = (pointerEvent.clientX - bounds.left) / scale;
  const plotLeft = Number(svg.dataset.plotLeft || 0);
  const plotWidth = Number(svg.dataset.plotWidth || bounds.width);
  const ratio = plotWidth === 0 ? 0 : (localX - plotLeft) / plotWidth;
  const index = Math.round(ratio * Math.max(dayCount - 1, 0));
  return Math.max(0, Math.min(dayCount - 1, index));
}

function bindMailChartInteractions(chart, days) {
  const plot = chart.querySelector(".mail-chart-plot");
  if (!plot) {
    return;
  }
  let activeIndex = -1;
  const showDay = (index) => {
    activeIndex = index;
    updateMailChartHover(chart, days, index);
    placeMailChartTooltip(chart);
  };
  plot.addEventListener("pointermove", (event) => {
    if (event.pointerType === "touch") {
      return;
    }
    showDay(mailChartIndexFromPointer(chart, event));
  });
  plot.addEventListener("pointerdown", (event) => {
    showDay(mailChartIndexFromPointer(chart, event));
  });
  plot.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "mouse") {
      activeIndex = -1;
      clearMailChartHover(chart);
    }
  });
  plot.addEventListener("keydown", (event) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    let index = activeIndex;
    if (event.key === "Home") {
      index = 0;
    } else if (event.key === "End") {
      index = days.length - 1;
    } else if (event.key === "ArrowLeft") {
      index = index < 0 ? 0 : Math.max(0, index - 1);
    } else if (event.key === "ArrowRight") {
      index = index < 0 ? 0 : Math.min(days.length - 1, index + 1);
    }
    showDay(index, null);
  });
  if (mailChartDismissPointer) {
    document.removeEventListener("pointerdown", mailChartDismissPointer);
  }
  mailChartDismissPointer = (event) => {
    if (!chart.isConnected || !chart.contains(event.target)) {
      clearMailChartHover(chart);
    }
  };
  document.addEventListener("pointerdown", mailChartDismissPointer);
}

function drawMailChart(days) {
  const chart = document.querySelector("#mail-chart");
  if (!chart) {
    return;
  }
  const width = Math.round(chart.clientWidth);
  if (width < 32) {
    return;
  }
  const previousWidth = Number(chart.dataset.drawnWidth || 0);
  if (!chart.querySelector("svg") || Math.abs(previousWidth - width) >= 2) {
    chart.dataset.drawnWidth = String(width);
    chart.innerHTML = mailChartMarkup(days, width);
    bindMailChartInteractions(chart, days);
  }
  if (mailChartObservedElement !== chart) {
    if (mailChartObserver) {
      mailChartObserver.disconnect();
    }
    mailChartObserver = new ResizeObserver(() => drawMailChart(days));
    mailChartObserver.observe(chart);
    mailChartObservedElement = chart;
  }
}

function presentName(name) {
  const trimmed = String(name || "").trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.endsWith('"') && !trimmed.slice(0, -1).includes('"')) {
    return trimmed.slice(0, -1).trim();
  }
  return trimmed;
}

function animateView() {
  mainContent.classList.remove("view-enter");
  void mainContent.offsetWidth;
  mainContent.classList.add("view-enter");
}

function previewDocument(body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
}

function messageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

function messageButton(message) {
  const name = presentName(message.fromName) || message.fromAddress || "Unknown sender";
  const names = message.attachmentNames || [];
  const files = names.length === 1 ? names[0] : names.length ? `${names.length} files` : "";
  const current = message.identifier === state.messageIdentifier ? ' aria-current="true"' : "";
  return `<button class="message-button${message.seen ? "" : " unread"}" type="button" data-message="${message.identifier}"${current}>
    <span class="message-line"><span class="message-sender">${escapeHtml(name)}</span><time class="message-time">${escapeHtml(messageTime(message.date))}</time></span>
    <span class="message-subject">${escapeHtml(message.subject || "(no subject)")}</span>
    <span class="message-snippet">${escapeHtml(message.snippet || "")}</span>
    ${files ? `<span class="message-files">${escapeHtml(files)}</span>` : ""}
  </button>`;
}

function fold(title, body, open) {
  return `<details class="fold"${open ? " open" : ""}><summary>${title}</summary><div class="fold-body">${body}</div></details>`;
}

function renderClientSettings(hosting) {
  if (!hosting) {
    return "";
  }
  const clients = hosting.clients;
  return fold("Mail client settings", `<dl class="record-list">
        <div><dt>Incoming server</dt><dd>${escapeHtml(clients.incomingHost)} port ${clients.incomingPort}, ${escapeHtml(clients.incomingSecurity)}</dd></div>
        <div><dt>Outgoing server</dt><dd>${escapeHtml(clients.outgoingHost)} port ${clients.outgoingPort}, ${escapeHtml(clients.outgoingSecurity)}</dd></div>
        <div><dt>Username</dt><dd>The full email address</dd></div>
      </dl>`);
}

function renderHosting(hosting) {
  if (!hosting) {
    return "";
  }
  const records = hosting.dns
    .map((record) => `<tr><td>${escapeHtml(record.type)}</td><td>${escapeHtml(record.host)}</td><td>${escapeHtml(record.value)}</td></tr>`)
    .join("");
  const webNote = hosting.secureWeb
    ? "The web console is already using TLS."
    : "The web console is plain HTTP. Set WEB_TLS=true to serve it with data/certificates, or put a reverse proxy in front and send X-Forwarded-Proto only from this machine.";
  return `
    ${fold("DNS records", `<p class="hint">At the company DNS host, point ${escapeHtml(hosting.domain)} at this server before other companies can deliver mail. The VPS address should also reverse-resolve to ${escapeHtml(hosting.publicHostname)}. Change the public hostname in Settings when clients should use a different name.</p>
      <div class="table-wrap"><table><caption class="visually-hidden">DNS records</caption><thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>${records}</tbody></table></div>
      <p class="hint">${escapeHtml(webNote)} Open the protocol ports shown below on the VPS firewall. Replace data/certificates with a certificate that includes ${escapeHtml(hosting.publicHostname)}.</p>`)}
    ${renderClientSettings(hosting)}`;
}

async function renderOverview() {
  const summary = await requestJson("/api/activity/summary");
  const today = summary.days[summary.days.length - 1] || { delivered: 0, failed: 0, sent: 0, rejected: 0 };
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(summary.organization?.domain || "")}</p><h1>Overview</h1></div></header>
    <section class="metric-grid" aria-label="Today">
      <article class="card metric"><span>Users</span><strong>${summary.mailboxCount}</strong></article>
      <article class="card metric"><span>Delivered today</span><strong>${today.delivered}</strong></article>
      <article class="card metric"><span>Sent today</span><strong>${today.sent}</strong></article>
      <article class="card metric"><span>Needs attention</span><strong>${today.failed + today.rejected + summary.queued}</strong><span class="muted">${summary.queued} waiting to retry</span></article>
    </section>
    ${fold("Last 14 days", `<div id="mail-chart" class="mail-chart"></div>`, true)}
    ${renderHosting(summary.hosting)}
    ${fold("Listeners", listenerList(summary.listeners, summary.publicPorts))}`;
  animateView();
  drawMailChart(summary.days);
}

async function renderLogs() {
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">Audit</p><h1>Email logs</h1></div></header>
    <form id="log-filter" class="filters">
      <div><label for="log-search">Search sender, recipient, or subject</label><input id="log-search" type="search"></div>
      <div><label for="log-protocol">Protocol</label><select id="log-protocol"><option value="">All</option><option>smtp</option><option>imap</option><option>pop3</option><option>web</option></select></div>
      <div><label for="log-result">Result</label><select id="log-result"><option value="">All</option><option>delivered</option><option>accepted</option><option>queued</option><option>failed</option><option>rejected</option></select></div>
      <button class="quiet-button" type="submit">Apply</button>
    </form>
    <div id="log-table"></div>`;
  document.querySelector("#log-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    loadLogs();
  });
  await loadLogs();
  animateView();
}

async function loadLogs() {
  const parameters = new URLSearchParams({
    search: document.querySelector("#log-search").value,
    protocol: document.querySelector("#log-protocol").value,
    result: document.querySelector("#log-result").value
  });
  const payload = await requestJson(`/api/activity?${parameters.toString()}`);
  const target = document.querySelector("#log-table");
  if (!payload.events.length) {
    target.innerHTML = `<div class="empty"><h2>No matching log entries</h2><p>Mail received on port 25 and mail sent by signed-in users will appear here.</p></div>`;
    return;
  }
  const rows = payload.events
    .map((event) => `<tr><td>${escapeHtml(new Date(event.occurredAt).toLocaleString())}</td><td>${escapeHtml(event.protocol)}</td><td class="status ${escapeHtml(event.result)}">${escapeHtml(event.result)}</td><td>${escapeHtml(event.senderAddress)}</td><td>${escapeHtml(event.recipientAddresses.join(", "))}</td><td>${escapeHtml(event.subject)}</td><td>${escapeHtml(event.detail)}</td></tr>`)
    .join("");
  target.innerHTML = `<div class="table-wrap"><table><caption class="visually-hidden">Email activity</caption><thead><tr><th>Time</th><th>Protocol</th><th>Result</th><th>Sender</th><th>Recipients</th><th>Subject</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function signInButton(person, people) {
  if (person.disabled) {
    return `<button id="enable-user" class="quiet-button" type="button">Enable sign-in</button>`;
  }
  const signedInAddress = state.bootstrap.account?.address || "";
  const anotherActiveAdministrator = people.some(
    (mailbox) => mailbox.address !== person.address && mailbox.role === "administrator" && !mailbox.disabled
  );
  const cannotDisable = person.address === signedInAddress || (person.role === "administrator" && !anotherActiveAdministrator);
  return `<button id="disable-user" class="danger-button" type="button"${cannotDisable ? " disabled" : ""}>Disable sign-in</button>`;
}

function filteredPeople(people) {
  const query = state.userQuery.trim().toLowerCase();
  return people.filter((person) => {
    const matchesQuery = !query || `${person.displayName} ${person.address}`.toLowerCase().includes(query);
    const matchesStatus = state.userStatus === "" || (state.userStatus === "disabled" ? person.disabled : !person.disabled);
    return matchesQuery && matchesStatus;
  });
}

function userRows(people) {
  if (!people.length) {
    const message = state.userQuery || state.userStatus ? "No users match this filter." : "Add the first user for this company.";
    return `<tr><td colspan="5"><div class="empty"><h2>No users</h2><p>${message}</p></div></td></tr>`;
  }
  return people
    .map((person) => {
      const role = person.role === "administrator" ? "Administrator" : "Member";
      return `<tr><td>${escapeHtml(person.displayName)}</td><td>${escapeHtml(person.address)}</td><td>${role}</td><td class="${person.disabled ? "status-disabled" : "status accepted"}">${person.disabled ? "Disabled" : "Active"}</td><td><button class="quiet-button" type="button" data-manage="${escapeHtml(person.address)}">Edit</button></td></tr>`;
    })
    .join("");
}

function bindUserRows() {
  document.querySelectorAll("[data-manage]").forEach((button) => {
    button.addEventListener("click", () => {
      location.hash = `#users/${encodeURIComponent(button.dataset.manage)}`;
    });
  });
}

async function renderUserDirectory() {
  const payload = await requestJson("/api/mailboxes");
  const visible = filteredPeople(payload.mailboxes);
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(state.bootstrap.organization.domain)}</p><h1>User management</h1></div><button id="add-user" class="primary-button" type="button">Add user</button></header>
    <div class="filters user-filters">
      <div><label for="user-search">Email</label><input id="user-search" type="search" value="${escapeHtml(state.userQuery)}" placeholder="Filter by email" autocomplete="off"></div>
      <div><label for="user-status">Status</label><select id="user-status">
        <option value="" ${state.userStatus === "" ? "selected" : ""}>All</option>
        <option value="active" ${state.userStatus === "active" ? "selected" : ""}>Active</option>
        <option value="disabled" ${state.userStatus === "disabled" ? "selected" : ""}>Disabled</option>
      </select></div>
    </div>
    <div class="table-wrap"><table><caption class="visually-hidden">Company users</caption><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody id="user-rows">${userRows(visible)}</tbody></table></div>`;
  animateView();
  const search = document.querySelector("#user-search");
  const status = document.querySelector("#user-status");
  const paint = () => {
    state.userQuery = search.value;
    state.userStatus = status.value;
    document.querySelector("#user-rows").innerHTML = userRows(filteredPeople(payload.mailboxes));
    bindUserRows();
  };
  search.addEventListener("input", paint);
  status.addEventListener("change", paint);
  document.querySelector("#add-user").addEventListener("click", () => {
    location.hash = "#users/new";
  });
  bindUserRows();
}

async function renderUserEditor(address, notice) {
  const payload = await requestJson("/api/mailboxes");
  const people = payload.mailboxes;
  const creating = !address;
  const selected = creating ? null : people.find((person) => person.address === address);
  if (!creating && !selected) {
    mainContent.innerHTML = `
      <header class="page-header"><div><p class="eyebrow">User management</p><h1>User not found</h1></div><button id="back-users" class="quiet-button" type="button">Back to users</button></header>
      <p>That mailbox is not on this server.</p>`;
    document.querySelector("#back-users").addEventListener("click", () => {
      location.hash = "#users";
    });
    animateView();
    return;
  }
  const savedNotice = notice ? `<div class="notice"><h2>Saved</h2><p>${escapeHtml(notice)}</p></div>` : "";
  const body = creating
    ? `<form id="user-form" class="card detail-card"><div id="user-summary" class="error-summary" tabindex="-1" hidden></div>
      <label for="user-name">Name</label><input id="user-name" autocomplete="name" required maxlength="80">
      <label for="user-address">Email address</label><input id="user-address" autocomplete="off" required placeholder="person@${escapeHtml(state.bootstrap.organization.domain)}">
      <label for="user-password">Password</label><input id="user-password" type="password" autocomplete="new-password" required minlength="8">
      <p class="hint">The address must use ${escapeHtml(state.bootstrap.organization.domain)}. The password is also used for SMTP, IMAP, and POP3.</p>
      <div class="form-actions"><button class="primary-button" type="submit">Create user</button><button id="cancel-user" class="quiet-button" type="button">Cancel</button></div>
    </form>`
    : `<form id="manage-form" class="card detail-card"><h2>${escapeHtml(presentName(selected.displayName) || selected.address)}</h2>${savedNotice}<div id="manage-summary" class="error-summary" tabindex="-1" hidden></div>
      <dl class="record-list">
        <div><dt>Email</dt><dd>${escapeHtml(selected.address)}</dd></div>
        <div><dt>Role</dt><dd>${selected.role === "administrator" ? "Administrator" : "Member"}</dd></div>
        <div><dt>Status</dt><dd class="${selected.disabled ? "status-disabled" : ""}">${selected.disabled ? "Disabled" : "Active"}</dd></div>
      </dl>
      <label for="manage-password">New password</label><input id="manage-password" type="password" autocomplete="new-password" minlength="8">
      <p class="hint">Leave the password empty to keep the current one. Disabling blocks the web console, SMTP, IMAP, and POP3.</p>
      <input id="manage-address" type="hidden" value="${escapeHtml(selected.address)}">
      <div class="form-actions"><button class="primary-button" type="submit">Save password</button>${signInButton(selected, people)}<button id="cancel-user" class="quiet-button" type="button">Back to users</button></div>
    </form>`;
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">User management</p><h1>${creating ? "Add a user" : "Edit user"}</h1></div><button id="back-users" class="quiet-button" type="button">Back to users</button></header>
    ${body}`;
  const back = () => {
    location.hash = "#users";
  };
  document.querySelector("#back-users").addEventListener("click", back);
  document.querySelector("#cancel-user").addEventListener("click", back);
  document.querySelector("#user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const summary = document.querySelector("#user-summary");
    clearFormErrors(form, summary);
    try {
      await requestJson("/api/mailboxes", {
        method: "POST",
        body: JSON.stringify({
          displayName: document.querySelector("#user-name").value,
          address: document.querySelector("#user-address").value,
          password: document.querySelector("#user-password").value
        })
      });
      location.hash = "#users";
    } catch (error) {
      showFormError(form, summary, error.message, "user-address");
    }
  });
  document.querySelector("#manage-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await updateUser(false);
  });
  document.querySelector("#disable-user")?.addEventListener("click", () => updateUser(true, true));
  document.querySelector("#enable-user")?.addEventListener("click", () => updateUser(true, false));
  animateView();
  document.querySelector("#user-name")?.focus();
}

async function updateUser(changeAccess, disabled) {
  const form = document.querySelector("#manage-form");
  const summary = document.querySelector("#manage-summary");
  clearFormErrors(form, summary);
  const address = document.querySelector("#manage-address").value;
  try {
    if (changeAccess) {
      await requestJson("/api/mailboxes/access", { method: "POST", body: JSON.stringify({ address, disabled }) });
      await renderUserEditor(address, disabled ? "Sign-in is disabled." : "Sign-in is enabled.");
      return;
    }
    const password = document.querySelector("#manage-password").value;
    if (password.length < 8) {
      showFormError(form, summary, "Password must be 8 to 200 characters.", "manage-password");
      return;
    }
    await requestJson("/api/mailboxes/password", { method: "POST", body: JSON.stringify({ address, password }) });
    await renderUserEditor(address, "The password was updated.");
  } catch (error) {
    showFormError(form, summary, error.message, changeAccess ? "" : "manage-password");
  }
}

function folderLabel(folders) {
  return folders.find((folder) => folder.storageName === state.folderName)?.label || "Inbox";
}

async function renderMailbox() {
  if (state.compose) {
    renderComposer();
    return;
  }
  const folderPayload = await requestJson("/api/folders");
  const messagePayload = await requestJson(`/api/folders/${encodeURIComponent(state.folderName)}/messages`);
  const folders = folderPayload.folders
    .map((folder) => {
      const unread = folder.unseenCount > 0 ? `<span class="folder-new">${folder.unseenCount} new</span>` : "";
      return `<button class="folder-link" type="button" data-folder="${escapeHtml(folder.storageName)}" ${folder.storageName === state.folderName ? 'aria-current="page"' : ""}><span>${escapeHtml(folder.label)}</span><span class="folder-meta"><span class="folder-count">${folder.messageCount}</span>${unread}</span></button>`;
    })
    .join("");
  const messages = messagePayload.messages.length
    ? messagePayload.messages.map((message) => messageButton(message)).join("")
    : `<div class="empty"><h2>No messages</h2><p>New mail for ${escapeHtml(folderLabel(folderPayload.folders))} will show up here.</p></div>`;
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(state.bootstrap.account.address)}</p><h1>Mailbox</h1></div><button id="compose-button" class="primary-button" type="button">New message</button></header>
    <div class="mailbox" id="mailbox-layout">
      <nav class="folder-rail" aria-label="Folders">${folders}</nav>
      <div class="message-column">
        <div class="message-toolbar"><label class="visually-hidden" for="message-search">Search this folder</label><input id="message-search" type="search" placeholder="Search sender, subject, or words"></div>
        <div id="message-results" class="message-results">${messages}</div>
      </div>
      <article class="reading" id="reading-pane"><button id="back-button" class="quiet-button back-button" type="button">Back to list</button><div class="reading-empty"><h2>Select a message</h2><p>It opens in this pane.</p></div></article>
    </div>`;
  animateView();
  document.querySelector("#compose-button").addEventListener("click", () => openComposer());
  document.querySelectorAll("[data-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      state.folderName = button.dataset.folder;
      state.messageIdentifier = "";
      renderMailbox();
    });
  });
  document.querySelector("#message-search").addEventListener("input", async (event) => {
    const payload = await requestJson(`/api/folders/${encodeURIComponent(state.folderName)}/messages?search=${encodeURIComponent(event.target.value)}`);
    const buttons = payload.messages.map((message) => messageButton(message)).join("");
    document.querySelector("#message-results").innerHTML = buttons || `<div class="empty"><h2>No matches</h2><p>Try a sender, subject, or word from the message.</p></div>`;
    bindMessages();
  });
  document.querySelector("#back-button").addEventListener("click", () => {
    document.querySelector("#mailbox-layout").classList.remove("show-reading");
  });
  bindMessages();
  if (state.messageIdentifier) {
    try {
      await openMessage(state.messageIdentifier);
    } catch (error) {
      state.messageIdentifier = "";
    }
  }
}

function openComposer(draft) {
  state.composeAttachments = [];
  state.compose = {
    to: draft?.to || "",
    copy: draft?.copy || "",
    subject: draft?.subject || "",
    html: draft?.html || "",
    replyText: draft?.replyText || "",
    replyTo: draft?.replyTo || ""
  };
  renderMailbox();
}

function renderComposer() {
  const draft = state.compose;
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">Mail</p><h1>New message</h1></div><button id="close-compose" class="quiet-button" type="button">Back to mail</button></header>
    <form id="compose-panel" class="card composer">
      <div id="compose-summary" class="error-summary" tabindex="-1" hidden></div>
      <div class="composer-fields">
        <label for="compose-to">To</label><input id="compose-to" required value="${escapeHtml(draft.to)}">
        <label for="compose-copy">Copy</label><input id="compose-copy" value="${escapeHtml(draft.copy)}">
        <label for="compose-subject">Subject</label><input id="compose-subject" value="${escapeHtml(draft.subject)}">
      </div>
      <div class="compose-toolbar" role="toolbar" aria-label="Formatting">
        <button id="format-bold" class="quiet-button" type="button">Bold</button>
        <button id="format-italic" class="quiet-button" type="button">Italic</button>
        <button id="format-link" class="quiet-button" type="button">Link</button>
        <button id="insert-image" class="quiet-button" type="button">Image</button>
        <button id="attach-file" class="quiet-button" type="button">Attach</button>
        <button id="preview-toggle" class="quiet-button" type="button" aria-pressed="false">Preview</button>
      </div>
      <div id="compose-link-row" class="link-row" hidden>
        <div class="link-field"><label for="compose-link">Link address</label><input id="compose-link" placeholder="https://example.com"></div>
        <button id="apply-link" class="quiet-button" type="button">Add link</button>
      </div>
      <div id="compose-editor" class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message"></div>
      <article id="compose-preview" class="compose-preview" hidden></article>
      <input id="compose-files" type="file" multiple hidden>
      <input id="compose-image" type="file" accept="image/*" hidden>
      <ul id="compose-attachments" class="attachment-list"></ul>
      <p class="hint">Select text, then use Bold, Italic, or Link. Images appear in the message. Preview shows it before sending.</p>
      <div class="reading-actions"><button id="send-button" class="primary-button" type="button">Send</button><button id="draft-button" class="quiet-button" type="button">Save draft</button></div>
    </form>`;
  const editor = document.querySelector("#compose-editor");
  if (draft.html) {
    editor.innerHTML = draft.html;
  } else if (draft.replyText) {
    editor.innerText = draft.replyText;
  }
  editor.dataset.replyTo = draft.replyTo || "";
  editor.addEventListener("mouseup", rememberComposerSelection);
  editor.addEventListener("keyup", rememberComposerSelection);
  animateView();
  document.querySelector("#compose-panel").addEventListener("submit", (event) => {
    event.preventDefault();
    submitCompose(false);
  });
  document.querySelector("#close-compose").addEventListener("click", () => {
    state.compose = null;
    state.composeAttachments = [];
    renderMailbox();
  });
  document.querySelector("#format-bold").addEventListener("mousedown", keepComposerSelection);
  document.querySelector("#format-italic").addEventListener("mousedown", keepComposerSelection);
  document.querySelector("#format-link").addEventListener("mousedown", keepComposerSelection);
  document.querySelector("#insert-image").addEventListener("mousedown", keepComposerSelection);
  document.querySelector("#preview-toggle").addEventListener("mousedown", keepComposerSelection);
  document.querySelector("#format-bold").addEventListener("click", () => formatComposer("strong"));
  document.querySelector("#format-italic").addEventListener("click", () => formatComposer("em"));
  document.querySelector("#format-link").addEventListener("click", () => {
    const row = document.querySelector("#compose-link-row");
    row.hidden = !row.hidden;
    if (!row.hidden) {
      document.querySelector("#compose-link").focus();
    }
  });
  document.querySelector("#apply-link").addEventListener("click", () => {
    const address = linkAddress(document.querySelector("#compose-link").value);
    const summary = document.querySelector("#compose-summary");
    if (!address) {
      showFormError(document.querySelector("#compose-panel"), summary, "Use a full http, https, or mailto address.", "compose-link");
      return;
    }
    clearFormErrors(document.querySelector("#compose-panel"), summary);
    if (!wrapComposerSelection("a", { href: address })) {
      showFormError(document.querySelector("#compose-panel"), summary, "Select the text that should become the link.", "compose-link");
      return;
    }
    document.querySelector("#compose-link-row").hidden = true;
  });
  document.querySelector("#attach-file").addEventListener("click", () => document.querySelector("#compose-files").click());
  document.querySelector("#insert-image").addEventListener("click", () => {
    showComposePreview(false);
    document.querySelector("#compose-image").click();
  });
  document.querySelector("#compose-files").addEventListener("change", (event) => addComposerFiles(event.target.files, false));
  document.querySelector("#compose-image").addEventListener("change", (event) => addComposerFiles(event.target.files, true));
  document.querySelector("#preview-toggle").addEventListener("click", () => {
    const button = document.querySelector("#preview-toggle");
    showComposePreview(button.getAttribute("aria-pressed") !== "true");
  });
  document.querySelector("#send-button").addEventListener("click", () => submitCompose(false));
  document.querySelector("#draft-button").addEventListener("click", () => submitCompose(true));
  renderComposerAttachments();
  document.querySelector("#compose-to").focus();
}

function showComposePreview(preview) {
  const editor = document.querySelector("#compose-editor");
  const previewPane = document.querySelector("#compose-preview");
  const button = document.querySelector("#preview-toggle");
  if (!editor || !previewPane || !button) {
    return;
  }
  if (preview) {
    const subject = document.querySelector("#compose-subject").value.trim() || "(No subject)";
    const recipient = document.querySelector("#compose-to").value.trim() || "No recipient yet";
    const body = editor.innerText.trim() ? editor.innerHTML : "<p>Nothing to preview yet.</p>";
    previewPane.innerHTML = `<p class="muted">To ${escapeHtml(recipient)}</p><h2>${escapeHtml(subject)}</h2><iframe class="message-frame" sandbox title="Message preview" srcdoc="${escapeHtml(previewDocument(body))}"></iframe>`;
    editor.hidden = true;
    previewPane.hidden = false;
    button.textContent = "Edit";
    button.setAttribute("aria-pressed", "true");
    return;
  }
  editor.hidden = false;
  previewPane.hidden = true;
  previewPane.innerHTML = "";
  button.textContent = "Preview";
  button.setAttribute("aria-pressed", "false");
}

function bindMessages() {
  document.querySelectorAll("[data-message]").forEach((button) => {
    button.addEventListener("click", () => openMessage(button.dataset.message));
  });
}

async function openMessage(identifier) {
  state.messageIdentifier = identifier;
  const payload = await requestJson(`/api/folders/${encodeURIComponent(state.folderName)}/messages/${identifier}`);
  const message = payload.message;
  const attachments = (message.attachments || [])
    .map((attachment, index) => ({ attachment, index }))
    .filter(({ attachment }) => !attachment.contentIdentifier || !(message.html || "").includes(attachment.contentIdentifier))
    .map(({ attachment, index }) => `<li><a href="/api/folders/${encodeURIComponent(state.folderName)}/messages/${identifier}/attachments/${index}">${escapeHtml(attachment.fileName)}</a></li>`)
    .join("");
  const html = await inlineMessageImages(message);
  const body = html
    ? `<iframe class="message-frame" sandbox title="Message" srcdoc="${escapeHtml(previewDocument(html))}"></iframe>`
    : `<p>${escapeHtml(message.text).replace(/\n/g, "<br>")}</p>`;
  document.querySelector("#reading-pane").innerHTML = `
    <button id="back-button" class="quiet-button back-button" type="button">Back to list</button>
    <header class="message-heading">
      <div class="reading-actions"><button id="reply-button" class="quiet-button" type="button">Reply</button><button id="delete-button" class="danger-button" type="button">Delete</button></div>
      <h2>${escapeHtml(message.subject)}</h2>
      <p class="message-from">From ${escapeHtml(presentName(message.fromName) || message.fromAddress)} &lt;${escapeHtml(message.fromAddress)}&gt;</p>
      <p class="muted">${escapeHtml(new Date(message.date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }))}</p>
    </header>
    ${attachments ? `<ul class="attachment-list">${attachments}</ul>` : ""}
    ${body}`;
  document.querySelectorAll("[data-message]").forEach((button) => {
    if (button.dataset.message === identifier) {
      button.setAttribute("aria-current", "true");
      button.classList.remove("unread");
    } else {
      button.removeAttribute("aria-current");
    }
  });
  document.querySelector("#mailbox-layout").classList.add("show-reading");
  document.querySelector("#back-button").addEventListener("click", () => {
    document.querySelector("#mailbox-layout").classList.remove("show-reading");
  });
  document.querySelector("#delete-button").addEventListener("click", async () => {
    await requestJson(`/api/folders/${encodeURIComponent(state.folderName)}/messages/${identifier}`, { method: "DELETE" });
    state.messageIdentifier = "";
    await renderMailbox();
  });
  document.querySelector("#reply-button").addEventListener("click", () => {
    const subject = message.subject.startsWith("Re:") ? message.subject : `Re: ${message.subject}`;
    openComposer({
      to: message.fromAddress,
      subject,
      replyText: `\n\nOn ${new Date(message.date).toLocaleString()}, ${presentName(message.fromName) || message.fromAddress} wrote:\n${message.text}`,
      replyTo: message.messageIdentifierHeader || ""
    });
  });
}

function formatComposer(tagName) {
  wrapComposerSelection(tagName);
}

function keepComposerSelection(event) {
  event.preventDefault();
  rememberComposerSelection();
}

document.addEventListener("selectionchange", () => {
  const editor = document.querySelector("#compose-editor");
  const selection = window.getSelection();
  if (!editor || editor.hidden || !selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return;
  }
  if (range.collapsed && state.composerRange && !state.composerRange.collapsed) {
    return;
  }
  state.composerRange = range.cloneRange();
});

function rememberComposerSelection() {
  const editor = document.querySelector("#compose-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer) || range.collapsed) {
    return;
  }
  state.composerRange = range.cloneRange();
}

function restoreComposerSelection() {
  const editor = document.querySelector("#compose-editor");
  if (!editor) {
    return;
  }
  editor.focus();
  if (!state.composerRange) {
    return;
  }
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(state.composerRange);
}

function wrapComposerSelection(tagName, attributes) {
  restoreComposerSelection();
  const editor = document.querySelector("#compose-editor");
  const selection = window.getSelection();
  if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) {
    return false;
  }
  const wrapper = document.createElement(tagName);
  Object.entries(attributes || {}).forEach(([key, value]) => wrapper.setAttribute(key, value));
  wrapper.appendChild(range.extractContents());
  range.insertNode(wrapper);
  const next = document.createRange();
  next.selectNodeContents(wrapper);
  selection.removeAllRanges();
  selection.addRange(next);
  state.composerRange = next.cloneRange();
  return true;
}

function linkAddress(value) {
  const trimmed = value.trim();
  if (/^https:\/\/\S+$/i.test(trimmed) || /^http:\/\/\S+$/i.test(trimmed) || /^mailto:\S+$/i.test(trimmed)) {
    return trimmed;
  }
  return "";
}

function insertComposerImage(source, name) {
  const editor = document.querySelector("#compose-editor");
  if (!editor) {
    return;
  }
  const image = document.createElement("img");
  image.src = source;
  image.alt = name;
  const block = document.createElement("div");
  block.appendChild(image);
  const range = state.composerRange;
  let node = range ? range.startContainer : null;
  if (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentElement;
  }
  const link = node && editor.contains(node) ? node.closest("a") : null;
  let blockParent = link || node;
  while (blockParent && blockParent.parentElement && blockParent.parentElement !== editor) {
    blockParent = blockParent.parentElement;
  }
  if (blockParent && blockParent.parentElement === editor) {
    editor.insertBefore(block, blockParent.nextSibling);
    return;
  }
  editor.appendChild(block);
}

function renderComposerAttachments() {
  const list = document.querySelector("#compose-attachments");
  if (!list) {
    return;
  }
  list.innerHTML = state.composeAttachments
    .map((attachment, index) => `<li>${escapeHtml(attachment.fileName)} <button class="quiet-button" type="button" data-remove-attachment="${index}">Remove</button></li>`)
    .join("");
  list.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.composeAttachments.splice(Number(button.dataset.removeAttachment), 1);
      renderComposerAttachments();
    });
  });
}

function readFileRecord(file, inline) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const encoded = result.includes(",") ? result.split(",")[1] : "";
      const identifier = inline ? `image-${Date.now()}-${state.composeAttachments.length}@local` : "";
      const record = {
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        contentEncoded: encoded,
        contentIdentifier: identifier
      };
      if (inline) {
        insertComposerImage(result, file.name);
      }
      resolve(record);
    };
    reader.readAsDataURL(file);
  });
}

async function addComposerFiles(files, inline) {
  for (const file of files || []) {
    const record = await readFileRecord(file, inline);
    if (!inline) {
      state.composeAttachments.push(record);
    } else {
      record.preview = true;
    }
  }
  const input = document.querySelector(inline ? "#compose-image" : "#compose-files");
  if (input) {
    input.value = "";
  }
  renderComposerAttachments();
}

function prepareComposerHtml(html) {
  const attachments = [];
  let index = 0;
  const prepared = String(html || "").replace(/<img\b[^>]*\bsrc=(["'])(data:[^"']+)\1[^>]*>/gi, (tag, quote, source) => {
    const identifier = `image-${index}-${Date.now()}@local`;
    const contentType = source.slice(5, source.indexOf(";")) || "image/png";
    const extension = contentType.includes("jpeg") ? "jpg" : contentType.includes("gif") ? "gif" : contentType.includes("webp") ? "webp" : "png";
    attachments.push({
      fileName: `image-${index + 1}.${extension}`,
      contentType,
      contentEncoded: source.split(",")[1] || "",
      contentIdentifier: identifier
    });
    index += 1;
    return tag.replace(`${quote}${source}${quote}`, `${quote}cid:${identifier}${quote}`);
  });
  return { html: prepared, attachments };
}

async function inlineMessageImages(message) {
  let html = message.html || "";
  for (const attachment of message.attachments || []) {
    if (!html || !attachment.contentIdentifier || !String(attachment.contentType || "").startsWith("image/")) {
      continue;
    }
    const response = await fetch(
      `/api/folders/${encodeURIComponent(state.folderName)}/messages/${message.identifier}/attachments/${attachment.index}`,
      { credentials: "same-origin" }
    );
    if (!response.ok) {
      continue;
    }
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
    html = html.split(`cid:${attachment.contentIdentifier}`).join(dataUrl);
  }
  return html;
}

async function submitCompose(saveDraft) {
  const summary = document.querySelector("#compose-summary");
  clearFormErrors(document.querySelector("#compose-panel"), summary);
  const editor = document.querySelector("#compose-editor");
  const prepared = prepareComposerHtml(editor.innerHTML);
  const payload = {
    to: document.querySelector("#compose-to").value,
    copy: document.querySelector("#compose-copy").value,
    subject: document.querySelector("#compose-subject").value,
    text: editor.innerText,
    html: prepared.html,
    attachments: [...state.composeAttachments, ...prepared.attachments],
    inReplyTo: editor.dataset.replyTo || ""
  };
  try {
    if (!saveDraft && !payload.to.trim()) {
      showFormError(document.querySelector("#compose-panel"), summary, "Enter at least one recipient.", "compose-to");
      return;
    }
    await requestJson(saveDraft ? "/api/drafts" : "/api/messages", { method: "POST", body: JSON.stringify(payload) });
    state.compose = null;
    state.composeAttachments = [];
    if (saveDraft) {
      state.folderName = "drafts";
    } else {
      state.folderName = "sent";
    }
    await renderMailbox();
  } catch (error) {
    showFormError(document.querySelector("#compose-panel"), summary, error.message, "compose-to");
  }
}

async function renderRoute() {
  if (!state.bootstrap?.account) {
    return;
  }
  renderNavigation();
  const route = (location.hash || (state.bootstrap.account.role === "administrator" ? "#overview" : "#mailbox")).replace("#", "");
  if (route.startsWith("logs") && state.bootstrap.account.role === "administrator") {
    await renderLogs();
    return;
  }
  if (state.bootstrap.account.role === "administrator" && (route === "users/new" || route.startsWith("users/"))) {
    const address = route === "users/new" ? "" : decodeURIComponent(route.slice("users/".length));
    await renderUserEditor(address);
    return;
  }
  if ((route === "users" || route.startsWith("mailboxes")) && state.bootstrap.account.role === "administrator") {
    await renderUserDirectory();
    return;
  }
  if (route.startsWith("settings") && state.bootstrap.account.role === "administrator") {
    await renderSettings();
    return;
  }
  if (route.startsWith("account")) {
    await renderPassword();
    return;
  }
  if (route.startsWith("mailbox")) {
    await renderMailbox();
    return;
  }
  if (state.bootstrap.account.role === "administrator") {
    await renderOverview();
    return;
  }
  location.hash = "#mailbox";
}

async function loadBootstrap() {
  const previousAddress = state.bootstrap?.account?.address || "";
  state.bootstrap = await requestJson("/api/bootstrap");
  const nextAddress = state.bootstrap.account?.address || "";
  if (previousAddress !== nextAddress) {
    state.folderName = "inbox";
    state.messageIdentifier = "";
    state.compose = null;
    state.composeAttachments = [];
    state.userQuery = "";
    state.userStatus = "";
  }
  if (state.bootstrap.needsSetup) {
    showScreen("setup");
    if (state.bootstrap.configuredDomain) {
      const domain = document.querySelector("#setup-domain");
      domain.value = state.bootstrap.configuredDomain;
      domain.readOnly = true;
    }
    return;
  }
  if (!state.bootstrap.account) {
    showScreen("sign-in");
    document.querySelector("#sign-in-title").textContent = state.bootstrap.organization.displayName;
    document.querySelector("#sign-in-detail").textContent = `Sign in with your ${state.bootstrap.organization.domain} mailbox.`;
    resetSignInStep();
    return;
  }
  showScreen("application");
  if (!location.hash) {
    location.hash = state.bootstrap.account.role === "administrator" ? "#overview" : "#mailbox";
  }
  await renderRoute();
}

document.querySelector("#setup-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const summary = document.querySelector("#setup-summary");
  clearFormErrors(form, summary);
  const domain = document.querySelector("#setup-domain").value.trim().toLowerCase();
  const address = document.querySelector("#setup-address").value.trim().toLowerCase();
  if (!address.endsWith(`@${domain}`)) {
    showFormError(form, summary, `The address must use @${domain}.`, "setup-address");
    return;
  }
  try {
    await requestJson("/api/setup", {
      method: "POST",
      body: JSON.stringify({
        organizationName: document.querySelector("#setup-organization").value,
        domain,
        displayName: document.querySelector("#setup-name").value,
        address,
        password: document.querySelector("#setup-password").value
      })
    });
    location.hash = "#overview";
    await loadBootstrap();
  } catch (error) {
    showFormError(form, summary, error.message, "setup-address");
  }
});

document.querySelector("#sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const summary = document.querySelector("#sign-in-summary");
  clearFormErrors(form, summary);
  const codeStep = document.querySelector("#sign-in-code-step");
  try {
    if (!codeStep.hidden) {
      await requestJson("/api/session/one-time-password", {
        method: "POST",
        body: JSON.stringify({ code: document.querySelector("#sign-in-code").value })
      });
      resetSignInStep();
      await loadBootstrap();
      return;
    }
    const payload = await requestJson("/api/session", {
      method: "POST",
      body: JSON.stringify({
        address: document.querySelector("#sign-in-address").value,
        password: document.querySelector("#sign-in-password").value
      })
    });
    if (payload.oneTimePasswordRequired) {
      document.querySelector("#sign-in-password-step").hidden = true;
      codeStep.hidden = false;
      document.querySelector("#sign-in-back").hidden = false;
      document.querySelector("#sign-in-code").required = true;
      document.querySelector("#sign-in-address").required = false;
      document.querySelector("#sign-in-password").required = false;
      document.querySelector("#sign-in-code").focus();
      return;
    }
    await loadBootstrap();
  } catch (error) {
    const field = codeStep.hidden ? "sign-in-address" : "sign-in-code";
    showFormError(form, summary, error.message, field);
  }
});

function resetSignInStep() {
  const codeStep = document.querySelector("#sign-in-code-step");
  const passwordStep = document.querySelector("#sign-in-password-step");
  if (!codeStep || !passwordStep) {
    return;
  }
  codeStep.hidden = true;
  passwordStep.hidden = false;
  document.querySelector("#sign-in-back").hidden = true;
  document.querySelector("#sign-in-code").required = false;
  document.querySelector("#sign-in-code").value = "";
  document.querySelector("#sign-in-address").required = true;
  document.querySelector("#sign-in-password").required = true;
}

document.querySelector("#sign-in-back").addEventListener("click", () => {
  resetSignInStep();
  document.querySelector("#sign-in-password").focus();
});

async function renderSettings(saved) {
  const payload = await requestJson("/api/settings");
  const fresh = await requestJson("/api/bootstrap");
  if (state.bootstrap) {
    state.bootstrap.hosting = fresh.hosting;
  }
  const settings = payload.settings;
  const relay = settings.relay;
  const savedNotice = saved ? `<div class="notice"><h2>Settings saved</h2><p>The public name and relay apply now. Web security applies the next time Email Server starts.</p></div>` : "";
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">Configuration</p><h1>Settings</h1></div></header>
    ${savedNotice}
    <form id="settings-form" class="card">
      <div id="settings-summary" class="error-summary" tabindex="-1" hidden></div>
      <h2>Public name</h2>
      <label for="settings-hostname">Hostname</label>
      <input id="settings-hostname" value="${escapeHtml(settings.publicHostname)}" placeholder="mail.example.com">
      <p class="hint">This name is used in the mail greeting and the DNS guide. Leave it empty to use the company domain.</p>
      <label class="choice" for="settings-secure-web"><input id="settings-secure-web" type="checkbox" ${settings.secureWeb ? "checked" : ""}> Serve the web console with the certificate in the storage directory</label>
      <p class="hint">The bind address and the protocol ports stay on the built-in defaults. Web security applies the next time Email Server starts.</p>
      ${fold("Outgoing relay", `<label class="choice" for="settings-relay-enabled"><input id="settings-relay-enabled" type="checkbox" ${relay.enabled ? "checked" : ""}> Send external mail through a relay</label>
      <label for="settings-relay-host">Relay host</label>
      <input id="settings-relay-host" value="${escapeHtml(relay.host)}" placeholder="smtp.example.net">
      <label for="settings-relay-port">Relay port</label>
      <input id="settings-relay-port" type="number" min="1" max="65535" value="${relay.port}">
      <label for="settings-relay-security">Security</label>
      <select id="settings-relay-security">
        <option value="starttls" ${relay.security === "starttls" ? "selected" : ""}>STARTTLS</option>
        <option value="tls" ${relay.security === "tls" ? "selected" : ""}>TLS</option>
        <option value="plain" ${relay.security === "plain" ? "selected" : ""}>Plain, no encryption</option>
      </select>
      <label for="settings-relay-username">Username</label>
      <input id="settings-relay-username" value="${escapeHtml(relay.username)}" autocomplete="off">
      <label for="settings-relay-password">Password</label>
      <input id="settings-relay-password" type="password" autocomplete="new-password" placeholder="${relay.passwordSaved ? "Saved. Enter a new password to replace it." : ""}">
      <p class="hint">Messages stay encrypted in the storage directory. A Docker install should mount that directory from the host. Plain relay security sends the password without TLS.</p>`, relay.enabled)}
      <div class="form-actions"><button class="primary-button" type="submit">Save settings</button></div>
    </form>
    <section class="card stack-card" id="certificate-card">
      <h2>Certificate</h2>
      <div id="certificate-summary" class="error-summary" tabindex="-1" hidden></div>
      <div id="certificate-details"><p class="hint">Loading the current certificate.</p></div>
      <form id="certificate-form">
        <label for="certificate-file">Certificate</label>
        <input id="certificate-file" type="file" accept=".pem,.crt,.cer">
        <label for="private-key-file">Private key</label>
        <input id="private-key-file" type="file" accept=".pem,.key">
        <p class="hint">Upload a PEM certificate and the matching private key. New mail connections use them immediately. The private key stays in the storage directory and is not shown again. Serving the web console with this certificate still applies the next time Email Server starts.</p>
        <div class="form-actions"><button class="primary-button" type="submit">Upload certificate</button></div>
      </form>
    </section>
    ${renderClientSettings(state.bootstrap?.hosting)}`;
  document.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const summary = document.querySelector("#settings-summary");
    summary.className = "error-summary";
    clearFormErrors(form, summary);
    try {
      await requestJson("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          publicHostname: document.querySelector("#settings-hostname").value,
          relay: {
            enabled: document.querySelector("#settings-relay-enabled").checked,
            host: document.querySelector("#settings-relay-host").value,
            port: Number(document.querySelector("#settings-relay-port").value),
            security: document.querySelector("#settings-relay-security").value,
            username: document.querySelector("#settings-relay-username").value,
            password: document.querySelector("#settings-relay-password").value
          },
          secureWeb: document.querySelector("#settings-secure-web").checked
        })
      });
      await renderSettings(true);
    } catch (error) {
      showFormError(form, summary, error.message, "settings-relay-host");
    }
  });
  bindCertificateCard();
  animateView();
}

function presentCertificateDate(value) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function certificateMarkup(certificate) {
  const names = certificate.names && certificate.names.length ? certificate.names.join(", ") : "None listed";
  return `<dl class="record-list">
    <div><dt>Subject</dt><dd>${escapeHtml(certificate.subject)}</dd></div>
    <div><dt>Issuer</dt><dd>${escapeHtml(certificate.issuer)}</dd></div>
    <div><dt>Names</dt><dd>${escapeHtml(names)}</dd></div>
    <div><dt>Valid from</dt><dd>${escapeHtml(presentCertificateDate(certificate.validFrom))}</dd></div>
    <div><dt>Valid until</dt><dd>${escapeHtml(presentCertificateDate(certificate.validUntil))}</dd></div>
    <div><dt>Kind</dt><dd>${certificate.selfSigned ? "Self-signed" : "Issued by a certificate authority"}</dd></div>
  </dl>`;
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("The file could not be read")));
    reader.readAsText(file);
  });
}

function bindCertificateCard() {
  const summary = document.querySelector("#certificate-summary");
  requestJson("/api/certificate")
    .then((payload) => {
      document.querySelector("#certificate-details").innerHTML = certificateMarkup(payload.certificate);
    })
    .catch((error) => {
      summary.hidden = false;
      summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(error.message)}</p>`;
    });
  document.querySelector("#certificate-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    summary.className = "error-summary";
    clearFormErrors(form, summary);
    const certificateFile = document.querySelector("#certificate-file").files[0];
    const privateKeyFile = document.querySelector("#private-key-file").files[0];
    if (!certificateFile || !privateKeyFile) {
      showFormError(form, summary, "Choose both the certificate and the private key.", certificateFile ? "private-key-file" : "certificate-file");
      return;
    }
    try {
      const [certificate, privateKey] = await Promise.all([readTextFile(certificateFile), readTextFile(privateKeyFile)]);
      const payload = await requestJson("/api/certificate", {
        method: "POST",
        body: JSON.stringify({ certificate, privateKey })
      });
      document.querySelector("#certificate-details").innerHTML = certificateMarkup(payload.certificate);
      form.reset();
      summary.className = "notice";
      summary.hidden = false;
      summary.innerHTML = "<h2>Certificate uploaded</h2><p>New mail connections use this certificate. Restart Email Server before the web console can use it.</p>";
    } catch (error) {
      showFormError(form, summary, error.message, "certificate-file");
    }
  });
}

async function renderPassword() {
  const enabled = Boolean(state.bootstrap.account.oneTimePasswordEnabled);
  mainContent.innerHTML = `
    <header class="page-header"><div><p class="eyebrow">${escapeHtml(state.bootstrap.account.address)}</p><h1>Security</h1></div></header>
    <form id="password-form" class="card"><div id="password-summary" class="error-summary" tabindex="-1" hidden></div>
      <h2>Password</h2>
      <input class="visually-hidden" autocomplete="username" value="${escapeHtml(state.bootstrap.account.address)}" readonly tabindex="-1">
      <label for="current-password">Current password</label><input id="current-password" type="password" autocomplete="current-password" required>
      <label for="new-password">New password</label><input id="new-password" type="password" autocomplete="new-password" required minlength="8">
      <p class="hint">This password is also used for SMTP, IMAP, and POP3. Other signed-in sessions for this mailbox are signed out.</p>
      <div class="form-actions"><button class="primary-button" type="submit">Save password</button></div>
    </form>
    <section class="card" id="authenticator-card">
      <h2>Authenticator</h2>
      <div id="authenticator-summary" class="error-summary" tabindex="-1" hidden></div>
      <p class="hint">${enabled ? "An authenticator app is required after the password when you sign in on the web." : "Add an authenticator app for the web console. Mail clients keep using the password."}</p>
      <div id="authenticator-setup"></div>
      ${enabled ? `<details class="fold"><summary>Turn off authenticator</summary><form id="authenticator-remove" class="fold-body">
        <input class="visually-hidden" autocomplete="username" value="${escapeHtml(state.bootstrap.account.address)}" readonly tabindex="-1">
        <label for="authenticator-password">Current password</label><input id="authenticator-password" type="password" autocomplete="current-password" required>
        <label for="authenticator-remove-code">Authenticator code</label><input id="authenticator-remove-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
        <div class="form-actions"><button class="danger-button" type="submit">Turn off</button></div>
      </form></details>` : `<div class="form-actions"><button id="authenticator-start" class="primary-button" type="button">Set up authenticator</button></div>`}
    </section>`;
  document.querySelector("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const summary = document.querySelector("#password-summary");
    summary.className = "error-summary";
    clearFormErrors(form, summary);
    try {
      const payload = await requestJson("/api/account/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: document.querySelector("#current-password").value,
          password: document.querySelector("#new-password").value
        })
      });
      state.bootstrap.account = payload.account;
      summary.className = "notice";
      summary.hidden = false;
      summary.innerHTML = "<h2>Password saved</h2><p>Use the new password the next time you sign in.</p>";
      form.reset();
    } catch (error) {
      showFormError(form, summary, error.message, "current-password");
    }
  });
  bindAuthenticator();
  animateView();
}

function bindAuthenticator() {
  const start = document.querySelector("#authenticator-start");
  if (start) {
    start.addEventListener("click", async () => {
      const summary = document.querySelector("#authenticator-summary");
      summary.className = "error-summary";
      summary.hidden = true;
      try {
        const payload = await requestJson("/api/account/one-time-password", { method: "POST", body: "{}" });
        const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(payload.image)}`;
        document.querySelector("#authenticator-setup").innerHTML = `
          <div class="authenticator-frame"><img class="authenticator-image" alt="Authenticator setup code" src="${image}"></div>
          <p class="hint">Scan this code, or enter the key manually. Spaces are only there to make the key easier to read.</p>
          <p class="secret-code">${escapeHtml(payload.secret.replace(/(.{4})/g, "$1 ").trim())}</p>
          <form id="authenticator-confirm">
            <label for="authenticator-code">Code from the app</label>
            <input id="authenticator-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
            <div class="form-actions"><button class="primary-button" type="submit">Confirm authenticator</button></div>
          </form>`;
        start.hidden = true;
        document.querySelector("#authenticator-confirm").addEventListener("submit", async (event) => {
          event.preventDefault();
          try {
            const confirmed = await requestJson("/api/account/one-time-password/confirm", {
              method: "POST",
              body: JSON.stringify({ code: document.querySelector("#authenticator-code").value })
            });
            state.bootstrap.account = confirmed.account;
            await renderPassword();
            const notice = document.querySelector("#authenticator-summary");
            notice.className = "notice";
            notice.hidden = false;
            notice.innerHTML = "<h2>Authenticator is on</h2><p>The next web sign-in asks for a code after the password.</p>";
          } catch (error) {
            showFormError(document.querySelector("#authenticator-confirm"), summary, error.message, "authenticator-code");
          }
        });
      } catch (error) {
        summary.hidden = false;
        summary.innerHTML = `<h2>There is a problem</h2><p>${escapeHtml(error.message)}</p>`;
      }
    });
  }
  const remove = document.querySelector("#authenticator-remove");
  if (remove) {
    remove.addEventListener("submit", async (event) => {
      event.preventDefault();
      const summary = document.querySelector("#authenticator-summary");
      summary.className = "error-summary";
      try {
        const payload = await requestJson("/api/account/one-time-password/remove", {
          method: "POST",
          body: JSON.stringify({
            password: document.querySelector("#authenticator-password").value,
            code: document.querySelector("#authenticator-remove-code").value
          })
        });
        state.bootstrap.account = payload.account;
        await renderPassword();
      } catch (error) {
        showFormError(remove, summary, error.message, "authenticator-password");
      }
    });
  }
}

document.querySelector("#password-button").addEventListener("click", () => {
  location.hash = "#account";
});

document.querySelector("#sign-out-button").addEventListener("click", async () => {
  if (state.bootstrap) {
    state.bootstrap.account = null;
  }
  state.folderName = "inbox";
  state.messageIdentifier = "";
  state.compose = null;
  state.composeAttachments = [];
  state.userQuery = "";
  state.userStatus = "";
  location.hash = "";
  await requestJson("/api/session", { method: "DELETE" });
  await loadBootstrap();
});

window.addEventListener("hashchange", () => {
  renderRoute().catch((error) => {
    mainContent.innerHTML = `<div class="empty"><h2>Something went wrong</h2><p>${escapeHtml(error.message)}</p></div>`;
  });
});

loadBootstrap().catch((error) => {
  document.body.insertAdjacentHTML("beforeend", `<p class="error-summary">${escapeHtml(error.message)}</p>`);
});
