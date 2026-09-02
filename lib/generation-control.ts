export function checkGenerationStopped(signal?: AbortSignal, shouldAbort?: () => boolean) {
  signal?.throwIfAborted();
  if (shouldAbort?.()) throw new DOMException('已停止生成', 'AbortError');
}

// Settle every worker before releasing a run, so old requests cannot write into a new run.
export async function runGenerationJobs<T>(
  jobs: T[],
  concurrency: number,
  runJob: (job: T, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
  shouldAbort?: () => boolean,
) {
  const controller = new AbortController();
  const runSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  checkGenerationStopped(runSignal, shouldAbort);
  const queue = jobs.slice();
  async function worker() {
    try {
      while (queue.length) {
        checkGenerationStopped(runSignal, shouldAbort);
        const job = queue.shift()!;
        await runJob(job, runSignal);
        checkGenerationStopped(runSignal, shouldAbort);
      }
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  checkGenerationStopped(runSignal, shouldAbort);
}
