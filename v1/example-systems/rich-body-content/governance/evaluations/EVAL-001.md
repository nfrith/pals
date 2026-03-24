---
id: EVAL-001
title: Object Storage Provider Comparison
category: infrastructure
owner: platform-infra
outcome: approved
decided_on: 2026-02-28
---

# EVAL-001

## CONTEXT

The current S3-only storage architecture creates vendor lock-in and does not meet our latency requirements for the APAC region. We need to evaluate alternatives that support multi-region replication with better cost characteristics for our usage pattern: write-once, read-many, mostly files between 1KB and 50MB.

- Monthly storage volume is approximately 2TB with 800K read operations
- 60% of reads originate from APAC, 30% from North America, 10% from Europe
- Current monthly S3 bill is approximately $340 including transfer costs

## CANDIDATES

### AWS S3

The incumbent. Global presence, mature tooling, deep integration with our existing AWS infrastructure.

- Standard tier: $0.023/GB/month storage, $0.0004/1K GET requests
- Transfer out: $0.09/GB (first 10TB)
- Multi-region via S3 Replication Rules — replication is eventual, typically under 15 minutes

> From AWS pricing page: "S3 Cross-Region Replication (CRR) pricing includes the cost of replication PUT requests and inter-region data transfer."

Strengths:

- We already use it — zero migration cost for existing data
- Lifecycle policies, versioning, and event notifications are mature
- IAM integration with our existing permission model

Weaknesses:

- Transfer costs are the dominant expense at our read volume
- No native edge caching without CloudFront (additional complexity and cost)

### Cloudflare R2

S3-compatible API with zero egress fees. Runs on Cloudflare's edge network.

- Storage: $0.015/GB/month
- Class A operations (writes): $4.50/million
- Class B operations (reads): $0.36/million
- Egress: free

> R2 pricing as of 2026-02: "R2 does not charge for egress. There are no data transfer fees for reading data from R2."

```bash
# R2 is S3-compatible — existing SDK code works with endpoint override
aws s3 ls --endpoint-url https://ACCOUNT_ID.r2.cloudflarestorage.com s3://bucket-name
```

Strengths:

- Zero egress eliminates our largest cost line item
- S3-compatible API means minimal code changes
- Automatic edge distribution via Cloudflare network

Weaknesses:

- No native multi-region replication (single region with edge caching)
- Smaller ecosystem — no lifecycle policies, no event notifications
- Less mature than S3 for compliance and audit requirements

### Google Cloud Storage

Multi-regional storage class with integrated CDN via Cloud CDN.

- Standard storage: $0.020/GB/month (multi-region)
- Operations: $0.004/10K Class A, $0.0004/10K Class B
- Egress: $0.08/GB (APAC), $0.12/GB (inter-continental)

Strengths:

- Native multi-regional storage class replicates automatically
- Strong APAC presence with regions in Tokyo, Singapore, Sydney, and Mumbai
- Integrated with BigQuery for analytics on storage access patterns

Weaknesses:

- Egress costs comparable to S3
- Would require new IAM and credential management infrastructure
- No existing integration with our deployment pipeline

## CRITERIA

1. Total monthly cost at current usage (storage + operations + egress)
2. Read latency from APAC region (P50 and P99)
3. S3 API compatibility (migration effort)
4. Multi-region data durability guarantees
5. Operational maturity (monitoring, lifecycle management, audit logging)

## ANALYSIS

The comparison collapses quickly once cost, migration effort, and durability posture are placed side by side.

| Candidate | Estimated monthly cost | APAC latency outlook | Migration effort | Primary concern |
| --- | --- | --- | --- | --- |
| AWS S3 | ~$282 | Medium | Low | Egress remains the dominant cost line item. |
| Cloudflare R2 | ~$30 | High | Low | Multi-region durability and operational maturity are still weaker than S3. |
| Google Cloud Storage | ~$304 | Medium | High | It requires new IAM and deployment integration with no cost upside. |

### AWS S3 Cost Model

At current usage: $46 storage + $0.32 read ops + $145 APAC egress + $54 NA egress + $18 EU egress = approximately $263/month in a dual-region setup with replication.

The replication adds approximately $20/month for the PUT operations and cross-region transfer. Total: $283/month.

```
Storage:    2TB * $0.023         = $46.00
Reads:      800K * $0.0004/1K   =  $0.32
Egress:     480K APAC * avg 5MB * $0.09 = ~$216.00
Replication:                     = ~$20.00
Total:                            ~$282.32
```

### Cloudflare R2 Cost Model

At current usage: $30 storage + $0.29 read ops + $0 egress = approximately $30/month.

```
Storage:    2TB * $0.015         = $30.00
Reads:      800K * $0.36/1M     =  $0.29
Egress:                          =  $0.00
Total:                            ~$30.29
```

The cost difference is dramatic — R2 is 89% cheaper, entirely because of zero egress. The tradeoff is operational maturity and multi-region guarantees.

### Google Cloud Storage Cost Model

At current usage: $40 storage + $0.032 read ops + $192 APAC egress + $72 other egress = approximately $304/month.

No significant cost advantage over S3 and lacks our existing AWS integration.

## OUTCOME

Adopt Cloudflare R2 as the primary storage layer for new data. Keep S3 for existing data and compliance-sensitive workloads until R2's audit logging matures.

- The 89% cost reduction justifies the operational maturity tradeoff
- S3 API compatibility means the migration is a configuration change, not a code rewrite
- Edge caching compensates for the lack of native multi-region replication
- Revisit S3-to-R2 migration for existing data in Q3 2026 after evaluating R2's durability track record
