import { useEffect, useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import { useAccount } from "../account.tsx";
import { ChatFailure, type LinkOffer } from "./protocol.ts";
import { Button, Status } from "../ui/kit.tsx";
import { useChat } from "./chat.tsx";
import { qrFrame, qrRects } from "./qr.ts";

// Linking this browser to the account's phone (decisions 0064, 0081): the
// browser shows a code and its QR, the phone approves, and this page then
// completes the link. The chat session then takes the older messages the
// phone sends, asking until they come (0108).

type Failed = "no-phone" | "unreachable" | "other";

type Step =
  | { step: "idle" }
  | { step: "working" }
  | { step: "offer"; offer: LinkOffer }
  | { step: "failed"; why: Failed };

const POLL_MS = 2_000;

const failureCode = (error: unknown) => (error instanceof ChatFailure ? error.code : undefined);

/** Why beginning a link failed, as the person can act on it; undefined when the session is gone. */
export function whyBeginFailed(error: unknown): Failed | undefined {
  if (!(error instanceof ChatFailure)) return "other";
  if (error.code === "unreachable") return "unreachable";
  if (error.code !== "refused") return "other";
  if (error.message === "unauthorized") return undefined;
  return error.message === "no_phone_device" ? "no-phone" : "other";
}

const FAILED: Record<Failed, string> = {
  "no-phone": strings.device_link_web_no_phone,
  unreachable: strings.error_unreachable,
  other: strings.error_generic,
};

/** Whether a failed check ends the wait: only the code's own end does, never a call that failed on the way. */
export function pollEnds(
  error: unknown,
  offer: Pick<LinkOffer, "expiresAt">,
  now: number,
): boolean {
  return failureCode(error) === "link-expired" || offer.expiresAt <= now;
}

export function LinkPage() {
  const { call, restart } = useChat();
  const { signedOut } = useAccount();
  const [state, setState] = useState<Step>({ step: "idle" });

  // A link begun before a reload goes on (0096): the worker still has its code.
  useEffect(() => {
    if (call === undefined) return undefined;
    let live = true;
    void call("pendingLink")
      .then((offer) => {
        if (live && offer !== null) {
          setState((now) => (now.step === "idle" ? { step: "offer", offer } : now));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [call]);

  async function begin() {
    if (call === undefined) return;
    setState({ step: "working" });
    try {
      setState({ step: "offer", offer: await call("beginLink") });
    } catch (error) {
      const why = whyBeginFailed(error);
      if (why === undefined) signedOut();
      else setState({ step: "failed", why });
    }
  }

  const offer = state.step === "offer" ? state.offer : undefined;
  useEffect(() => {
    if (offer === undefined || call === undefined) return undefined;
    let live = true;
    // One check at a time: a page that comes back from the background fires
    // the timer and the visibility change together, and the worker answers in order.
    let busy = false;

    async function finish() {
      await call!("completeLink");
      restart();
    }

    async function check() {
      if (!live || busy) return;
      busy = true;
      try {
        const linkState = await call!("linkState");
        if (!live || linkState === "pending") return;
        if (linkState === "expired") {
          setState({ step: "idle" });
          return;
        }
        await finish();
      } catch (error) {
        // A call that fails while the page wakes, or the network comes back,
        // is asked again on the next tick; only the code's own end stops it.
        if (!live) return;
        if (pollEnds(error, offer!, Date.now())) setState({ step: "idle" });
      } finally {
        busy = false;
      }
    }

    const timer = setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [offer, call, restart]);

  const failed = state.step === "failed" ? state.why : undefined;
  return (
    <>
      <h1 className="font-headline text-3xl">{strings.device_link_web_title}</h1>
      {failed !== "no-phone" && (
        <p className="mt-4 text-muted-fg">{strings.device_link_web_no_phone}</p>
      )}
      {failed !== undefined && (
        <p role="alert" className="mt-4">
          {FAILED[failed]}
        </p>
      )}
      {(state.step === "idle" || state.step === "failed") && (
        <Button tone="primary" className="mt-4" onClick={() => void begin()}>
          {strings.device_link_web_start}
        </Button>
      )}
      {state.step === "offer" && <Offer offer={state.offer} />}
      <Status>{state.step === "offer" && strings.device_link_web_waiting}</Status>
    </>
  );
}

function Offer({ offer }: Readonly<{ offer: LinkOffer }>) {
  const { origin, side } = qrFrame(offer.qr);
  return (
    <div className="mt-4 flex flex-col items-start gap-4">
      <p className="text-sm text-muted-fg">{strings.device_link_web_hint}</p>
      <svg
        role="img"
        aria-label={offer.code}
        viewBox={`${origin} ${origin} ${side} ${side}`}
        shapeRendering="crispEdges"
        className="size-64 rounded-md"
      >
        <rect x={origin} y={origin} width={side} height={side} fill="white" />
        {qrRects(offer.qr).map(({ x, y }) => (
          <rect key={`${x}:${y}`} x={x} y={y} width="1" height="1" fill="black" />
        ))}
      </svg>
      <code className="break-all rounded-md bg-muted px-3 py-2">{offer.code}</code>
      <Button onClick={() => void navigator.clipboard.writeText(offer.code)}>
        {strings.device_link_web_copy}
      </Button>
    </div>
  );
}
