export function element<T extends Element>(selector: string, parent: ParentNode = document): T {
  const found = parent.querySelector<T>(selector);
  if (!found) {
    throw new Error(`Missing element ${selector}`);
  }
  return found;
}

export function optionalElement<T extends Element>(selector: string, parent: ParentNode = document): T | null {
  return parent.querySelector<T>(selector);
}
