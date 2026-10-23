import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "../account.tsx";
import type { Problem } from "../problem.ts";
import type { Outcome } from "./outcome.ts";

// A list read a page at a time by cursor (`next` of one page is `before` of
// the next). The first page loads on mount and on `reload`; the next one when
// the sentinel returned by the hook scrolls into view.

export type Page<T> = { posts: T[]; next: string | null };

export type Accumulated<T> = { items: T[]; next: string | null };

/** The pages so far with `page` added after them; an item already held is kept once. */
export function append<T>(
  held: Accumulated<T>,
  page: { items: T[]; next: string | null },
  key: (item: T) => string,
): Accumulated<T> {
  const seen = new Set(held.items.map(key));
  return {
    items: [...held.items, ...page.items.filter((item) => !seen.has(key(item)))],
    next: page.next,
  };
}

export type Paged<T> = {
  /** Null until the first page has answered. */
  items: T[] | null;
  /** What went wrong with the first page or the latest one. */
  problem: Problem | null;
  hasMore: boolean;
  /** Ref callback for an element after the last item. */
  sentinel: (node: Element | null) => void;
  reload: () => void;
};

export function usePaged<T>(
  fetchPage: (before: string | undefined) => Promise<Outcome<Page<T>>>,
  key: (item: T) => string,
): Paged<T> {
  const { refresh } = useAccount();
  const [held, setHeld] = useState<Accumulated<T> | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [round, setRound] = useState(0);
  const [node, setNode] = useState<Element | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const keyRef = useRef(key);
  keyRef.current = key;

  const read = useCallback(
    async (before: string | undefined, mine: number) => {
      setLoading(true);
      const result = await fetchPage(before);
      if (mine !== generation.current) return;
      setLoading(false);
      if (!result.ok) {
        if (result.status === 401) void refresh();
        setProblem(result.problem);
        return;
      }
      setProblem(null);
      const page = { items: result.data.posts, next: result.data.next };
      setHeld((now) =>
        before === undefined || now === null ? page : append(now, page, keyRef.current),
      );
    },
    [fetchPage, refresh],
  );

  useEffect(() => {
    generation.current += 1;
    void read(undefined, generation.current);
    return () => {
      generation.current += 1;
    };
  }, [read, round]);

  const next = held?.next ?? null;
  useEffect(() => {
    if (node === null || next === null || loading || problem !== null) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void read(next, generation.current);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, next, loading, problem, read]);

  return {
    items: held?.items ?? null,
    problem,
    hasMore: next !== null,
    sentinel: setNode,
    reload: () => setRound((n) => n + 1),
  };
}
