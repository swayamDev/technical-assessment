"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseRinggitToSen } from "@/lib/billing";
import { malaysiaLocalToIso, toMalaysiaLocalInput } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import { createClient } from "@/lib/supabase/client";
import { PAYMENT_SLIPS_BUCKET } from "@/lib/supabase/env";
import { apiErrorMessage } from "@/lib/utils";

type Method = "cash" | "bank_transfer";

const METHODS: { value: Method; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank transfer" },
];

const SLIP_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};
const MAX_SLIP_BYTES = 5 * 1024 * 1024;

export function RecordPaymentDialog({
  leaseId,
  orgId,
  capSen,
  isManager,
}: {
  leaseId: string;
  orgId: string;
  capSen: number;
  isManager: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [receivedLocal, setReceivedLocal] = useState("");
  const [slip, setSlip] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  function openDialog() {
    setAmount("");
    setMethod("cash");
    setReceivedLocal(toMalaysiaLocalInput(new Date()));
    setSlip(null);
    setErrors({});
    setOpen(true);
  }

  function validate(): { amountSen: number; receivedAt: string } | null {
    const next: Record<string, string> = {};
    let amountSen = 0;
    try {
      amountSen = parseRinggitToSen(amount);
      if (amountSen <= 0) next.amount = "Enter an amount greater than zero";
      else if (amountSen > capSen)
        next.amount = `At most ${formatSen(capSen)} can be recorded on this lease`;
    } catch {
      next.amount = "Enter an amount like 1,500.50";
    }
    const receivedAt = receivedLocal ? malaysiaLocalToIso(receivedLocal) : null;
    if (!receivedAt)
      next.receivedAt = "Enter the date and time the money was received";
    if (method === "bank_transfer") {
      if (!slip) next.slip = "Attach the bank transfer slip";
      else if (!SLIP_TYPES[slip.type])
        next.slip = "The slip must be a JPEG, PNG or PDF file";
      else if (slip.size > MAX_SLIP_BYTES)
        next.slip = "The slip must be 5 MB or smaller";
    }
    setErrors(next);
    return Object.keys(next).length === 0 && receivedAt
      ? { amountSen, receivedAt }
      : null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const valid = validate();
    if (!valid) {
      toast.error("Please fix the highlighted fields");
      return;
    }
    setPending(true);
    try {
      let slipPath: string | undefined;
      if (method === "bank_transfer" && slip) {
        slipPath = `${orgId}/${crypto.randomUUID()}.${SLIP_TYPES[slip.type]}`;
        const { error } = await createClient()
          .storage.from(PAYMENT_SLIPS_BUCKET)
          .upload(slipPath, slip, { contentType: slip.type });
        if (error) {
          toast.error(`Slip upload failed: ${error.message}`);
          return;
        }
      }
      // If this request fails, the server removes the uploaded slip.
      const response = await fetch(`/api/leases/${leaseId}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountSen: valid.amountSen,
          method,
          receivedAt: valid.receivedAt,
          slipPath,
        }),
      });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response));
        return;
      }
      toast.success(
        isManager
          ? "Payment recorded and approved"
          : "Payment recorded, waiting for a manager's approval",
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        onClick={openDialog}
        disabled={capSen <= 0}
        title={capSen <= 0 ? "Nothing left to pay on this lease" : undefined}
      >
        Record payment
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Record a payment</DialogTitle>
              <DialogDescription>
                {isManager
                  ? "Payments you record are approved immediately."
                  : "A manager must approve this payment."}{" "}
                Up to {formatSen(capSen)}.
              </DialogDescription>
            </DialogHeader>

            <Field id="amount" label="Amount (RM)" error={errors.amount}>
              <Input
                id="amount"
                inputMode="decimal"
                placeholder="1,500.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(errors.amount)}
              />
            </Field>

            <Field id="method" label="Method">
              <Select
                items={METHODS}
                value={method}
                onValueChange={(value) => {
                  if (value === "cash" || value === "bank_transfer")
                    setMethod(value);
                }}
              >
                <SelectTrigger id="method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              id="receivedAt"
              label="Received (Malaysia time)"
              error={errors.receivedAt}
            >
              <Input
                id="receivedAt"
                type="datetime-local"
                value={receivedLocal}
                onChange={(e) => setReceivedLocal(e.target.value)}
                aria-invalid={Boolean(errors.receivedAt)}
              />
            </Field>

            {method === "bank_transfer" && (
              <Field
                id="slip"
                label="Bank transfer slip (JPEG, PNG or PDF, max 5 MB)"
                error={errors.slip}
              >
                <Input
                  id="slip"
                  type="file"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(e) => setSlip(e.target.files?.[0] ?? null)}
                  aria-invalid={Boolean(errors.slip)}
                />
              </Field>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Record payment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
