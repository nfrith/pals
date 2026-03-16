---
module_id: experiments
namespace: workspace
uri_scheme: pals
module_version: 2
schema_version: 2
entity_paths:
  program: programs/<PROGRAM-ID>/<PROGRAM-ID>.md
  experiment: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/<EXPERIMENT-ID>.md
  run: programs/<PROGRAM-ID>/experiments/<EXPERIMENT-ID>/runs/<RUN-ID>.md
references:
  modules:
    - namespace: workspace
      module_id: people
---
