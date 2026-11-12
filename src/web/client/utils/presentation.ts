export function presentName(name: unknown): string {
  const trimmed = String(name || "").trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.endsWith('"') && !trimmed.slice(0, -1).includes('"')) {
    return trimmed.slice(0, -1).trim();
  }
  return trimmed;
}

export function previewDocument(body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;}img{max-width:100%;height:auto;}</style></head><body>${body}</body></html>`;
}

export function bindMessageFrame(frame: HTMLIFrameElement): void {
  const resize = () => {
    const frameDocument = frame.contentDocument;
    if (!frameDocument) {
      return;
    }
    frame.style.height = "0px";
    const documentHeight = frameDocument.documentElement.scrollHeight;
    frame.style.height = `${documentHeight}px`;
    const fittedHeight = frameDocument.documentElement.scrollHeight;
    if (fittedHeight !== documentHeight) {
      frame.style.height = `${fittedHeight}px`;
    }
  };
  frame.addEventListener("load", () => {
    resize();
    frame.contentDocument?.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", resize);
    });
  });
  if (frame.contentDocument?.readyState === "complete") {
    resize();
  }
}

export function fold(title: string, body: string, open = false, foldId = ""): string {
  const identity = foldId ? ` id="${foldId}"` : "";
  return `<details class="fold"${identity}${open ? " open" : ""}><summary>${title}</summary><div class="fold-body">${body}</div></details>`;
}
