# deployment / runbook

Preflight -> approve -> apply -> verify -> rollback. Steps live in the
`deployment-safety` skill checklist. The active deploy script location is not
confirmed in-repo — verify it before use.

Never push / SSH / restart PM2 / modify Nginx / run migrations without explicit
approval after the preflight.
