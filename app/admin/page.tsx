import type { Metadata } from "next";
import AdminPanel from "@/components/AdminPanel";

export const metadata: Metadata = {
  title: "Ghar Tak · Admin",
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

export default function AdminPage() {
  return <AdminPanel />;
}
