# Studio Checks

Chores runs `gh workflow run Checks --ref BRANCH` for review rounds. This runs
both Checks and exact-pair owner acceptance on Ubuntu only.

For the integration batch, use `gh workflow run Checks --ref land/batch -f all_oses=true`.
Verify the exact batch SHA and success of both jobs on each of the three OSes
before moving `main`. A Linux review run is not batch qualification. A main push
reuses a successful exact-SHA Checks run only if all six jobs actually passed;
otherwise it runs all three OSes. A skip-only run is not reusable evidence.
