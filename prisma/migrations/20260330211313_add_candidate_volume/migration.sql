-- AlterTable
ALTER TABLE "KeywordCandidate" ADD COLUMN     "kd" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "tailLength" TEXT,
ADD COLUMN     "volume" INTEGER NOT NULL DEFAULT -1;
