# Organiser Tutor Management - self-service onboarding alignment

Date: 23 August 2026

## Problem corrected

The Organiser Tutor management screen still exposed a manual **Auth0 subject** field even though Tutor Mx now creates Tutor profiles through the self-service Auth0 onboarding flow. That forced an Organiser to open Auth0 and copy a technical User ID such as `auth0|...`, which was inconsistent with the current architecture.

## Updated behaviour

- A Tutor signs up through Tutor Mx and chooses the **Tutor** role.
- The existing onboarding flow links the verified Auth0 identity to the Neon `Profile` automatically.
- The Organiser Tutor management screen loads those registered Tutor profiles through `GET /api/tutors`.
- The Organiser can search by **name or email**.
- Editing uses the Tutor's existing numeric database `id` internally through `PATCH /api/tutors/:tutorId`.
- The Organiser UI never asks for, displays, copies or submits an Auth0 subject.
- If no Tutor profiles exist, the page tells the Organiser that the Tutor must sign up and choose the Tutor role first.

## Compatibility note

The older `POST /api/tutors` route is retained only for compatibility with the previously integrated Member 2 API contract. The current self-service Organiser UI does not call it. New Tutor identities should come from the Auth0 onboarding flow rather than manual Organiser entry.
