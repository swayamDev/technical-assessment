"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

// Same rule as the tenants.phone check constraint.
const PHONE_RE = /^\+?[0-9][0-9 -]{5,19}$/;

/** Updates the tenant's phone directly through the Data API (RLS + column grant allow only this). */
export function PhoneForm({
  tenantId,
  phone,
  onSaved,
}: {
  tenantId: string;
  phone: string | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed && !PHONE_RE.test(trimmed)) {
      setError("Use digits, spaces or dashes, e.g. +60 12-345 6789");
      toast.error("That phone number does not look right");
      return;
    }
    setError(null);
    setPending(true);
    const { data, error: updateError } = await createClient()
      .from("tenants")
      .update({ phone: trimmed || null })
      .eq("id", tenantId)
      .select("phone");
    setPending(false);
    if (updateError || !data || data.length === 0) {
      toast.error(updateError?.message ?? "Could not update your phone number");
      return;
    }
    toast.success("Phone number updated");
    onSaved();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2"
      noValidate
    >
      <div className="grid gap-2">
        <Label htmlFor="phone">Phone number</Label>
        <Input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="+60 12-345 6789"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={Boolean(error)}
          className="w-56"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={pending || value.trim() === (phone ?? "")}
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      {error && <p className="text-destructive basis-full text-xs">{error}</p>}
    </form>
  );
}
