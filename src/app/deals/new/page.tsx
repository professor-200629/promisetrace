import { requireUser } from "@/lib/session";
import { aiSetup } from "@/lib/env";
import { NewDealForm } from "@/components/forms";
import { Banner, Card } from "@/components/ui";
import { DEMO_CONVERSATION } from "@/lib/demo";

export default async function NewDeal() {
  await requireUser("/deals/new");
  const ai = aiSetup();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">New agreement</h1>
      {ai.state === "ready" && <Banner tone="ai">The brief will be proposed by {ai.model} through the Anthropic API. Each proposed value must quote your text; anything it cannot quote stays unknown.</Banner>}
      {ai.state === "fixture" && <Banner tone="review">AI fixture mode: a rule-based extractor (not AI) proposes the brief. Configure ANTHROPIC_API_KEY for real extraction.</Banner>}
      {ai.state === "missing_credentials" && <Banner tone="review">AI is not configured, so you will fill in the brief by hand.</Banner>}
      <Card>
        <NewDealForm sample={DEMO_CONVERSATION} />
      </Card>
    </div>
  );
}
