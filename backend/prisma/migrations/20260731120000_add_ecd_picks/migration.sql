CREATE TABLE "EcdPick" (
  "id" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "journalUrl" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EcdPick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EcdPick_date_country_externalId_key"
  ON "EcdPick"("date", "country", "externalId");
CREATE INDEX "EcdPick_date_country_idx" ON "EcdPick"("date", "country");
