---
id: PROTO-002
title: API Key Rotation with Zero Downtime
domain: security
status: active
---

# PROTO-002

## PURPOSE

This protocol rotates API keys for external service integrations without causing request failures. It uses a dual-key window where both the old and new keys are valid simultaneously, then decommissions the old key after confirming the new one is in use.

## PREREQUISITES

- Access to the secret management system (1Password or Vault)
- Deployment pipeline permissions to update environment variables
- The service supports multiple active keys or a key rotation grace period

> Not all services support dual-key windows. Check the service's documentation before starting. If the service invalidates the old key immediately on rotation, coordinate a maintenance window instead.

```bash
# Verify you have access to update secrets
op vault list | grep -q "production-secrets" && echo "Access confirmed"
```

## STEPS

### Generate New Key

1. Generate the new API key in the service's dashboard or API

> Do not delete or deactivate the old key yet. Both keys must be valid simultaneously during the transition.

2. Store the new key in the secret management system with a `_NEW` suffix:

```bash
op item edit "Service API Key" \
  "new_key=sk_live_new_abc123..." \
  --vault production-secrets
```

### Deploy with New Key

3. Update the application configuration to use the new key:

```bash
kubectl set env deployment/api-server \
  SERVICE_API_KEY="sk_live_new_abc123..." \
  -n production
```

4. Wait for the rolling deployment to complete:

```bash
kubectl rollout status deployment/api-server -n production --timeout=300s
```

5. Verify requests are succeeding with the new key by checking application logs:

```bash
kubectl logs -l app=api-server -n production --since=5m | grep "service_name" | tail -20
```

### Decommission Old Key

6. After confirming the new key is working (minimum 30 minutes of healthy traffic), revoke the old key in the service's dashboard

7. Remove the `_NEW` suffix from the secret management entry:

```bash
op item edit "Service API Key" \
  "key=sk_live_new_abc123..." \
  --vault production-secrets
```

8. Clean up the old key value from the secret management system

## ROLLBACK

If the new key causes authentication failures after deployment:

> The old key is still active during the dual-key window. Revert immediately — do not debug in production.

1. Revert the environment variable to the old key:

```bash
kubectl set env deployment/api-server \
  SERVICE_API_KEY="sk_live_old_abc123..." \
  -n production
```

2. Wait for rollout and verify traffic is healthy:

```bash
kubectl rollout status deployment/api-server -n production --timeout=300s
```

3. Investigate the new key failure in staging before re-attempting

## VALIDATION

1. Confirm the new key is the active key in the running pods:

```bash
kubectl exec -it deployment/api-server -n production -- printenv SERVICE_API_KEY | head -c 12
```

2. Confirm the old key is revoked by testing it directly:

```bash
curl -H "Authorization: Bearer sk_live_old_abc123..." https://service.example.com/v1/health
# Expected: 401 Unauthorized
```

3. Verify no authentication errors in the last hour of application logs

## NOTES

- Rotate keys on a regular schedule (quarterly minimum), not just when compromised. Predictable rotation reduces the blast radius of an undetected leak.
- Log which key is in use (by prefix or last 4 characters, never the full key) so you can audit which key served which requests during the transition window.
