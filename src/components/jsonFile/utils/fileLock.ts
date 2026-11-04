const tails = new Map<string, Promise<void>>();

export function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const previous = tails.get(name) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  tails.set(
    name,
    current.then(
      () => undefined,
      () => undefined
    )
  );
  return current;
}
