import { describe, expect, it, vi } from 'vitest';
import { CompositeApiRunner } from '../server/runners/composite-api-runner.js';

describe('Composite API runner', () => {
  it('routes Editorial requests to an isolated Editorial session', async () => {
    const cms = { createSession: vi.fn(() => ({ protocol: 'cms' })), execute: vi.fn() };
    const editorial = {
      createSession: vi.fn(() => ({ protocol: 'editorial' })),
      execute: vi.fn(async (_step, context) => ({ variables: { sessionProtocol: context.apiSession.protocol } }))
    };
    const runner = new CompositeApiRunner({ cms, editorial });
    const context = { apiSession: runner.createSession() };

    const result = await runner.execute({ request: { protocol: 'editorial' } }, context);

    expect(cms.execute).not.toHaveBeenCalled();
    expect(editorial.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiSession: { protocol: 'editorial' } }));
    expect(result.variables).toEqual({ sessionProtocol: 'editorial' });
  });
});
