-- CreateTable
CREATE TABLE "repositories" (
    "githubId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("githubId")
);

-- CreateTable
CREATE TABLE "analyses" (
    "id" TEXT NOT NULL,
    "repositoryId" BIGINT NOT NULL,
    "overallScore" INTEGER,
    "scoringVersion" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "repositories_fullName_idx" ON "repositories"("fullName");

-- CreateIndex
CREATE INDEX "analyses_repositoryId_createdAt_idx" ON "analyses"("repositoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("githubId") ON DELETE CASCADE ON UPDATE CASCADE;
