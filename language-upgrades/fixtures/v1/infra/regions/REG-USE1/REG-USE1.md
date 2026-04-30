---
id: REG-USE1
name: US East 1
provider: aws
status: active
---

# REG-USE1

## OVERVIEW

Primary production region serving North American traffic. Hosts the majority of compute and storage workloads. This region was chosen for its proximity to our largest customer base and its mature AWS service availability.

- Serves approximately 70% of total production traffic
- Contains our primary database instances and object storage
- Latency to major US population centers is under 30ms

## CAPACITY

- EC2 compute: 48 vCPUs allocated, 62% utilized at peak
- RDS: db.r6g.2xlarge primary with read replica, 45% CPU at peak
- EBS: 2TB provisioned IOPS, 1.3TB used
- NAT Gateway throughput: averaging 2.1 Gbps during business hours
