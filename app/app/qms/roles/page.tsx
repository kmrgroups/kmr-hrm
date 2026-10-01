import { redirect } from "next/navigation";

/** Roles & responsibilities now live on each position (Position + Role + Department) */
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { v } = await searchParams;
  redirect(v === "org" ? "/app/qms/positions?v=org" : "/app/qms/positions");
}
