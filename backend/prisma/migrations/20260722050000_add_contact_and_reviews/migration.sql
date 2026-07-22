CREATE TABLE "ContactMessage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "contact" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "emailSent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" DATETIME
);

CREATE INDEX "ContactMessage_status_createdAt_idx"
  ON "ContactMessage"("status", "createdAt");

CREATE TABLE "ServiceReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT,
  "rating" INTEGER NOT NULL,
  "comment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "emailSent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ServiceReview_status_createdAt_idx"
  ON "ServiceReview"("status", "createdAt");
CREATE INDEX "ServiceReview_rating_createdAt_idx"
  ON "ServiceReview"("rating", "createdAt");
