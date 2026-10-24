import { useEffect, useState } from "react";
import { strings } from "../generated/brand/strings.ts";
import type { LinkOffer } from "./protocol.ts";
import { Button, Status } from "../ui/kit.tsx";
import { useChat } from "./chat.tsx";
import { qrRects } from "./qr.ts";

// Linking this browser to the account's phone (decisions 0064, 0081): the
// browser shows a code and its QR, the phone approves, and this page then
// completes the link and takes the older messages the phone sends.

type Step =
  | { step: "idle" }
  | { step: "working" }
  | { step: "offer"; offer: LinkOffer }
  | { step: "receiving" }
  | { step: "failed" };

export function LinkPage() {
  const { call, restart } = useChat();
  const [state, setState] = useState<Step>({ step: "idle" });

  async function begin() {
    if (call === undefined) return;
    setState({ step: "working" });
    try {
      setState({ step: "offer", offer: await call("beginLink") });
    } catch {
      setState({ step: "failed" });
    }
  }

  const offer = state.step === "offer" ? state.offer : undefined;
  useEffect(() => {
    if (offer === undefined || call === undefined) return undefined;
    let live = true;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const linkState = await call("linkState");
          if (!live || linkState === "pending") return;
          live = false;
          clearInterval(timer);
          if (linkState === "expired") {
            setState({ step: "idle" });
            return;
          }
          const { historyExpected } = await call("completeLink");
          if (historyExpected) {
            setState({ step: "receiving" });
            await call("receiveHistory");
          }
          restart();
        } catch {
          setState({ step: "failed" });
        }
      })();
    }, 2_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [offer, call, restart]);

  return (
    <>
      <h1 className="font-headline text-3xl">{strings.device_link_web_title}</h1>
      <p className="mt-4 text-muted-fg">{strings.device_link_web_no_phone}</p>
      {(state.step === "idle" || state.step === "failed") && (
        <Button tone="primary" className="mt-4" onClick={() => void begin()}>
          {strings.device_link_web_start}
        </Button>
      )}
      {state.step === "offer" && <Offer offer={state.offer} />}
      <Status>
        {state.step === "offer" && strings.device_link_web_waiting}
        {state.step === "receiving" && strings.device_link_web_receiving}
        {state.step === "failed" && strings.try_again}
      </Status>
    </>
  );
}

function Offer({ offer }: Readonly<{ offer: LinkOffer }>) {
  const { size } = offer.qr;
  return (
    <div className="mt-4 flex flex-col items-start gap-4">
      <p className="text-sm text-muted-fg">{strings.device_link_web_hint}</p>
      <svg
        role="img"
        aria-label={offer.code}
        viewBox={`-2 -2 ${size + 4} ${size + 4}`}
        shapeRendering="crispEdges"
        className="size-64 rounded-md bg-white"
      >
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
