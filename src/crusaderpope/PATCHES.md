# Local patches to CrusaderPope code

Everything under `src/crusaderpope/` is CrusaderPope's code, copied verbatim from
upstream (`src/<path>` there is `src/crusaderpope/<path>` here) so a new release
syncs by copying the same files over. The few lines that had to change are listed
here: re-apply them after a sync, or drop them once upstream no longer needs them.

| File | Change | Why |
| --- | --- | --- |
| `main/shaders/pool.ts` | `p.reject(err)` → `p.reject(err as Error)` in the worker `'error'` handler | Skonester's `@types/node` (26) types a worker error as `unknown`; upstream builds against 22 |
