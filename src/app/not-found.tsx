import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-white p-6 text-sm">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-muted">This page does not exist, or you are not a participant in this agreement.</p>
      <Link href="/deals" className="mt-4 inline-block underline">Back to your agreements</Link>
    </div>
  );
}
