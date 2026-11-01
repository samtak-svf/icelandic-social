import { createFileRoute } from "@tanstack/react-router";
import { ExportScreen } from "../export/screen.tsx";

// A person takes their own content out as a file (decision 0126).
export const Route = createFileRoute("/export")({ component: ExportScreen });
