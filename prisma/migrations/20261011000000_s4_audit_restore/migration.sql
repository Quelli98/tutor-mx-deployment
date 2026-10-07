ALTER TABLE "Allocation" ADD COLUMN "minimumMark" DOUBLE PRECISION NOT NULL DEFAULT 50 CHECK ("minimumMark">=0 AND "minimumMark"<=100);
ALTER TABLE "Allocation" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE FUNCTION s4_allocation_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."version":=OLD."version"+1; RETURN NEW; END $$;
CREATE TRIGGER "Allocation_version" BEFORE UPDATE ON "Allocation" FOR EACH ROW EXECUTE FUNCTION s4_allocation_version();
CREATE TABLE "AuditEvent" (
 "id" SERIAL PRIMARY KEY,
 "actorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "action" VARCHAR(64) NOT NULL,
 "targetType" VARCHAR(24) NOT NULL,
 "targetId" INTEGER NOT NULL CHECK ("targetId">0),
 "before" JSONB NOT NULL DEFAULT '{}',
 "after" JSONB NOT NULL DEFAULT '{}',
 "reason" VARCHAR(1000) NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt","id");
CREATE INDEX "AuditEvent_targetType_targetId_id_idx" ON "AuditEvent"("targetType","targetId","id");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId","createdAt");
CREATE TRIGGER "AuditEvent_immutable" BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION s4_immutable_history();
CREATE TABLE "MutationReceipt" (
 "id" SERIAL PRIMARY KEY,
 "actorId" INTEGER NOT NULL REFERENCES "Profile"("id") ON DELETE RESTRICT,
 "scope" VARCHAR(100) NOT NULL,
 "requestKey" VARCHAR(128) NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL,
 "resultId" INTEGER NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("actorId","scope","requestKey")
);
