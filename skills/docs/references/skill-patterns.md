# Skill Decomposition Patterns

Reference for choosing how to decompose a module's interface into skills. Each module gets an array of skills — the question is what axis to decompose along.

## The Three Patterns

### CRUD

**Decomposition axis**: the operation verb.

One skill per generic verb, each handles all entity types in the module.

```
create-{module}   →  creates any entity type
get-{module}      →  reads any entity type
update-{module}   →  updates any entity type
remove-{module}   →  removes any entity type
```

**When it fits**: Simple modules with one entity type, or modules where all entities share the same lifecycle and the same operator mental model.

**When it breaks**: As soon as entities have different lifecycles. "Create a region" and "create a release" are different operations with different preconditions and invariants. Lumping them behind the same verb creates a skill that branches on entity type for everything.

### Lifecycle

**Decomposition axis**: domain intent — what the operator is trying to accomplish.

One skill per domain activity. Skill names come from the domain vocabulary, not generic verbs.

```
infra-provision        →  stands up new infrastructure
infra-deploy-release   →  manages the release lifecycle
infra-inspect          →  queries state
infra-maintain         →  day-2 ops, config changes, decommission
```

**When it fits**: Modules where entities share a hierarchy but have distinct operational phases. The operator thinks in activities ("I need to provision," "I need to deploy"), not in CRUD verbs.

**When it breaks**: If the module has multiple truly independent sub-domains that happen to share a namespace. The lifecycle skills start doing double duty and the same branching problem as CRUD returns, hidden behind nicer names.

### Aggregate-layer

**Decomposition axis**: natural entity groupings — which entities share churn rate, lifecycle, and invariant sets.

One skill per entity cluster. Read access is separated out.

```
infra-manage-topology  →  CRUD for regions, clusters, services (structural, low-churn)
infra-manage-releases  →  CRUD for releases (operational, high-churn)
infra-inspect          →  read-only across everything
```

**When it fits**: Modules where you can identify sub-aggregates — groups of entities that change together at the same cadence and enforce the same invariants.

**When it breaks**: Fewer, fatter skills mean each skill is more complex internally. If the operator's mental model doesn't align with the entity groupings, the interface feels unintuitive even if architecturally clean.

## The Spectrum

```
CRUD ──────────── Lifecycle ──────────── Aggregate-layer
least domain-aware                      most domain-aware
simplest to explain                     breaks first on complex modules
breaks first on complex modules         holds longest
```

## Selection Guide

| Signal | Points toward |
|--------|---------------|
| Single entity type | CRUD |
| Multiple entities, shared lifecycle | CRUD |
| Multiple entities, distinct operational activities | Lifecycle |
| Multiple entities, distinct churn rates / invariant sets | Aggregate-layer |
| Operator is non-technical | Lifecycle (intent-named skills are most intuitive) |

## Naming

Skill names should come from the operator's vocabulary, not from technical jargon. Ask the operator what they call these activities. A devops person says "provision" and "deploy," not "create" and "update."

For CRUD-pattern modules with a single entity type, simple verb-based names are fine: `create-{module}`, `get-{module}`, `update-{module}`, `remove-{module}`.

Treat those operator phrases as the base skill names. The default canonical ALS skill id should be `<module-id>-<base-skill-name>`.

Normalize redundant module wording once. For an `infra` module, prefer `infra-maintain` over `infra-maintain-infra`.
