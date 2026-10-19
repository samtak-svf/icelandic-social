import { createContext, use, useCallback, useEffect, useState, type ReactNode } from "react";
import { getMe, type Me } from "./generated/api.ts";
import { refused, type Problem } from "./problem.ts";

// Who is signed in, as the API says (GET /v1/me). The cookie is HttpOnly, so
// the page cannot see it: it asks, and a 401 is "signed out". The answer is
// asked for in the browser, never while rendering on the server, which holds
// no cookie of its own to send (decision 0062).

export type AccountState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; me: Me }
  /** The API refused this build (decision 0030): only a reload helps. */
  | { status: "outdated" }
  | { status: "failed"; problem: Problem };

interface AccountValue {
  state: AccountState;
  /** Ask again, after a change or to retry. */
  refresh: () => Promise<void>;
  /** The session ended here: show the sign-in page without asking. */
  signedOut: () => void;
}

const AccountContext = createContext<AccountValue | null>(null);

async function ask(): Promise<AccountState> {
  try {
    const answer = await getMe();
    if (answer.status === 200) return { status: "signed-in", me: answer.data };
    if (answer.status === 401) return { status: "signed-out" };
    if (answer.status === 426) return { status: "outdated" };
    // A status the contract does not declare, such as a 5xx.
    const other: { data: unknown } = answer;
    return { status: "failed", problem: refused(other.data) };
  } catch {
    return { status: "failed", problem: { kind: "unreachable" } };
  }
}

export function AccountProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<AccountState>({ status: "loading" });
  const refresh = useCallback(async () => setState(await ask()), []);
  const signedOut = useCallback(() => setState({ status: "signed-out" }), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return <AccountContext value={{ state, refresh, signedOut }}>{children}</AccountContext>;
}

export function useAccount(): AccountValue {
  const value = use(AccountContext);
  if (!value) throw new Error("useAccount outside AccountProvider");
  return value;
}
