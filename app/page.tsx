import { redirect } from "next/navigation";

export default function Home() {
  // The proxy sends logged-out users from /dashboard to /login.
  redirect("/dashboard");
}
