-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN "model" TEXT;

-- AlterTable
ALTER TABLE "Article" ADD COLUMN "importance" INTEGER;
ALTER TABLE "Article" ADD COLUMN "importanceReason" TEXT;

-- CreateTable
CREATE TABLE "ArticleContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "finalUrl" TEXT,
    "title" TEXT,
    "byline" TEXT,
    "siteName" TEXT,
    "lang" TEXT,
    "leadImageId" TEXT,
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "readingMinutes" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleContent_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleContent_articleId_key" ON "ArticleContent"("articleId");
