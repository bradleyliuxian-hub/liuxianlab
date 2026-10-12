---
description: Prepare production deployment preflight; do not deploy automatically
agent: deployer
---
Prepare deployment preflight for:

$ARGUMENTS

Do not execute production deployment actions unless the user explicitly asks after seeing the preflight.

Return an ordered deployment checklist, health checks, and rollback steps.
