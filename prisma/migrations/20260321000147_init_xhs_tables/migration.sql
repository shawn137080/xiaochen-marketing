-- CreateTable
CREATE TABLE "XhsNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "xhsNoteId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "noteType" TEXT NOT NULL DEFAULT 'image',
    "industry" TEXT,
    "contentAngle" TEXT,
    "titleFormula" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "XhsNoteMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "noteId" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "bookmarks" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XhsNoteMetric_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "XhsNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsContentTheme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "theme" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "usedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XhsContentTheme_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "XhsNote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "XhsCompetitorNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "xhsNoteId" TEXT NOT NULL,
    "author" TEXT,
    "title" TEXT,
    "likes" INTEGER,
    "comments" INTEGER,
    "bookmarks" INTEGER,
    "analysis" TEXT,
    "reusableElements" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "XhsReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodType" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "totalNotes" INTEGER,
    "totalLikes" INTEGER,
    "totalComments" INTEGER,
    "totalBookmarks" INTEGER,
    "topNoteId" TEXT,
    "insights" TEXT,
    "recommendations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "XhsReport_topNoteId_fkey" FOREIGN KEY ("topNoteId") REFERENCES "XhsNote" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "XhsNote_xhsNoteId_key" ON "XhsNote"("xhsNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "XhsCompetitorNote_xhsNoteId_key" ON "XhsCompetitorNote"("xhsNoteId");
