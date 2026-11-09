# Benchmark evidence

- [Results](RESULTS.md): completion-aware comparison and all-case outcomes.
- [Independent audit](AUDIT.md): integrity and sampled causal checks.
- `initial/`: original frozen53-pair experiment, all106records retained.
- `aborted-recovery/`: rejected diagnostic attempt; not an efficacy dataset.
- `recovery/`: separately accepted seven-pair recovery; all 14 arm runs completed.
- `recovered-composite.json`: explicitly secondary multi-epoch selection of all 53 pairs.

Each cohort includes its frozen manifest, per-arm rows and score summary when
complete. `native-events.jsonl.gz` is UTF-8 JSONL after decompression: one object
per case/arm, with its native event array. Local paths and ephemeral thread IDs
are normalized. The index records original trace SHA256 and published normalized
record SHA256, plus the gzip hash. Original trace/stderr hashes refer to locally
retained originals; stderr contents are not published. These traces contain only
public benchmark source and agent outputs; public synthetic test config is fixture
material, not an operator credential. No authentication files were copied.

The dataset is pinned to the MIT-licensed upstream repository linked in
[the protocol](../../benchmark.md); original commit/tree attribution is in each
manifest and row. The original [upstream MIT notice](UPSTREAM-LICENSE) is preserved
byte-for-byte because the event traces include substantial upstream source.
Synthetic-provider canaries are unscored control tests, distinct
from real-provider scored runs.
