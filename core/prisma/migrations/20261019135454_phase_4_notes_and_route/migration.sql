-- AlterTable
ALTER TABLE "ConversationMessage" ADD COLUMN "extra" TEXT;

-- CreateTable
CREATE TABLE "MemoryNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
