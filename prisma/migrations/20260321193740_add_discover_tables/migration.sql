-- AlterTable
ALTER TABLE "XhsNote" ADD COLUMN "aiDraft" TEXT;
ALTER TABLE "XhsNote" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "XhsNote" ADD COLUMN "userEdits" TEXT;

-- CreateTable
CREATE TABLE "XhsInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "keyword" TEXT NOT NULL,
    "xhsNoteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "XhsConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
