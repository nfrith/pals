---
id: REG-EUW1
name: EU West 1
provider: aws
status: active
---

# REG-EUW1

## OVERVIEW

Secondary production region serving European traffic. Hosts a replica of the API stack and a read replica of the primary database. Required for GDPR data residency compliance for EU-based customers.

- Serves approximately 25% of total production traffic
- Contains read replicas and a subset of compute workloads
- Data residency boundary: EU customer PII must not leave this region

## CAPACITY

- EC2 compute: 16 vCPUs allocated, 38% utilized at peak
- RDS: db.r6g.xlarge read replica, 22% CPU at peak
- EBS: 500GB provisioned IOPS, 340GB used
- NAT Gateway throughput: averaging 600 Mbps during business hours
