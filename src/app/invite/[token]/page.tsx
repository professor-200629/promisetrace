import Link from "next/link";
import { prisma } from "@/lib/db";
import { sha256Hex } from "@/lib/hash";
import { currentUser } from "@/lib/session";
import { AcceptInviteForm } from "@/components/forms";
import { Banner, Card } from "@/components/ui";

export default async function Invite({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const deal = await prisma.deal.findUnique({ where: { inviteTokenHash: sha256Hex(token) }, include: { seller: { select: { name: true } } } });
  const user = await currentUser();
  const valid = deal && !deal.deletedAt && (!deal.inviteExpiresAt || deal.inviteExpiresAt > new Date());
  return (
    <div className="mx-auto max-w-lg">
      <Card title="Invitation to review an agreement">
        {!valid ? (
          <Banner tone="bad">This invite link is not valid or has expired. Ask the seller for a new one.</Banner>
        ) : (
          <div className="space-y-4 text-sm">
            <p><strong>{deal.seller.name}</strong> invited you to review <strong>{deal.title}</strong> as the buyer.</p>
            <p className="text-muted">You will see the proposed brief and the exact source text it came from. Nothing is agreed until both of you approve the same version, and nothing is paid until PayPal confirms a capture.</p>
            {user ? (
              <>
                <p>Signed in as {user.name}.</p>
                <AcceptInviteForm token={token} />
              </>
            ) : (
              <div className="flex gap-3">
                <Link className="rounded-lg bg-ink px-4 py-2 text-white" href={`/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`}>Create a buyer account</Link>
                <Link className="rounded-lg border border-line px-4 py-2" href={`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in</Link>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
