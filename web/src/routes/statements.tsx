import { createFileRoute } from "@tanstack/react-router";
import { Statements } from "../social/statements.tsx";

// What moderators did to the reader's content and why (decision 0115).
export const Route = createFileRoute("/statements")({ component: Statements });
