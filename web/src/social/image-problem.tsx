import { strings } from "../generated/brand/strings.ts";
import { ProblemText, Status } from "../ui/kit.tsx";
import type { SendProblem } from "./frame-send.ts";

const REFUSED = {
  too_large: strings.post_image_too_large,
  invalid_image: strings.post_image_failed,
  no_master: strings.image_frames_no_master,
} as const;

/** What went wrong with an image, as a sentence. */
export function ImageProblem({ problem }: Readonly<{ problem: SendProblem | null }>) {
  return (
    <Status>
      {typeof problem === "string"
        ? REFUSED[problem]
        : problem !== null && <ProblemText problem={problem} />}
    </Status>
  );
}
