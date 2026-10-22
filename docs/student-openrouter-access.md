# Student OpenRouter Access Plan

This plan covers giving eligible Concrete students a $5 weekly OpenRouter allowance without putting a shared account key in the app download.

## Agreed settings

- Allowance: **$5 per student per week**.
- Reset: OpenRouter's weekly reset, Monday through Sunday at midnight UTC.
- App: Concrete.
- Model: `deepseek/deepseek-v4-flash-0731`, which is Concrete's current DeepSeek V4 Flash default.
- Inference route: OpenRouter, with DeepSeek as the only allowed upstream provider.
- Key expiry: 30 days after the student claims access.

OpenRouter currently exposes multiple DeepSeek V4 variants. The allowlist must use the exact slug above unless the course intentionally changes Concrete's model. See [OpenRouter's DeepSeek catalog](https://openrouter.ai/deepseek).

## Recommended design

1. Student downloads and installs Concrete.
2. On first use, Concrete opens a school sign-in / activation page.
3. Neon Auth verifies the student's email address. The enrollment service accepts addresses ending in `.edu` and checks that the student has not already claimed an allowance.
4. The service creates one OpenRouter API key for that student with a $5 weekly cap and a 30-day expiry, assigns a guardrail, and returns the key once over an authenticated TLS connection.
5. Concrete saves the key in the operating system's credential store and uses it for quiz and tutor requests.
6. An admin page lists students, key identifiers, allowance, usage, and status. The administrator can disable or delete a key to revoke it.

The OpenRouter management key must live only in the enrollment service's secret store. It must never be bundled in Concrete, sent to a student, or stored in the student's vault. OpenRouter returns the student key secret only at creation time, so the student key should be delivered once and then retained by Concrete in its local credential store.

## OpenRouter controls

Create a Guardrail allowing only model `deepseek/deepseek-v4-flash-0731` and provider `deepseek`, with a `$5` weekly budget. Assign it to every issued key. Also set the key's own spending limit to `$5` with `limit_reset: "weekly"`; this gives the key an independent cap in addition to the guardrail. Set `expires_at` to 30 days after issue.

In OpenRouter's terminology, the provider allowlist names the upstream inference provider. The app always calls OpenRouter's API; `deepseek` in the allowlist restricts which provider OpenRouter may route the model request to.

OpenRouter supports API-key creation with a USD limit, reset interval, expiry, and label, plus disabling or deleting keys. Its weekly periods reset at midnight UTC, Monday through Sunday. See [create a key](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key), [update a key](https://openrouter.ai/docs/api/api-reference/api-keys/update-an-api-key), and [Guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview).

## Concrete-specific notes

- The current default model is already `deepseek/deepseek-v4-flash-0731`.
- The Tutor AI settings currently offer other model choices, and some card-generation / fallback paths can request other models. An OpenRouter Guardrail is required to enforce the one-model policy. For a smoother student experience, Concrete should later have a sponsored-access mode that hides unsupported model choices and avoids presenting blocked fallback attempts as confusing errors.
- The current app accepts an OpenRouter key in local settings. The enrollment flow should save the issued key through the existing Electron main-process credential handling, not write it into settings JSON or Markdown files.
- Claude/Codex agent features are separate from Tutor AI. The sponsored plan described here covers OpenRouter-backed quiz and tutor usage only.

## Budget boundary

The $5 limit is per student, not a pooled class-wide budget. Ten student accounts can use up to **$50 per week**. The enrollment service uses ten fixed seats and does not reuse a seat after revocation or expiry, so it cannot issue an 11th student's key during this course. Do not automatically top up OpenRouter unless the possible spend is acceptable.

## Agreed deployment settings

- Accept verified email addresses whose domain ends in `.edu`.
- Allow at most **10 student accounts for the course**. This caps the nominal maximum at $50 per week; revoked seats are not reused.
- Expire a student's access **30 days after issue** (one month for this first course).
- Host the dashboard and enrollment API in the existing Vercel Next.js project at `projects/concrete-frontend`.
- Use Neon for Postgres and Neon Auth.

Neon documents a free tier with managed Better Auth and database resources. Its Vercel integration can inject Neon Auth URLs and configure trusted deployment domains when Auth is enabled. See [Neon's Vercel and Auth integration](https://neon.com/blog/auth-that-just-works-in-vercel-previews) and [Neon's current free plan](https://neon.com/blog/neon-free-plan-1-gb-per-project).

## Remaining setup needed from the instructor

1. **Neon:** create/connect a Neon project to the Vercel frontend and enable Neon Auth for production. Add the custom production domain as a trusted origin if applicable.
2. **OpenRouter:** create a management key after confirming Guardrails and API key management are available in the account/workspace. Store it as a Vercel environment secret named `OPENROUTER_MANAGEMENT_KEY`; do not paste it into chat or commit it.
3. **Admin identity:** set the verified email address that should be allowed into the instructor dashboard. It can be a non-`.edu` address; the admin allowlist is separate from student eligibility and should be set as `STUDENT_ACCESS_ADMIN_EMAIL` in Vercel.
4. **Database URL:** add the Neon pooled connection string to Vercel as `DATABASE_URL`.

The app implementation can be prepared before these services are configured, but sign-in and real key issuance will only work after Neon Auth, the environment variables, and the OpenRouter Guardrail ID are set.

## Rollout checklist

- Create the DeepSeek-only model/provider Guardrail and confirm the eligibility preview contains the desired model.
- Enroll one verified `.edu` test account and issue a $5 weekly key with a 30-day expiry.
- Confirm that the intended model works and another model is rejected by the Guardrail.
- Confirm the key stops working when disabled and that a fresh installation for the same identity does not issue a second allowance.
- Confirm the reset schedule in UTC and verify the displayed allowance is clearly per week.
- Start with a small cohort and inspect actual usage before increasing enrollment capacity.
