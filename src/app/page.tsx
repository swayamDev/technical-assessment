import { redirect } from "next/navigation";
import { getSessionActor } from "@/lib/auth";

export default async function Home() {
  const actor = await getSessionActor();
  if (actor?.kind === "member") redirect("/dashboard");
  if (actor?.kind === "tenant") redirect("/portal");
  redirect("/login");
}
