import Link from "next/link";
import { AuthForm } from "@/components/forms";
import { Card } from "@/components/ui";

export default async function SignUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <Card title="Create an account">
        <p className="mb-4 text-sm text-muted">Sellers and buyers use separate accounts. A buyer joins an agreement through the seller&apos;s private invite link.</p>
        <AuthForm mode="sign-up" next={next ?? "/deals"} />
        <p className="mt-4 text-sm text-muted">Already registered? <Link className="underline" href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Sign in</Link></p>
      </Card>
    </div>
  );
}
