import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { Banner, Card, Pill } from "@/components/ui";
import { paymentSummary } from "@/lib/services/payments";

export default async function Deals({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const user = await requireUser("/deals");
  const { deleted } = await searchParams;
  const deals = await prisma.deal.findMany({
    where: { deletedAt: null, OR: [{ sellerId: user.id }, { buyerId: user.id }] },
    orderBy: { updatedAt: "desc" },
    include: { seller: { select: { name: true } }, buyer: { select: { name: true } }, _count: { select: { deliveries: true } } },
  });
  const pays = await Promise.all(deals.map((d) => paymentSummary(prisma, d.id)));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agreements</h1>
          <p className="text-sm text-muted">Signed in as {user.name}. You see only agreements you created or joined.</p>
        </div>
        <Link href="/deals/new" className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white">New agreement</Link>
      </div>
      {deleted && <Banner tone="observed">The agreement and its files were deleted from PromiseTrace. PayPal&apos;s own records are not affected.</Banner>}
      {deals.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No agreements yet. A seller starts one by pasting the client conversation; a buyer joins through the seller&apos;s invite link.</p>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {deals.map((d, i) => {
            const role = d.sellerId === user.id ? "Seller" : "Buyer";
            const pay = pays[i]!;
            return (
              <li key={d.id}>
                <Link href={`/deals/${d.id}`} className="block rounded-xl border border-line bg-white p-4 hover:border-slate-400">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{d.title}</span>
                    <span className="flex gap-2">
                      <Pill>{role}</Pill>
                      {pay.isPaid ? <Pill tone={pay.latest?.mode === "FIXTURE" ? "review" : "agreed"}>{pay.latest?.mode === "FIXTURE" ? "Paid (fixture)" : "Paid (sandbox)"}</Pill> : pay.isHeld ? <Pill tone={pay.latest?.mode === "FIXTURE" ? "review" : "observed"}>{pay.latest?.mode === "FIXTURE" ? "Held (fixture)" : "Held by PayPal (sandbox)"}</Pill> : pay.latest ? <Pill tone="review">{pay.latest.status}</Pill> : <Pill>Not paid</Pill>}
                      {d._count.deliveries > 0 && <Pill tone="observed">{d._count.deliveries} deliver{d._count.deliveries === 1 ? "y" : "ies"}</Pill>}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">Seller {d.seller.name} · Buyer {d.buyer?.name ?? "not joined yet"} · created {d.createdAt.toISOString().slice(0, 10)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
