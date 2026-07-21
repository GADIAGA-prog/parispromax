ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "birthDate" TEXT;
ALTER TABLE "User" ADD COLUMN "birthPlace" TEXT;
ALTER TABLE "User" ADD COLUMN "recoveryQuestion" TEXT;
ALTER TABLE "User" ADD COLUMN "recoveryAnswerHash" TEXT;

CREATE TABLE "RecoveryRequest" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "phone" TEXT NOT NULL,
  "claimedFirstName" TEXT,
  "claimedLastName" TEXT,
  "claimedBirthDate" TEXT,
  "claimedBirthPlace" TEXT,
  "paymentReference" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "emailSent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME,
  CONSTRAINT "RecoveryRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RecoveryRequest_phone_createdAt_idx"
  ON "RecoveryRequest"("phone", "createdAt");
CREATE INDEX "RecoveryRequest_status_createdAt_idx"
  ON "RecoveryRequest"("status", "createdAt");
