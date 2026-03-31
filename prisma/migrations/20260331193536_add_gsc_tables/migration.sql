-- CreateTable
CREATE TABLE "GscToken" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscProperty" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GscProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscPage" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSyncDate" TEXT NOT NULL,

    CONSTRAINT "GscPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscQuery" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgPosition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastSyncDate" TEXT NOT NULL,

    CONSTRAINT "GscQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GscProperty_clientId_key" ON "GscProperty"("clientId");

-- CreateIndex
CREATE INDEX "GscProperty_clientId_idx" ON "GscProperty"("clientId");

-- CreateIndex
CREATE INDEX "GscPage_propertyId_idx" ON "GscPage"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "GscPage_propertyId_url_key" ON "GscPage"("propertyId", "url");

-- CreateIndex
CREATE INDEX "GscQuery_propertyId_query_idx" ON "GscQuery"("propertyId", "query");

-- CreateIndex
CREATE INDEX "GscQuery_propertyId_page_idx" ON "GscQuery"("propertyId", "page");

-- CreateIndex
CREATE UNIQUE INDEX "GscQuery_propertyId_query_page_key" ON "GscQuery"("propertyId", "query", "page");

-- AddForeignKey
ALTER TABLE "GscProperty" ADD CONSTRAINT "GscProperty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscPage" ADD CONSTRAINT "GscPage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "GscProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscQuery" ADD CONSTRAINT "GscQuery_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "GscProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
