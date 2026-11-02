import { strings } from "../generated/brand/strings.ts";
import type { Problem } from "../problem.ts";
import { ProblemText, Status } from "../ui/kit.tsx";

// What can go wrong with an image, in the one place every form that takes one
// reads it: the refusals a chosen file meets, and the one a frame call meets
// for an image from before frames were kept (decision 0086).

/** An image's refusals, as their sentence. */
export const REFUSED = {
  too_many: strings.post_images_too_many,
  too_large: strings.post_image_too_large,
  invalid_image: strings.post_image_failed,
  no_master: strings.image_frames_no_master,
} as const;

/** What went wrong with an image, as a sentence: one of its refusals, or a problem the API named. */
export function ImageProblem({
  problem,
  inline = false,
}: Readonly<{ problem: Problem | keyof typeof REFUSED | null; inline?: boolean }>) {
  return (
    <Status inline={inline}>
      {typeof problem === "string"
        ? REFUSED[problem]
        : problem !== null && <ProblemText problem={problem} />}
    </Status>
  );
}
