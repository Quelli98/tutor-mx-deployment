import "dotenv/config";
import { createApp } from "./app.js";
import { createAuth0AccessTokenVerifier } from "./auth/auth0-verifier.js";
import {
  normalizeTutorRole,
  type AccessTokenVerifier,
} from "./auth/contract.js";
import {
  createAuth0PasswordResetRequester,
  type PasswordResetRequester,
} from "./auth/password-reset.js";
import { prisma } from "./database.js";

const port = Number(process.env.PORT ?? 3000);

const auth0Domain = process.env.AUTH0_DOMAIN;
const auth0Audience = process.env.AUTH0_AUDIENCE;
const auth0RolesClaim =
  process.env.AUTH0_ROLES_CLAIM ?? "https://tutormx.example/roles";

const verifyAccessToken: AccessTokenVerifier =
  auth0Domain && auth0Audience
    ? createAuth0AccessTokenVerifier({
        audience: auth0Audience,
        domain: auth0Domain,
        rolesClaim: auth0RolesClaim,
      })
    : async () => {
        throw new Error("Auth0 access-token verification is not configured");
      };

const requestPasswordReset: PasswordResetRequester =
  auth0Domain && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_DB_CONNECTION
    ? createAuth0PasswordResetRequester({
        clientId: process.env.AUTH0_CLIENT_ID,
        connection: process.env.AUTH0_DB_CONNECTION,
        domain: auth0Domain,
      })
    : async () => {
        throw new Error("Auth0 password reset is not configured");
      };

const app = createApp(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  {
    corsOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
    verifyAccessToken,
    requestPasswordReset,
    async findProfileByAuth0Id(auth0Id) {
      const profile = await prisma.profile.findUnique({
        where: { auth0Id },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
        },
      });
      const role = normalizeTutorRole(profile?.role);
      return profile && role ? { ...profile, role } : null;
    },
  },
);

app.listen(port, () => {
  console.log(`Tutor Mx API listening on http://localhost:${port}`);
});
