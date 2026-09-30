CREATE TYPE "OrganiserApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "OrganiserApplication" (
  "id" SERIAL NOT NULL,
  "applicantProfileId" INTEGER NOT NULL,
  "motivation" VARCHAR(1000),
  "status" "OrganiserApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewReason" VARCHAR(500),
  "reviewedAt" TIMESTAMP(3),
  "reviewerProfileId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganiserApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganiserApplication_applicantProfileId_key"
  ON "OrganiserApplication"("applicantProfileId");
CREATE INDEX "OrganiserApplication_status_createdAt_idx"
  ON "OrganiserApplication"("status", "createdAt");
CREATE INDEX "OrganiserApplication_reviewerProfileId_idx"
  ON "OrganiserApplication"("reviewerProfileId");

ALTER TABLE "OrganiserApplication"
  ADD CONSTRAINT "OrganiserApplication_applicantProfileId_fkey"
  FOREIGN KEY ("applicantProfileId") REFERENCES "Profile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganiserApplication"
  ADD CONSTRAINT "OrganiserApplication_reviewerProfileId_fkey"
  FOREIGN KEY ("reviewerProfileId") REFERENCES "Profile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
