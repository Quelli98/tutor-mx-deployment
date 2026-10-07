-- Draft planning never writes Allocation until a version-checked publish.
CREATE TABLE "Scenario" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(120) NOT NULL,
  "notes" VARCHAR(2000) NOT NULL DEFAULT '',
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "baseLiveRevision" VARCHAR(64) NOT NULL,
  "createdById" INTEGER REFERENCES "Profile"("id") ON DELETE SET NULL,
  "updatedById" INTEGER REFERENCES "Profile"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Scenario_window" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '28 days'),
  CONSTRAINT "Scenario_status" CHECK ("status" IN ('DRAFT','ARCHIVED','PUBLISHED')),
  CONSTRAINT "Scenario_version" CHECK ("version" > 0),
  CONSTRAINT "Scenario_name" CHECK (length(trim("name")) > 0)
);
CREATE TABLE "ScenarioItem" (
  "id" SERIAL PRIMARY KEY,
  "scenarioId" INTEGER NOT NULL REFERENCES "Scenario"("id") ON DELETE CASCADE,
  "sourceAllocationId" INTEGER,
  "tutorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
  "courseId" INTEGER NOT NULL REFERENCES "Course"("id") ON DELETE RESTRICT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "allocatedHours" DECIMAL(5,2) NOT NULL,
  "minimumMark" DECIMAL(5,2) NOT NULL DEFAULT 50,
  "locked" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "ScenarioItem_window" CHECK ("endsAt" > "startsAt" AND "endsAt" <= "startsAt" + interval '8 hours'),
  CONSTRAINT "ScenarioItem_hours" CHECK ("allocatedHours" > 0 AND "allocatedHours" <= extract(epoch FROM ("endsAt"-"startsAt"))/3600),
  CONSTRAINT "ScenarioItem_mark" CHECK ("minimumMark" BETWEEN 0 AND 100),
  UNIQUE ("scenarioId","sourceAllocationId")
);
CREATE TABLE "ScenarioPresence" (
  "scenarioId" INTEGER NOT NULL REFERENCES "Scenario"("id") ON DELETE CASCADE,
  "profileId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE CASCADE,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("scenarioId","profileId")
);
CREATE INDEX "Scenario_status_updatedAt_idx" ON "Scenario"("status","updatedAt");
CREATE INDEX "ScenarioItem_scenarioId_idx" ON "ScenarioItem"("scenarioId");
CREATE INDEX "ScenarioPresence_lastSeenAt_idx" ON "ScenarioPresence"("lastSeenAt");
