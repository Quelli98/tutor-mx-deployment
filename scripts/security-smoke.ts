/**
 * S2-M1-3 live cross-role security smoke runner.
 *
 * Runs the three-role acceptance sequence against a deployed Tutor Mx
 * backend (for example the shared Render environment). Every probe is
 * side-effect free: successful probes are read-only, and write probes
 * are expected to fail with 401/403 before any persistence runs.
 *
 * Required environment variables:
 *   SMOKE_BASE_URL          e.g. https://tutor-mx-api.onrender.com
 *   SMOKE_STUDENT_TOKEN     access token for the Student test account
 *   SMOKE_TUTOR_TOKEN       access token for the Tutor test account
 *   SMOKE_ORGANISER_TOKEN   access token for the Organiser test account
 *
 * Obtain each token by signing in to the deployed frontend with the
 * dedicated test account and copying the current access token (see
 * docs/sprint2-security-smoke.md for the full runbook).
 */

const baseUrlValue = process.env.SMOKE_BASE_URL;

if (!baseUrlValue) {
  throw new Error("SMOKE_BASE_URL is not configured");
}

const baseUrl = new URL(baseUrlValue);
if (!["http:", "https:"].includes(baseUrl.protocol)) {
  throw new Error("SMOKE_BASE_URL must use http or https");
}

const personaTokens = {
  STUDENT: process.env.SMOKE_STUDENT_TOKEN,
  TUTOR: process.env.SMOKE_TUTOR_TOKEN,
  ORGANISER: process.env.SMOKE_ORGANISER_TOKEN,
} as const;

const missingTokens = (Object.keys(personaTokens) as Array<
  keyof typeof personaTokens
>).filter((persona) => !personaTokens[persona]);

if (missingTokens.length > 0) {
  throw new Error(
    `Missing access token(s) for: ${missingTokens.join(", ")}. ` +
      "Sign in to the deployed frontend with each dedicated test account and " +
      "set SMOKE_STUDENT_TOKEN, SMOKE_TUTOR_TOKEN and SMOKE_ORGANISER_TOKEN.",
  );
}

interface Probe {
  name: string;
  path: string;
  init: RequestInit;
  expectStatus: number;
  expectErrorCode?: string;
  expectProfileRole?: "STUDENT" | "TUTOR" | "ORGANISER";
}

function bearerToken(token: string | undefined): string {
  return `Bearer ${token ?? ""}`;
}

/** A tampered signature stands in for an expired access token: both are rejected by the same 401 INVALID_ACCESS_TOKEN path. */
function tamperedToken(token: string | undefined): string {
  const value = token ?? "";
  const parts = value.split(".");
  if (parts.length === 3) {
    const signature = parts[2]!;
    const flipped =
      signature.endsWith("A") ? `${signature.slice(0, -1)}B` : `${signature}A`;
    return `${parts[0]}.${parts[1]}.${flipped}`;
  }
  return `${value}tampered`;
}

const courseWriteBody = JSON.stringify({
  code: "SMOKE101",
  name: "Smoke Course",
});

const allocationWriteBody = JSON.stringify({
  tutorId: 2,
  courseId: 3,
  startsAt: "2030-09-04T14:00:00.000Z",
  endsAt: "2030-09-04T16:00:00.000Z",
  minimumMark: 50,
  requestedHours: 2,
  status: "CONFIRMED",
});

const probes: Probe[] = [
  {
    name: "health endpoint answers without a token",
    path: "/health",
    init: { headers: { accept: "application/json" } },
    expectStatus: 200,
  },
  {
    name: "readiness endpoint reports the database",
    path: "/ready",
    init: { headers: { accept: "application/json" } },
    expectStatus: 200,
  },
  {
    name: "Student account lands in the Student workspace",
    path: "/api/me",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
    },
    expectStatus: 200,
    expectProfileRole: "STUDENT",
  },
  {
    name: "Student real overflow opens for the Student account",
    path: "/api/student/open-work",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Public-holiday supporting data returns safely for a linked user",
    path: "/api/public-holidays?year=2030",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Tutor account lands in the Tutor workspace",
    path: "/api/me",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
    },
    expectStatus: 200,
    expectProfileRole: "TUTOR",
  },
  {
    name: "Organiser account lands in the Organiser workspace",
    path: "/api/me",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 200,
    expectProfileRole: "ORGANISER",
  },
  {
    name: "Tutor dashboard opens for the Tutor account",
    path: "/api/tutor/dashboard",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Organiser tutor list opens for the Organiser account",
    path: "/api/tutors",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Organiser allocation board loads active allocations",
    path: "/api/allocations",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Organiser approval queues load safely",
    path: "/api/organiser/approvals",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 200,
  },
  {
    name: "Student cannot open the Tutor dashboard",
    path: "/api/tutor/dashboard",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Student cannot list tutors",
    path: "/api/tutors",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Student cannot create courses",
    path: "/api/courses",
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
      body: courseWriteBody,
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Tutor cannot open Student overflow",
    path: "/api/student/open-work",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Student cannot create allocations",
    path: "/api/allocations",
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: bearerToken(personaTokens.STUDENT),
      },
      body: allocationWriteBody,
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Tutor cannot list tutors",
    path: "/api/tutors",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Tutor cannot open organiser approval queues",
    path: "/api/organiser/approvals",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Tutor cannot create courses",
    path: "/api/courses",
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: bearerToken(personaTokens.TUTOR),
      },
      body: courseWriteBody,
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Organiser cannot open the Tutor dashboard",
    path: "/api/tutor/dashboard",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Organiser cannot open Student overflow",
    path: "/api/student/open-work",
    init: {
      headers: {
        accept: "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Organiser cannot write tutor availability",
    path: "/api/tutor/time-slots",
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: bearerToken(personaTokens.ORGANISER),
      },
      body: JSON.stringify({
        type: "BUSY",
        startsAt: "2030-09-04T14:00:00.000Z",
        endsAt: "2030-09-04T16:00:00.000Z",
      }),
    },
    expectStatus: 403,
    expectErrorCode: "FORBIDDEN",
  },
  {
    name: "Missing token is rejected on a read",
    path: "/api/me",
    init: { headers: { accept: "application/json" } },
    expectStatus: 401,
    expectErrorCode: "AUTHENTICATION_REQUIRED",
  },
  {
    name: "Missing token is rejected on a write",
    path: "/api/courses",
    init: {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: courseWriteBody,
    },
    expectStatus: 401,
    expectErrorCode: "AUTHENTICATION_REQUIRED",
  },
  {
    name: "Expired or tampered token is rejected",
    path: "/api/me",
    init: {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${tamperedToken(personaTokens.ORGANISER)}`,
      },
    },
    expectStatus: 401,
    expectErrorCode: "INVALID_ACCESS_TOKEN",
  },
];

interface ProbeOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

async function runProbe(probe: Probe): Promise<ProbeOutcome> {
  const url = new URL(probe.path, baseUrl);
  let lastDetail = "the request never completed";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...probe.init,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      const bodyText = await response.text();
      const problems: string[] = [];

      if (response.status !== probe.expectStatus) {
        problems.push(`expected HTTP ${probe.expectStatus}, got ${response.status}`);
      }

      let body: unknown = null;
      try {
        body = JSON.parse(bodyText);
      } catch {
        problems.push("response body is not JSON");
      }

      if (probe.expectErrorCode) {
        const code = (body as { error?: { code?: string } } | null)?.error?.code;
        if (code !== probe.expectErrorCode) {
          problems.push(`expected error code ${probe.expectErrorCode}, got ${String(code)}`);
        }
      }

      if (probe.expectProfileRole) {
        const role = (body as { data?: { profile?: { role?: string } } } | null)
          ?.data?.profile?.role;
        if (role !== probe.expectProfileRole) {
          problems.push(`expected profile role ${probe.expectProfileRole}, got ${String(role)}`);
        }
      }

      if (problems.length === 0) {
        return { name: probe.name, ok: true, detail: `HTTP ${response.status}` };
      }
      // A definite wrong answer is not retried.
      return { name: probe.name, ok: false, detail: problems.join("; ") };
    } catch (error) {
      lastDetail = error instanceof Error ? error.message : String(error);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  return { name: probe.name, ok: false, detail: lastDetail };
}

console.log(`Tutor Mx cross-role security smoke against ${baseUrl.origin}`);
console.log(`Started at ${new Date().toISOString()}`);
console.log("");

const outcomes: ProbeOutcome[] = [];
for (const probe of probes) {
  const outcome = await runProbe(probe);
  outcomes.push(outcome);
  console.log(`${outcome.ok ? "PASS" : "FAIL"}  ${outcome.name} (${outcome.detail})`);
}

const failures = outcomes.filter((outcome) => !outcome.ok);
console.log("");
console.log(
  `${outcomes.length - failures.length}/${outcomes.length} checks passed.`,
);

if (failures.length > 0) {
  console.log("");
  console.log(
    "One or more cross-role checks failed. Record each failure as a reproducible bug " +
      "(severity one/two security defects block release until fixed or formally recorded as a blocker).",
  );
  process.exitCode = 1;
}
