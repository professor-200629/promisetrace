"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button } from "@/components/ui";

type PayPalButtonsActions = { restart: () => Promise<void> };
type PayPalNamespace = {
  Buttons: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }, actions: PayPalButtonsActions) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> };
};

declare global {
  interface Window { paypal?: PayPalNamespace }
}

type Msg = { tone: "agreed" | "review" | "bad" | "observed"; text: string } | null;

async function post(url: string, body?: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = (await r.json().catch(() => ({}))) as Record<string, string>;
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

function describe(outcome: string, reason?: string): Msg {
  switch (outcome) {
    case "COMPLETED": return { tone: "agreed", text: "PayPal confirmed the capture as COMPLETED. The agreement is now paid and locked." };
    case "PENDING": return { tone: "review", text: `PayPal reports the capture as PENDING${reason ? ` (${reason})` : ""}. It is not treated as paid until PayPal completes it.` };
    case "DECLINED": return { tone: "bad", text: `PayPal did not complete the payment${reason ? ` (${reason})` : ""}. Nothing is marked paid.` };
    case "NOT_APPROVED": return { tone: "review", text: "PayPal has not recorded your approval yet. Nothing was captured." };
    default: return { tone: "bad", text: `Unexpected result: ${outcome}` };
  }
}

export function PayPalCheckout({ dealId, clientId, currency, mode, amountLabel }: { dealId: string; clientId: string | null; currency: string; mode: "sandbox" | "fixture"; amountLabel: string }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(mode === "sandbox");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "sandbox" || !clientId || !box.current) return;
    let cancelled = false;
    const src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture&components=buttons`;
    const render = () => {
      if (cancelled || !window.paypal || !box.current) return;
      box.current.innerHTML = "";
      window.paypal.Buttons({
        style: { layout: "vertical", label: "pay", shape: "rect" },
        createOrder: async () => {
          setMsg(null);
          const j = await post(`/api/deals/${dealId}/paypal/order`);
          return j.orderId!;
        },
        onApprove: async (data, actions) => {
          setMsg({ tone: "observed", text: "You approved the payment in PayPal. Confirming the capture with PayPal…" });
          const j = await post(`/api/deals/${dealId}/paypal/capture`, { orderId: data.orderID });
          if (j.outcome === "INSTRUMENT_DECLINED") {
            setMsg({ tone: "review", text: "PayPal declined that funding source. Choose another one." });
            return actions.restart();
          }
          setMsg(describe(j.outcome!, j.reason));
          router.refresh();
        },
        onCancel: () => setMsg({ tone: "observed", text: "Checkout cancelled. Nothing was captured." }),
        onError: (err) => setMsg({ tone: "bad", text: err instanceof Error ? err.message : "PayPal checkout failed. Nothing was captured." }),
      }).render(box.current).then(() => !cancelled && setLoading(false)).catch(() => setMsg({ tone: "bad", text: "Could not display PayPal buttons." }));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[data-pt-paypal="${currency}"]`);
    if (existing && window.paypal) render();
    else {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.ptPaypal = currency;
      s.onload = render;
      s.onerror = () => { setLoading(false); setMsg({ tone: "bad", text: "The PayPal script could not load. Check your connection or browser blockers." }); };
      document.body.appendChild(s);
    }
    return () => { cancelled = true; };
  }, [mode, clientId, currency, dealId, router]);

  if (mode === "fixture") {
    return (
      <div className="space-y-3">
        <Banner tone="review"><strong>FIXTURE checkout.</strong> No PayPal call is made and no money moves. The result is stored and exported with the label FIXTURE.</Banner>
        <Button disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const o = await post(`/api/deals/${dealId}/paypal/order`);
            const j = await post(`/api/deals/${dealId}/paypal/capture`, { orderId: o.orderId });
            setMsg(describe(j.outcome!, j.reason));
            router.refresh();
          } catch (e) { setMsg({ tone: "bad", text: e instanceof Error ? e.message : "Failed" }); }
          finally { setBusy(false); }
        }}>{busy ? "Simulating…" : `Simulate payment of ${amountLabel} (fixture)`}</Button>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Pay {amountLabel} with a PayPal <strong>sandbox</strong> buyer account. Approving in the PayPal window is not payment; PromiseTrace confirms the capture with PayPal afterwards.</p>
      {loading && <p className="text-sm text-muted" aria-live="polite">Loading PayPal…</p>}
      <div ref={box} className="max-w-sm" />
      <div aria-live="polite">{msg && <Banner tone={msg.tone}>{msg.text}</Banner>}</div>
    </div>
  );
}
