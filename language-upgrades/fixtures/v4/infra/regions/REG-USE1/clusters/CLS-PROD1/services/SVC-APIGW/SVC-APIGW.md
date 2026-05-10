---
id: SVC-APIGW
name: API Gateway
cluster_ref: "[US East Production Primary](als://reference-system/infra/region/REG-USE1/cluster/CLS-PROD1)"
runtime: node
replicas: 3
status: healthy
---

# SVC-APIGW

## DEPLOYMENT_CONFIG

### Container

Node.js 20 LTS running Express with TypeScript. The container includes a Prisma client for database access and a Pino logger for structured output.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-gateway
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api-gateway
          image: registry.example.com/api-gateway:latest
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: "1"
              memory: 1Gi
          env:
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
```

### Resource Limits

> Memory limit is set to 1Gi based on observed peak usage of 680Mi. If you see OOMKilled events, investigate for memory leaks before increasing the limit.

- CPU request 500m gives guaranteed baseline; limit of 1 core handles burst
- Horizontal Pod Autoscaler targets 70% CPU utilization, scaling 3-8 replicas

## DEPENDENCIES

- PostgreSQL primary (RDS) via internal DNS: `db-primary.internal.example.com:5432`
- Redis cache via Elasticache: `cache.internal.example.com:6379`
- Auth service via cluster DNS: `auth-service.default.svc.cluster.local:8080`
- Stripe API (external): `api.stripe.com:443`
- SendGrid API (external): `api.sendgrid.com:443`

## HEALTH_CHECKS

Liveness and readiness probes on separate endpoints.

```bash
# Readiness — checks database connectivity
curl -f http://localhost:3000/health/ready
# Returns 200 with {"status":"ready","db":"connected","cache":"connected"}

# Liveness — checks process is responsive
curl -f http://localhost:3000/health/live
# Returns 200 with {"status":"alive","uptime":12345}
```

- Readiness probe: HTTP GET /health/ready, period 10s, failure threshold 3
- Liveness probe: HTTP GET /health/live, period 30s, failure threshold 5
- Startup probe: HTTP GET /health/live, period 5s, failure threshold 12 (allows 60s startup)
