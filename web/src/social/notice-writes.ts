// The notification writes in flight (decision 0104). The invariant: a
// notifications read started after a notification write shows that write.
// Every write is tracked here, and a read waits for the ones in flight when it
// starts. Pure, so the list, the bell and the settings share it without an
// import cycle.

const inFlight = new Set<Promise<unknown>>();

/** Records a write until it settles, either way, and returns it unchanged. */
export function track<T>(write: Promise<T>): Promise<T> {
  inFlight.add(write);
  const done = () => void inFlight.delete(write);
  write.then(done, done);
  return write;
}

/** Resolves when the writes in flight now have settled; a rejection never blocks. */
export async function settled(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}
