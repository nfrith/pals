---
id: CLS-PROD1
name: US East Production Primary
region_ref: "[US East 1](als://reference-system/infra/region/REG-USE1)"
orchestrator: kubernetes
status: active
---

# CLS-PROD1

## CONFIGURATION

EKS cluster running Kubernetes 1.29 with managed node groups.

- Control plane: EKS managed, multi-AZ
- Node group `general`: 3x m6i.xlarge (4 vCPU, 16GB each), autoscaling 3-6
- Node group `memory`: 2x r6i.xlarge (4 vCPU, 32GB each), autoscaling 2-4
- Pod limit per node: 58 (ENI-based)

```yaml
# Node group configuration
apiVersion: eksctl.io/v1alpha5
kind: ClusterConfig
managedNodeGroups:
  - name: general
    instanceType: m6i.xlarge
    minSize: 3
    maxSize: 6
    desiredCapacity: 3
```

## NETWORKING

VPC with three availability zones. All service-to-service traffic stays within the VPC.

> The cluster uses Calico for network policy enforcement. Default deny is enabled — every new service must declare its ingress and egress rules explicitly.

- VPC CIDR: 10.0.0.0/16
- Pod CIDR: 10.1.0.0/16 (Calico IPAM)
- Service CIDR: 172.20.0.0/16
- Ingress: AWS ALB Ingress Controller with TLS termination

```bash
# Verify network policies are enforced
kubectl get networkpolicy -A | grep -c "default-deny"
```

## NOTES

- The cluster was upgraded from 1.28 to 1.29 on 2026-02-01. No issues observed.
- Spot instances are not used in production node groups due to the stateful nature of some workloads. Staging uses spot exclusively.
