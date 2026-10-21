-- AlterTable (a plain ADD COLUMN: SQLite keeps the foreign key declared inline, no table rebuild)
ALTER TABLE "AgentRun" ADD COLUMN "parentRunId" TEXT REFERENCES "AgentRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "AgentRun_parentRunId_idx" ON "AgentRun"("parentRunId");
