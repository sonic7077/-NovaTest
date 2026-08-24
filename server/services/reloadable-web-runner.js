export function createReloadableWebRunner({ current } = {}) {
  if (!current?.execute) throw new Error('a ready Web runner is required');
  let activeRunner = current;

  return {
    snapshot() {
      return activeRunner;
    },
    async replace(candidate) {
      const next = await candidate;
      if (!next?.execute) throw new Error('replacement Web runner is invalid');
      activeRunner = next;
      return activeRunner;
    },
    async execute(...args) {
      return activeRunner.execute(...args);
    },
    async finish(...args) {
      return activeRunner.finish?.(...args);
    },
    async createWorker(...args) {
      if (typeof activeRunner.createWorker !== 'function') return undefined;
      return activeRunner.createWorker(...args);
    }
  };
}
