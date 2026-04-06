-- AlterTable
ALTER TABLE "KeywordCandidate" ADD COLUMN     "icp" TEXT,
ADD COLUMN     "icpInferred" BOOLEAN NOT NULL DEFAULT false;
