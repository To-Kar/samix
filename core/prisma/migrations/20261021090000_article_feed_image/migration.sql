-- AlterTable (plain ADD COLUMN: no table rebuild, existing articles and their foreign keys are untouched)
ALTER TABLE "Article" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Article" ADD COLUMN "imageId" TEXT;
