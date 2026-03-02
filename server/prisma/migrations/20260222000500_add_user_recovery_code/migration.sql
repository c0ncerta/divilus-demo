-- AlterTable
ALTER TABLE "User"
ADD COLUMN "recoveryCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_recoveryCode_key" ON "User"("recoveryCode");
