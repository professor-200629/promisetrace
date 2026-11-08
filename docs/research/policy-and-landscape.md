# PromiseTrace: policy and landscape research

All facts below were checked on 8 Nov 2026 unless marked otherwise. Short phrases in quotes are under 15 words; everything else is paraphrased. Items marked "inference" are my reading, not a source statement. Pages PayPal serves behind a 403 to plain fetchers (all paypal.com/in pages) were read through the in-app browser instead.

## 1. India: receiving payments

| Fact | Source (checked 8 Nov 2026) |
|---|---|
| PayPal India answers "No" to receiving domestic payments from Indian customers. International customers' payments can be received in more than 25 currencies. | https://www.paypal.com/in/cshelp/article/can-i-use-paypal-to-receive-payments-from-indian-customers-help1049 |
| Before receiving or withdrawing, the seller must confirm email and complete identity (KYC) for their business type. | https://www.paypal.com/in/cshelp/article/how-do-i-receive-payments-through-paypal-help667 |
| For international-only receiving: verify PAN, add an Indian bank account, select a Purpose Code, state the nature of business. Goods exporters also need a valid IEC. | same page as above |
| Business Individual / Sole Prop sellers can choose Lite KYC at signup; it still allows one payment under $200. More than that, or auto-withdraw, needs Full KYC. | same page as above |
| Purpose Code (RBI code): 5 characters, one letter plus four digits. Inward codes start with "P" (example given: P0802, software implementation or consultancy). It is set once at account setup, used as the default reason for all payments, and must be in place before withdrawing to an Indian bank. It also decides whether an IEC is needed. | https://www.paypal.com/in/cshelp/article/what-is-the-purpose-code-and-how-is-it-different-from-the-nature-of-my-business-help978 |
| A wrong code can cause held funds, cancelled payments or regulator scrutiny, per the same page. The page does not say which code fits logo design; the seller must pick from the RBI list. | same page as above |
| Withdrawals: manual transfer is not available. PayPal moves the balance automatically every day to the preferred Indian bank account. Allow up to 5 business days for funds to show. Failed transfers (bad bank details) return to PayPal and a return fee may apply. | https://www.paypal.com/in/cshelp/article/how-do-i-transfer-funds-to-my-bank-account-help394 |
| FIRA (the page says "Foreign Inward Remittance Advise", not FIRC/eFIRA): proof of foreign-currency receipt. A free automatically generated Weekly Digital FIRA is available from Feb 2026, downloadable in Reports > Tax; earlier periods are monthly. Reports cover the last 12 months only; older or per-withdrawal needs go through a Custom FIRA request. | https://www.paypal.com/in/business/firc-certificate |

Not found: any PayPal India page requiring a specific invoice format for the seller. The pages I read do not mention invoices. Treat invoice duties as unverified.

Implications for PromiseTrace (inference): the buyer must be overseas (an Indian-to-Indian sale cannot be received); PromiseTrace should show the seller that a Purpose Code and FIRA are PayPal-side tasks and must not claim to handle them. An evidence record could help a seller's own paperwork but is not a FIRA.

## 2. Seller Protection (India)

Source for everything in this section: https://www.paypal.com/in/legalhub/paypal/seller-protection (page says "Last updated on 26 January 2026"; checked 8 Nov 2026). I did not read the India user agreement.

- Scope: a seller of "a good or service" may be eligible. PayPal decides eligibility at its sole discretion, based on the rules and the documents provided.
- Covered claim types: Unauthorised Transaction and Item Not Received (INR). INR claims that come from a buyer's card-issuer chargeback are not eligible.
- Intangible goods and services are explicitly allowed through "Intangible Goods Additional Requirements": the item must be delivered, and the seller must provide proof of shipment or delivery. For unauthorised-transaction claims the transaction must also be marked "eligible" on the Transaction Details page, or PayPal must have said so in writing.
- Proof for digital goods: "compelling evidence" the item was delivered or the order fulfilled. Example given is a system of record with the send date plus either electronic delivery to the recipient's address (email, IP) or evidence the recipient received or accessed it.
- Significantly Not as Described (SNAD): the ineligible list includes items where the buyer claims, with PayPal or the card issuer, that what was sent is not what was ordered. So SNAD is not covered.
- Other basic requirements: respond to PayPal document requests on time; accept payment from a PayPal account (partial or instalment payments excluded); if using a PayPal Checkout product, use its current version and pass required session information.
- Guest Checkout and standard card payments are excluded only for sellers registered in a list of countries that does not include India (inference: such payments remain eligible for Indian sellers, per the page's closing sentence for "all other countries").
- Inference for PromiseTrace: the evidence record maps well to INR proof for digital deliverables (delivery timestamp, recipient, access). It does not help with SNAD coverage, and brief-vs-delivery checking must not be marketed as Seller Protection. Whether a transaction is eligible is shown by PayPal, not by this app.

## 3. PayPal Disputes API

Sources: https://developer.paypal.com/disputes/overview, https://developer.paypal.com/platforms/disputes/integrate-disputes/, https://developer.paypal.com/platforms/disputes/handle-disputes/use-disputes-api, https://developer.paypal.com/disputes/choose-integration, https://developer.paypal.com/api/rest/webhooks/event-names (all checked 8 Nov 2026).

What a merchant can do via REST (`/v1/customer/disputes`):
- List disputes (filter by disputed transaction ID) and show one dispute with its allowed next actions.
- Send message, make offer, accept claim (closes in buyer's favour; PayPal refunds the buyer), provide evidence, provide supporting info, escalate an inquiry to a claim, appeal a lost dispute (only if the appeal link is present), acknowledge a returned item (SNAD only).
- Evidence is allowed when status is `WAITING_FOR_SELLER_RESPONSE`. Evidence types listed include `PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND`, `OTHER`; fulfilment evidence carries tracking info. The seller must respond by `seller_response_due_date` or the dispute can close in the buyer's favour.
- The inquiry stage applies only to INR and SNAD issues on internal disputes.

Enablement:
- Enable "Disputes" in the app feature options when creating the REST app.
- Creating test disputes in the sandbox needs the scope `https://uri.paypal.com/services/disputes/create` on the app. The integrate page says to contact your PayPal account manager to enable it.
- Changing a dispute reason in the sandbox needs `https://uri.paypal.com/services/disputes/update-buyer`, also via account manager.
- Downloading evidence documents needs an extra scope, requested via the account manager (use-disputes-api page).
- A 403 means the app or account lacks permission.

Sandbox simulation steps (integrate page): get the create scope enabled; have a sandbox personal buyer grant consent through Log in with PayPal (`openid`); get a client-credentials access token; build a `PayPal-Auth-Assertion` JWT with your client ID and the buyer's email; send money from the buyer to your business sandbox account; POST `/v1/customer/disputes` with the buyer transaction ID, reason, amount; optionally create a chargeback with `/v2/customer-support/process-chargeback`. Sandbox-only calls can update status and settle disputes.

Webhooks: `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED` (seen on the event names page). A search summary said an older `RISK.DISPUTE.CREATED` was superseded; I did not verify that on the page.

Not verified: whether a standard individual developer account gets the create scope without an account manager. The docs imply it needs one. Also, the choose-integration page lists no usage limits and says the API suits businesses with developers.

Inference: for the hackathon, plan to read and respond to disputes via the Disputes API only if scopes are granted; otherwise show the evidence record as an export the seller uploads in Resolution Center, and demonstrate with mock dispute payloads.

## 4. Multi-merchant future

Sources checked 8 Nov 2026: https://developer.paypal.com/docs/multiparty/, https://developer.paypal.com/platforms/seller-onboarding, https://developer.paypal.com/docs/multiparty/checkout/immediate-capture/, search results from developer.paypal.com for Partner Referrals pages (merchant-level and platform-level onboarding; snippet only, not fully read).

- Platform route is PayPal Complete Payments (the multiparty docs). You can test in sandbox with a standard developer account, but going live requires platform approval. The criteria are not described on the page.
- To start, fill "Tell us about your platform" (company, website, country, solution, annual client volume); a PayPal representative follows up. Small sellers are told not to use that form.
- Immediate-capture page: you "must be an approved partner" and must onboard sellers before integrating.
- Sellers finish PayPal signup (with risk and compliance screening). The Partner Referrals API prefills the signup form and generates the seller link; this is the onboarding route.
- Onboarding methods: before payment (recommended; wait for the seller to finish and confirm email), after payment (Checkout only, business accounts), and built into software (excludes multi-seller purchases, partner fee, dispute APIs, reporting).
- `PayPal-Auth-Assertion` is an unsigned JWT (`alg: none`) with the platform client ID as `iss` and the seller `payer_id` (preferred) or email. Sent with order calls so the platform acts for the seller.
- Platform fees need the seller onboarded with PARTNER_FEE, same-currency fees, and a partner account that holds no balance.
- Country eligibility varies; do not onboard sellers in "send only" countries.
- Inference: the app's current single-merchant Checkout is the right scope for a sandbox hackathon demo. A multi-seller version needs PayPal partner approval first, and the "built into software" route would not give dispute API access.

## 5. Existing tools: neutral comparison

Sources (checked 8 Nov 2026): https://docs.chargeflow.io/docs/merchants/recover/enrich-a-dispute/by-business-model, https://www.hellobonsai.com/contracts. Their other pages were not read.

- Chargeflow: builds dispute evidence from business data pushed via its API (a PATCH on a dispute). The page covers SaaS/subscriptions (sign-up, logins, activity logs, billing) and e-commerce/physical goods (orders, tracking, delivery). A marketplace option is mentioned but has no content. I found no service-delivery or freelance-work model on that page.
- Bonsai: contract and client workflow tool: e-signature, templates, deposit capture on approval, automations, view receipts, reminders, linked proposals/invoices/client portal. It states it is not a law firm.
- Overlap 1: all three produce records a party can use in a payment dispute. Chargeflow is dispute-side; Bonsai is agreement-side.
- Overlap 2: Bonsai and PromiseTrace both capture an agreed scope up front and tie payment to it.
- Difference: PromiseTrace checks each delivered file against each structured brief requirement and links the result to its source, which neither page describes. Chargeflow's evidence is about usage and shipping, not requirement-by-requirement checks.
- Caveat: I only read two pages. Do not claim PromiseTrace is unique; say "narrower" and "for independent digital-service sellers using ordinary PayPal Checkout".

## 6. Claude runtime versus coding access

Sources checked 8 Nov 2026: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-max-or-ultra-plan, https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans.

- The first article does not say a subscription provides API keys or credits for an app's runtime. It says Claude Code usage counts toward the same five-hour and weekly limits as Claude, and that API-key use is billed separately at API rates and replaces subscription authentication.
- Max, Ultra and Team plans include monthly API credits, but they cannot be used inside Claude Code or the Claude apps.
- How to get them: after 7 days on an eligible plan, claim them in claude.ai under Billing by linking a Claude Console organisation. Only one organisation can be linked and you cannot change it yourself.
- Amounts: Max $100/month, Ultra $200/month, Team $20 per Standard seat or $100 per Premium seat, pooled and capped at $500/month.
- Expiry: they refresh each billing cycle and do not roll over. They are used before purchased credits.
- When they run out: usage continues on any purchased credits or auto-reload if enabled in the Console. Otherwise API requests stop until the next monthly credits. Usage is never charged to the plan. The article describes no separate overage charge.
- Inference: an app calling Claude at runtime needs a Console API key, which can draw on the monthly credits for Max/Ultra/Team holders only if the Console org is linked. Pro is not listed for credits in the article I read.
