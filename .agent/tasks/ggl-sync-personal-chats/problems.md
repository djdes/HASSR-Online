# Verification findings

- The first type check used a locally generated Prisma client that predates the upstream organization-trial fields. It reported missing `trialEndsAt` and `orgTrialsGranted` in unrelated billing and organization code. Regenerate the local Prisma client from current master and run the checks again.
