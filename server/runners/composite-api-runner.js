export class CompositeApiRunner {
  constructor({ cms, editorial }) {
    this.runners = { cms, editorial };
  }

  createSession() {
    return Object.fromEntries(Object.entries(this.runners).map(([protocol, runner]) => [protocol, runner?.createSession?.() || {}]));
  }

  async execute(step, context) {
    const protocol = step.request?.protocol || 'cms';
    const runner = this.runners[protocol];
    if (!runner) throw new Error(`API runner is unavailable: ${protocol}`);
    const session = context.apiSession ||= this.createSession();
    return runner.execute(step, { ...context, apiSession: session[protocol] ||= {} });
  }
}
