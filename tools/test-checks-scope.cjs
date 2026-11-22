const assert = require('node:assert/strict');
const test = require('node:test');
const { scope } = require('./checks-scope.cjs');

const all = ['ubuntu-22.04', 'macos-15', 'windows-latest'];
const review = { eventName: 'workflow_dispatch', ref: 'refs/heads/task/example' };
const push = { eventName: 'push', ref: 'refs/heads/main', sha: 'current', runId: 1,
  repo: { owner: 'owner', repo: 'studio' }, payload: { repository: { id: 42 } } };
const fullRun = { id: 2, head_sha: push.sha, status: 'completed', conclusion: 'success',
  run_attempt: 1, head_repository: { id: 42 }, event: 'workflow_dispatch', html_url: 'batch-run' };
const jobs = all.flatMap(os => [`Checks on ${os}`, `Required exact-pair owner acceptance (${os}) / owner`])
  .map(name => ({ name, status: 'completed', conclusion: 'success' }));
function api(runs, byRun) {
  const actions = { listWorkflowRuns() {}, listJobsForWorkflowRun() {} };
  return { rest: { actions }, paginate(method, params) {
    if (method === actions.listWorkflowRuns) {
      assert.equal(params.workflow_id, 'ci.yml');
      assert.equal(params.head_sha, push.sha);
      return runs;
    }
    return byRun[params.run_id];
  } };
}

test('review is Linux-only and batch explicitly requests all OSes without reuse', async () => {
  assert.deepEqual(await scope({ context: review }), { oses: all.slice(0, 1) });
  assert.deepEqual(await scope({ context: review, allOses: true }), { oses: all });
});
test('main push reuses only an exact successful full run', async () => {
  const linux = { ...fullRun, id: 3, html_url: 'linux-run' };
  const github = api([linux, fullRun], { 2: jobs, 3: jobs.slice(0, 2) });
  assert.deepEqual(await scope({ github, context: push }), { oses: all, reused: 'batch-run' });
});
test('missing, skipped or ambiguous jobs and wrong-run evidence never qualify', async () => {
  for (const evidence of [jobs.slice(0, -1), [...jobs, jobs[0]],
    jobs.map(job => ({ ...job, conclusion: 'skipped' }))]) {
    assert.deepEqual(await scope({ github: api([fullRun], { 2: evidence }), context: push }), { oses: all });
  }
  for (const override of [{ head_sha: 'old' }, { id: 1 }, { run_attempt: 2 },
    { head_repository: { id: 43 } }, { conclusion: 'failure' }]) {
    assert.deepEqual(await scope({ github: api([{ ...fullRun, ...override }], { 2: jobs, 1: jobs }), context: push }), { oses: all });
  }
});
test('lookup failure falls back to all OSes', async () => {
  const github = api([], {});
  github.paginate = () => { throw Error('unavailable'); };
  assert.deepEqual(await scope({ github, context: push }), { oses: all, evidenceUnavailable: true });
});
