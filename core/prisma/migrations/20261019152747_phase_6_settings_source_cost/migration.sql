-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable (a plain ADD COLUMN: no table rebuild, so existing runs and their foreign keys are untouched)
ALTER TABLE "AgentRun" ADD COLUMN "sourceCostUsd" REAL NOT NULL DEFAULT 0;
