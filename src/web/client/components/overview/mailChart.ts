import type { ActivityDay } from "../../interfaces/models.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ChartCounts {
  incoming: number;
  outgoing: number;
}

let mailChartObserver: ResizeObserver | null = null;
let mailChartObservedElement: Element | null = null;
let mailChartDismissPointer: ((event: PointerEvent) => void) | null = null;

function mailChartSeries(day: ActivityDay): ChartCounts {
  const incoming = Number.isFinite(day.incoming) ? day.incoming || 0 : Number(day.delivered) || 0;
  const outgoing = Number.isFinite(day.outgoing) ? day.outgoing || 0 : Number(day.sent) || 0;
  return {
    incoming: Math.max(0, incoming),
    outgoing: Math.max(0, outgoing)
  };
}

function formatMailChartDate(value: string): string {
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

function mailChartAxis(peak: number): { maximum: number; values: number[] } {
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

function mailChartLabelIndexes(dayCount: number, plotWidth: number): Set<number> {
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

function mailChartPoint(index: number, count: number, dayCount: number, bounds: ChartBounds, scaleMaximum: number): ChartPoint {
  const span = Math.max(dayCount - 1, 1);
  const x = dayCount === 1 ? bounds.left + bounds.width / 2 : bounds.left + (index / span) * bounds.width;
  const y = bounds.top + bounds.height - (count / scaleMaximum) * bounds.height;
  return { x, y };
}

function mailChartAreaPath(points: ChartPoint[], baseline: number): string {
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

function mailChartMarkup(days: ActivityDay[], width: number): string {
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
  const pointMarkup = (points: ChartPoint[], className: string) =>
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

function updateMailChartHover(chart: HTMLElement, days: ActivityDay[], index: number): void {
  const day = days[index];
  if (!day) {
    return;
  }
  const counts = mailChartSeries(day);
  const tooltip = chart.querySelector<HTMLElement>(".mail-chart-tooltip");
  if (!tooltip) {
    return;
  }
  tooltip.hidden = false;
  tooltip.innerHTML = `<p class="mail-chart-tooltip-date">${escapeHtml(formatMailChartDate(day.date))}</p>
    <p class="mail-chart-tooltip-row"><i></i><span>Incoming</span><strong>${counts.incoming.toLocaleString()}</strong></p>
    <p class="mail-chart-tooltip-row"><i class="outgoing"></i><span>Outgoing</span><strong>${counts.outgoing.toLocaleString()}</strong></p>`;
  chart.querySelectorAll<SVGCircleElement>(".mail-chart-point").forEach((point) => {
    const active = point.dataset.index === String(index);
    point.setAttribute("r", active ? "5" : "3.25");
    point.classList.toggle("is-active", active);
  });
  const cursor = chart.querySelector(".mail-chart-cursor");
  const activePoint = chart.querySelector(`.mail-chart-point[data-index="${index}"]`);
  if (cursor && activePoint) {
    cursor.setAttribute("x1", activePoint.getAttribute("cx") || "0");
    cursor.setAttribute("x2", activePoint.getAttribute("cx") || "0");
    cursor.removeAttribute("hidden");
  }
}

function clearMailChartHover(chart: HTMLElement | null): void {
  if (!chart?.isConnected) {
    return;
  }
  const tooltip = chart.querySelector<HTMLElement>(".mail-chart-tooltip");
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

function placeMailChartTooltip(chart: HTMLElement): void {
  const tooltip = chart.querySelector<HTMLElement>(".mail-chart-tooltip");
  const plot = chart.querySelector<HTMLElement>(".mail-chart-plot");
  const svg = chart.querySelector<SVGSVGElement>(".mail-chart-svg");
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

function mailChartIndexFromPointer(chart: HTMLElement, pointerEvent: PointerEvent): number {
  const svg = chart.querySelector<SVGSVGElement>(".mail-chart-svg");
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

function bindMailChartInteractions(chart: HTMLElement, days: ActivityDay[]): void {
  const plot = chart.querySelector<HTMLElement>(".mail-chart-plot");
  if (!plot) {
    return;
  }
  let activeIndex = -1;
  const showDay = (index: number) => {
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
    showDay(index);
  });
  if (mailChartDismissPointer) {
    document.removeEventListener("pointerdown", mailChartDismissPointer);
  }
  mailChartDismissPointer = (event) => {
    if (!chart.isConnected || !chart.contains(event.target as Node)) {
      clearMailChartHover(chart);
    }
  };
  document.addEventListener("pointerdown", mailChartDismissPointer);
}

export function drawMailChart(days: ActivityDay[]): void {
  const chart = document.querySelector<HTMLElement>("#mail-chart");
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
