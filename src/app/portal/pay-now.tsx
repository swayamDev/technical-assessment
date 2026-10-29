"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatSen } from "@/lib/money";
import { apiErrorMessage } from "@/lib/utils";

/**
 * Creates a gateway bill for the amount due now. In production the tenant would be redirected
 * to the gateway; here we show the bill so the gateway simulator can pay it. Only the webhook
 * settles the bill.
 */
export function PayNow({
  leaseId,
  dueNowSen,
}: {
  leaseId: string;
  dueNowSen: number;
}) {
  const [bill, setBill] = useState<{
    billId: string;
    amountSen: number;
  } | null>(null);
  const [pending, setPending] = useState(false);

  async function payNow() {
    setPending(true);
    try {
      const response = await fetch(`/api/leases/${leaseId}/gateway-bills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response));
        return;
      }
      setBill((await response.json()) as { billId: string; amountSen: number });
      toast.success("Bill created");
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={payNow} disabled={pending || dueNowSen <= 0}>
        {pending ? "Creating bill…" : dueNowSen > 0 ? "Pay now" : "Nothing due"}
      </Button>
      <Dialog
        open={bill !== null}
        onOpenChange={(open) => !open && setBill(null)}
      >
        <DialogContent>
          {bill && (
            <div className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Gateway bill created</DialogTitle>
                <DialogDescription>
                  You would now be sent to the payment gateway. Your payment is
                  recorded only when the gateway confirms it.
                </DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Bill id</dt>
                <dd className="font-mono text-xs break-all select-all">
                  {bill.billId}
                </dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tabular-nums">
                  {formatSen(bill.amountSen)}{" "}
                  <span className="text-muted-foreground text-xs">
                    ({bill.amountSen} sen)
                  </span>
                </dd>
              </dl>
              <pre className="bg-muted overflow-x-auto p-2 text-[11px]">
                node gateway-sim.mjs {bill.billId} {bill.amountSen} true
              </pre>
              <DialogFooter>
                <Link
                  href={`/payments/return?bill_id=${encodeURIComponent(bill.billId)}&paid=true`}
                  className={buttonVariants({ variant: "default" })}
                >
                  Check payment status
                </Link>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
