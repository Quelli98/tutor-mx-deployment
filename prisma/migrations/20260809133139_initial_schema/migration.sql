-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ORGANISER', 'TUTOR', 'STUDENT');

-- CreateEnum
CREATE TYPE "TimeSlotType" AS ENUM ('AVAILABLE', 'BUSY');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Profile" (
    "id" SERIAL NOT NULL,
    "auth0Id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Course" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorMark" (
    "id" SERIAL NOT NULL,
    "tutorId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "mark" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "TutorMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" SERIAL NOT NULL,
    "tutorId" INTEGER NOT NULL,
    "type" "TimeSlotType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorHourLimit" (
    "id" SERIAL NOT NULL,
    "tutorId" INTEGER NOT NULL,
    "weeklyHours" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "TutorHourLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allocation" (
    "id" SERIAL NOT NULL,
    "tutorId" INTEGER NOT NULL,
    "courseId" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allocatedHours" DECIMAL(5,2) NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_auth0Id_key" ON "Profile"("auth0Id");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_email_key" ON "Profile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Course_code_key" ON "Course"("code");

-- CreateIndex
CREATE UNIQUE INDEX "TutorMark_tutorId_courseId_key" ON "TutorMark"("tutorId", "courseId");

-- CreateIndex
CREATE INDEX "TimeSlot_tutorId_startsAt_endsAt_idx" ON "TimeSlot"("tutorId", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "TutorHourLimit_tutorId_key" ON "TutorHourLimit"("tutorId");

-- CreateIndex
CREATE INDEX "Allocation_tutorId_startsAt_endsAt_idx" ON "Allocation"("tutorId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Allocation_courseId_idx" ON "Allocation"("courseId");

-- AddForeignKey
ALTER TABLE "TutorMark" ADD CONSTRAINT "TutorMark_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMark" ADD CONSTRAINT "TutorMark_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorHourLimit" ADD CONSTRAINT "TutorHourLimit_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
