import Link from "next/link";
import { AuthForm } from "@/components/forms";
import { Card } from "@/components/ui";

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <Card title="Sign in">
        <AuthForm mode="sign-in" next={next ?? "/deals"} />
        <p className="mt-4 text-sm text-muted">No account? <Link className="underline" href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create one</Link></p>
      </Card>
    </div>
  );
}
