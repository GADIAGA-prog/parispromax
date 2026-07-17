ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
CREATE TABLE "Referral" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sponsorId" TEXT NOT NULL,
  "referredId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "rewardedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Referral_referredId_key" ON "Referral"("referredId");
CREATE INDEX "Referral_sponsorId_idx" ON "Referral"("sponsorId");
ALTER TABLE "Payment" ADD COLUMN "baseAmount" INTEGER;
ALTER TABLE "Payment" ADD COLUMN "referralDiscount" INTEGER NOT NULL DEFAULT 0;
