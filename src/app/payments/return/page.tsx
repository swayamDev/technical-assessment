import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatMalaysiaDateTime } from "@/lib/dates";
import { formatSen } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payment status · Rent Collection" };

/**
 * Where the gateway sends the tenant back. It only shows the bill's real status from the
 * database (read under RLS with the viewer's session) and changes nothing. The `paid`
 * query parameter is ignored: only the webhook settles a bill.
 */
export default async function PaymentReturnPage({
  searchParams,
}: PageProps<"/payments/return">) {
  const params = await searchParams;
  const billId = typeof params.bill_id === "string" ? params.bill_id : "";

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: bill } =
    auth.user && billId
      ? await supabase
          .from("gateway_bills")
          .select("id, amount_sen, status, paid_at")
          .eq("id", billId)
          .maybeSingle()
      : { data: null };

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-heading text-lg">Payment status</CardTitle>
          <CardDescription>
            The status confirmed by the payment gateway.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          {!auth.user ? (
            <p>Sign in to see the status of your payment.</p>
          ) : !bill ? (
            <p>We could not find that bill.</p>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Bill</dt>
                <dd className="font-mono text-xs break-all">{bill.id}</dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="tabular-nums">
                  {formatSen(Number(bill.amount_sen))}
                </dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={bill.status} />
                </dd>
                {bill.paid_at && (
                  <>
                    <dt className="text-muted-foreground">Paid at</dt>
                    <dd>{formatMalaysiaDateTime(bill.paid_at)}</dd>
                  </>
                )}
              </dl>
              {bill.status === "pending" && (
                <p className="text-muted-foreground">
                  We are still waiting for the gateway to confirm this payment.
                  Refresh this page in a moment.
                </p>
              )}
            </>
          )}
          <Link
            href={auth.user ? "/" : "/login"}
            className={buttonVariants({ variant: "outline" })}
          >
            {auth.user ? "Back to my lease" : "Sign in"}
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
