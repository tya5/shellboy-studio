# Work Row Consumer Map

The Console consumes issued projected items through workElementDisplay, or exact
associated workExecutionDisplay for each execution, then the pure formatter and
shared WorkElementRow. CASE remains the only Work classifier. Output body/watch,
execution identity, controlled disclosure choice and scroll keys remain owned by
the existing tool adapter. The shared row owns the only details element.

## Scope Rejection

scopeIssuedWorkFacts accepts issued Work records and receipt presence only.
Already-scoped saved facts and owned handoff text follow their original path.
An undefined batch is a rejected cut, not a successfully empty Work publication.
The Console explicitly marks that entire Work cut unavailable, while retaining
independently qualified current saved/owned handoff facts. No previous projection
cache, stale ref revival, arbitrary spread issuance or retry/read is introduced.

The marker is a projection-level CLIENT input-validation status with stable key
work-scope-rejected and fixed reason scope-qualification-rejected. It is NOT a
public payload kind, wire error, CASE fact, Work notification or history/node/
execution identity; it contributes no Work category/count. It never displays the
rejected sources' IDs or bodies. Repeating the same rejected render retains its
status DOM identity; valid recovery removes it. Revoked public refs authorize
neither old saved text nor this status. Existing actual consumer control covers
valid issued + unissued foreign mixture, independent saved content, repeat,
recovery and reader disposal without a fabricated current validator.
