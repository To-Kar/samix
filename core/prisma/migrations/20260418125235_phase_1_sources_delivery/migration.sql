-- CreateTable
CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentRunId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" TEXT,
    CONSTRAINT "SourceSnapshot_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentRunId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryLog_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliverySchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channel" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "SourceSnapshot_agentRunId_idx" ON "SourceSnapshot"("agentRunId");

-- CreateIndex
CREATE INDEX "SourceSnapshot_url_idx" ON "SourceSnapshot"("url");

-- CreateIndex
CREATE INDEX "DeliveryLog_agentRunId_idx" ON "DeliveryLog"("agentRunId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySchedule_channel_key" ON "DeliverySchedule"("channel");
