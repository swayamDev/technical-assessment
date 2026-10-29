import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  paid: "Paid",
  partially_paid: "Partially paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  pending_verification: "Pending verification",
  approved: "Approved",
  rejected: "Rejected",
  voided: "Voided",
  pending: "Pending",
  failed: "Failed",
};

const STYLES: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  approved:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  partially_paid: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  pending_verification:
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  overdue: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  unpaid: "bg-muted text-muted-foreground",
  rejected: "bg-muted text-muted-foreground line-through",
  voided: "bg-muted text-muted-foreground line-through",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", STYLES[status])}>
      {LABELS[status] ?? status}
    </Badge>
  );
}
