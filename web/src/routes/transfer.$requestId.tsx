import { createFileRoute } from "@tanstack/react-router";
import { TransferConsent } from "../imports/transfer-consent.tsx";

// Where an exporter sends a person to allow a direct transfer (decision 0129).
export const Route = createFileRoute("/transfer/$requestId")({ component: TransferPage });

function TransferPage() {
  const { requestId } = Route.useParams();
  return <TransferConsent key={requestId} requestId={requestId} />;
}
