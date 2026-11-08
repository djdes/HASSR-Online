ALTER TABLE "Organization" ADD COLUMN     "accountManagerId" TEXT;

ALTER TABLE "User" ADD COLUMN     "platformRoleId" TEXT,
ADD COLUMN     "platformTitle" TEXT;

CREATE TABLE "PlatformRole" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" TEXT NOT NULL DEFAULT 'all',
    "salesHead" BOOLEAN NOT NULL DEFAULT false,
    "signatureTitle" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformRole_key_key" ON "PlatformRole"("key");

CREATE INDEX "PlatformRole_sort_idx" ON "PlatformRole"("sort");

ALTER TABLE "User" ADD CONSTRAINT "User_platformRoleId_fkey" FOREIGN KEY ("platformRoleId") REFERENCES "PlatformRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;