-- Hold at checkout (PayPal authorization), capture on acceptance.
-- Additive only: new nullable columns plus `intent` defaulting to CAPTURE for existing rows.
ALTER TABLE "Payment" ADD COLUMN "intent" TEXT NOT NULL DEFAULT 'CAPTURE';
ALTER TABLE "Payment" ADD COLUMN "authorizeRequestId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "voidRequestId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "authorizationId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "authorizationStatus" TEXT;
ALTER TABLE "Payment" ADD COLUMN "authorizedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "authorizationExpiresAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "Payment" ADD COLUMN "captureTrigger" TEXT;
CREATE UNIQUE INDEX "Payment_authorizeRequestId_key" ON "Payment"("authorizeRequestId");
CREATE UNIQUE INDEX "Payment_voidRequestId_key" ON "Payment"("voidRequestId");
CREATE UNIQUE INDEX "Payment_authorizationId_key" ON "Payment"("authorizationId");
