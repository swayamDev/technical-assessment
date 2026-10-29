"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/utils";

type Action = "approve" | "reject" | "void";

const COPY: Record<
  Action,
  { title: string; description: string; confirm: string; done: string }
> = {
  approve: {
    title: "Approve this payment?",
    description:
      "It will be allocated to the lease's unpaid invoices straight away.",
    confirm: "Approve",
    done: "Payment approved",
  },
  reject: {
    title: "Reject this payment?",
    description:
      "The payment stays on record as rejected. Give a reason the team can see.",
    confirm: "Reject payment",
    done: "Payment rejected",
  },
  void: {
    title: "Void this payment?",
    description:
      "Its allocations are removed, so the invoices it paid become unpaid again. Other payments are not changed. This cannot be undone.",
    confirm: "Void payment",
    done: "Payment voided",
  },
};

/** Manager actions for one payment, each with a confirmation step. The server re-checks everything. */
export function PaymentActions({
  paymentId,
  status,
  amountLabel,
}: {
  paymentId: string;
  status: string;
  amountLabel: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const available: Action[] =
    status === "pending_verification"
      ? ["approve", "reject"]
      : status === "approved"
        ? ["void"]
        : [];
  if (available.length === 0) return null;

  const needsReason = action === "reject" || action === "void";

  async function submit() {
    if (!action) return;
    if (needsReason && [...reason.trim()].length < 5) {
      setError("Enter a reason of at least 5 characters");
      toast.error("A reason of at least 5 characters is required");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/payments/${paymentId}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(needsReason ? { reason: reason.trim() } : {}),
      });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response));
        return;
      }
      toast.success(COPY[action].done);
      setAction(null);
      router.refresh();
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        {available.map((a) => (
          <Button
            key={a}
            size="xs"
            variant={
              a === "approve"
                ? "default"
                : a === "void"
                  ? "destructive"
                  : "outline"
            }
            onClick={() => {
              setAction(a);
              setReason("");
              setError(null);
            }}
          >
            {COPY[a].confirm.split(" ")[0]}
          </Button>
        ))}
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(next) => !pending && !next && setAction(null)}
      >
        <DialogContent>
          {action && (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>{COPY[action].title}</DialogTitle>
                <DialogDescription>
                  {amountLabel}. {COPY[action].description}
                </DialogDescription>
              </DialogHeader>
              {needsReason && (
                <div className="grid gap-2">
                  <Label htmlFor={`reason-${paymentId}`}>Reason</Label>
                  <Textarea
                    id={`reason-${paymentId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="At least 5 characters"
                    aria-invalid={Boolean(error)}
                  />
                  {error && <p className="text-destructive text-xs">{error}</p>}
                </div>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setAction(null)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  variant={action === "approve" ? "default" : "destructive"}
                  onClick={submit}
                  disabled={pending}
                >
                  {pending ? "Working…" : COPY[action].confirm}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
