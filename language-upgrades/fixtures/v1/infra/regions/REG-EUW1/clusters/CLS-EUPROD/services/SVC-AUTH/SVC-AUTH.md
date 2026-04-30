---
id: SVC-AUTH
name: Authentication Service
cluster_ref: "[EU West Production](als://reference-system/infra/region/REG-EUW1/cluster/CLS-EUPROD)"
runtime: go
replicas: 2
status: healthy
---

# SVC-AUTH

## DEPLOYMENT_CONFIG

### Container

Go binary compiled with CGO disabled for a static binary. Handles JWT issuance, validation, and session management.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: auth-service
          image: registry.example.com/auth-service:latest
          ports:
            - containerPort: 8080
          resources:
            requests:
              cpu: 250m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 256Mi
```

### Security

> The auth service has access to the token signing key. It runs with a dedicated service account and restrictive network policy — only the API gateway and internal admin tools can reach it.

- Service account: `auth-service-sa` with IRSA for KMS access
- Network policy: ingress only from `app=api-gateway` and `app=admin-tools`
- Token signing key stored in AWS KMS, accessed via IRSA

## DEPENDENCIES

- AWS KMS (external) for token signing key material
- PostgreSQL read replica via internal DNS: `db-replica-eu.internal.example.com:5432`
- Redis session store: `session-cache-eu.internal.example.com:6379`

## HEALTH_CHECKS

The auth service exposes gRPC health checks in addition to HTTP.

```bash
# HTTP health check
curl -f http://localhost:8080/healthz
# Returns 200 with {"status":"serving"}

# gRPC health check (requires grpcurl)
grpcurl -plaintext localhost:8080 grpc.health.v1.Health/Check
# Returns {"status":"SERVING"}
```

- HTTP readiness: GET /healthz, period 10s, checks KMS connectivity and database read
- gRPC health: used by service mesh for load balancing decisions
- Go runtime metrics exposed on /debug/vars for Prometheus scraping
