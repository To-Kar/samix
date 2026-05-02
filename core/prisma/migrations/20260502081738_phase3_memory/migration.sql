-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentSlug" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Memory_agentSlug_idx" ON "Memory"("agentSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Memory_agentSlug_key_key" ON "Memory"("agentSlug", "key");
