import { useEffect, useState } from "react";

/**
 * An object URL for `blob`, or null without one. It is revoked when the blob
 * changes and when the component goes, so a form that previews a chosen file
 * leaves nothing behind.
 */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const made = blob === null ? null : URL.createObjectURL(blob);
    setUrl(made);
    return () => {
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [blob]);
  return url;
}
