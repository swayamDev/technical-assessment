"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_SLIPS_BUCKET } from "@/lib/supabase/env";

/** Opens the slip through a short-lived signed URL created with the viewer's own session. */
export function SlipLink({ path }: { path: string }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="text-primary hover:underline disabled:opacity-50"
      disabled={pending}
      onClick={async () => {
        // Open the tab synchronously so pop-up blockers allow it, then point it at the URL.
        const tab = window.open("", "_blank");
        setPending(true);
        const { data, error } = await createClient()
          .storage.from(PAYMENT_SLIPS_BUCKET)
          .createSignedUrl(path, 60);
        setPending(false);
        if (error || !data) {
          tab?.close();
          toast.error("Could not open the slip");
          return;
        }
        if (tab) tab.location.href = data.signedUrl;
        else window.location.href = data.signedUrl;
      }}
    >
      {pending ? "Opening…" : "View slip"}
    </button>
  );
}
