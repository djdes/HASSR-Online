-- CreateTable
CREATE TABLE "SetupHelperDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "installationId" TEXT,
    "appVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetupHelperDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelPrinter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "address" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "transport" TEXT NOT NULL,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "lastPrintAt" TIMESTAMP(3),
    "lastTemplate" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelPrinter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetupHelperDevice_tokenHash_key" ON "SetupHelperDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "SetupHelperDevice_organizationId_idx" ON "SetupHelperDevice"("organizationId");

-- CreateIndex
CREATE INDEX "LabelPrinter_deviceId_idx" ON "LabelPrinter"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelPrinter_organizationId_address_key" ON "LabelPrinter"("organizationId", "address");

-- AddForeignKey
ALTER TABLE "SetupHelperDevice" ADD CONSTRAINT "SetupHelperDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelPrinter" ADD CONSTRAINT "LabelPrinter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelPrinter" ADD CONSTRAINT "LabelPrinter_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "SetupHelperDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

