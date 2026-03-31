-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "da" INTEGER NOT NULL DEFAULT 0,
    "sitemapUrl" TEXT,
    "locationId" INTEGER NOT NULL DEFAULT 2124,
    "languageId" INTEGER NOT NULL DEFAULT 1000,
    "onboardingDoc" TEXT,
    "onboardingSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExistingPage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "inferredKeyword" TEXT,
    "lastScanned" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExistingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordCandidate" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "funnelStage" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordAnalysis" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "volume" INTEGER NOT NULL DEFAULT 0,
    "kd" INTEGER NOT NULL DEFAULT 0,
    "mangoolsRawSerpResponse" TEXT,
    "serpCompetitors" TEXT,
    "intentConfirmation" TEXT,
    "intentEvidence" TEXT,
    "targetingAssessment" TEXT,
    "competitorTargetingScore" TEXT,
    "competitiveAnalysis" TEXT,
    "semanticVariations" TEXT,
    "serviceMatch" TEXT,
    "serviceMatchNote" TEXT,
    "recommendedOutline" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'pending',
    "confidenceNote" TEXT,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending_review',
    "reviewNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUsage" (
    "id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExistingPage_clientId_idx" ON "ExistingPage"("clientId");

-- CreateIndex
CREATE INDEX "ResearchSession_clientId_idx" ON "ResearchSession"("clientId");

-- CreateIndex
CREATE INDEX "KeywordCandidate_sessionId_idx" ON "KeywordCandidate"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordAnalysis_candidateId_key" ON "KeywordAnalysis"("candidateId");

-- CreateIndex
CREATE INDEX "KeywordAnalysis_sessionId_idx" ON "KeywordAnalysis"("sessionId");

-- CreateIndex
CREATE INDEX "KeywordAnalysis_candidateId_idx" ON "KeywordAnalysis"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsage_resource_date_key" ON "DailyUsage"("resource", "date");

-- AddForeignKey
ALTER TABLE "ExistingPage" ADD CONSTRAINT "ExistingPage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSession" ADD CONSTRAINT "ResearchSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordCandidate" ADD CONSTRAINT "KeywordCandidate_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAnalysis" ADD CONSTRAINT "KeywordAnalysis_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "KeywordCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAnalysis" ADD CONSTRAINT "KeywordAnalysis_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ResearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
