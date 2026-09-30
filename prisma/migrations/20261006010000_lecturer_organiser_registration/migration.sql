-- Move organiser applications away from Student profiles. Organiser applicants
-- now exist independently until a Master Organiser approves them.
ALTER TABLE "OrganiserApplication"
  ADD COLUMN "auth0Id" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "fullName" TEXT;

-- Preserve any application rows created by the earlier implementation so this
-- migration is safe whether or not that version briefly reached a shared DB.
UPDATE "OrganiserApplication" AS application
SET
  "auth0Id" = profile."auth0Id",
  "email" = LOWER(profile."email"),
  "fullName" = profile."fullName"
FROM "Profile" AS profile
WHERE application."applicantProfileId" = profile."id";

ALTER TABLE "OrganiserApplication"
  ALTER COLUMN "auth0Id" SET NOT NULL,
  ALTER COLUMN "email" SET NOT NULL,
  ALTER COLUMN "fullName" SET NOT NULL;

ALTER TABLE "OrganiserApplication"
  DROP CONSTRAINT IF EXISTS "OrganiserApplication_applicantProfileId_fkey";

DROP INDEX IF EXISTS "OrganiserApplication_applicantProfileId_key";

ALTER TABLE "OrganiserApplication"
  DROP COLUMN "applicantProfileId";

CREATE UNIQUE INDEX "OrganiserApplication_auth0Id_key"
  ON "OrganiserApplication"("auth0Id");
CREATE UNIQUE INDEX "OrganiserApplication_email_key"
  ON "OrganiserApplication"("email");
