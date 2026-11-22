const oses = ['ubuntu-22.04', 'macos-15', 'windows-latest'];
const requiredJobs = oses.flatMap(os => [
  `Checks on ${os}`,
  `Required exact-pair owner acceptance (${os}) / owner`,
]);

async function scope({ github, context, allOses }) {
  if (context.eventName !== 'push' || context.ref !== 'refs/heads/main') {
    return { oses: allOses ? oses : oses.slice(0, 1) };
  }
  try {
    const { actions } = github.rest;
    const runs = await github.paginate(actions.listWorkflowRuns, {
      ...context.repo, workflow_id: 'ci.yml', head_sha: context.sha, status: 'success', per_page: 100,
    });
    for (const run of runs) {
      if (run.id === context.runId || run.head_sha !== context.sha || run.status !== 'completed' ||
          run.conclusion !== 'success' || run.run_attempt !== 1 ||
          run.head_repository?.id !== context.payload.repository.id ||
          !['push', 'workflow_dispatch'].includes(run.event)) continue;
      const jobs = await github.paginate(actions.listJobsForWorkflowRun, {
        ...context.repo, run_id: run.id, filter: 'latest', per_page: 100,
      });
      if (requiredJobs.every(name => {
        const matches = jobs.filter(job => job.name === name);
        return matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success';
      })) return { oses, reused: run.html_url };
    }
    return { oses };
  } catch {
    return { oses, evidenceUnavailable: true };
  }
}

module.exports = { scope };
