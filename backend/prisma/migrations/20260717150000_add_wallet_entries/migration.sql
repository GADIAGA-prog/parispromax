CREATE TABLE "WalletEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "betType" TEXT,
  "stake" INTEGER NOT NULL,
  "winnings" INTEGER NOT NULL DEFAULT 0,
  "playedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WalletEntry_userId_playedAt_idx" ON "WalletEntry"("userId", "playedAt");
