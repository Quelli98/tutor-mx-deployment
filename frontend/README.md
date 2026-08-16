# Tutor Mx frontend

This React + Vite application is the frontend portion of the integrated Tutor Mx repository. Run installation, configuration and quality commands from the root `README.md`.

Auth0 Universal Login owns sign-up, sign-in, sign-out and password entry. The browser obtains an access token in memory and sends it only to the handwritten Express API through the shared request helper in `src/api/client.js`.

The Tutor role opens an own-user dashboard at `/tutor` and availability, work-log and excuse forms at `/tutor/forms`. These screens call `/api/tutor/...` routes with the shared bearer helper; they never send a tutor ID or connect to Prisma/Neon directly.

The preceding document was generated and reviewed with the assistance of the following: Codex[GPT-5].
