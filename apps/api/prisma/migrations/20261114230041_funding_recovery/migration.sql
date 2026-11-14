-- AlterTable
ALTER TABLE "funding" ADD COLUMN     "checked_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "funding_recovery_idx" ON "funding"("status", "checked_at");
