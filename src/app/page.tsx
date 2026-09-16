import { redirect } from "next/navigation";

import { DashboardApp } from "@/components/dashboard/dashboard-app";
import { getCurrentSession } from "@/lib/auth/server";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  return <DashboardApp isAdmin={session.role === "admin"} />;
}
