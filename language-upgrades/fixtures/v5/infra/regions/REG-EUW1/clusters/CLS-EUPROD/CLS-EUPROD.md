---
id: CLS-EUPROD
name: EU West Production
region_ref: "[EU West 1](als://reference-system/infra/region/REG-EUW1)"
orchestrator: kubernetes
status: active
---

# CLS-EUPROD

## CONFIGURATION

EKS cluster running Kubernetes 1.29, smaller footprint than the US primary. Shares the same Helm charts and deployment manifests.

- Control plane: EKS managed, multi-AZ (eu-west-1a, eu-west-1b)
- Node group `general`: 2x m6i.large (2 vCPU, 8GB each), autoscaling 2-4
- Pod limit per node: 29 (ENI-based, smaller instance type)

```yaml
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
managedNodeGroups:
  - name: general
    instanceType: m6i.large
    minSize: 2
    maxSize: 4
    desiredCapacity: 2
```

## NETWORKING

Separate VPC from the US region. Cross-region traffic flows through VPC peering for database replication only.

> EU cluster must NOT route application traffic to the US region. GDPR requires that EU customer requests are served entirely within the EU data boundary.

- VPC CIDR: 10.2.0.0/16
- Pod CIDR: 10.3.0.0/16
- Service CIDR: 172.21.0.0/16
- VPC peering to US East VPC for database replication only (no application traffic)

```bash
# Verify no cross-region application traffic
kubectl logs -l app=api-gateway --since=1h | grep -c "10.0."
# Expected: 0 (no connections to US East VPC CIDR)
```

## NOTES

null
