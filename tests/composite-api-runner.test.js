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

  it('routes Flywheel requests to an isolated Flywheel session', async () => {
    const cms = { createSession: vi.fn(() => ({ protocol: 'cms' })), execute: vi.fn() };
    const editorial = { createSession: vi.fn(() => ({ protocol: 'editorial' })), execute: vi.fn() };
    const flywheel = {
      createSession: vi.fn(() => ({ protocol: 'flywheel' })),
      execute: vi.fn(async (_step, context) => ({ variables: { sessionProtocol: context.apiSession.protocol } }))
    };
    const runner = new CompositeApiRunner({ cms, editorial, flywheel });
    const context = { apiSession: runner.createSession() };

    const result = await runner.execute({ request: { protocol: 'flywheel' } }, context);

    expect(cms.execute).not.toHaveBeenCalled();
    expect(editorial.execute).not.toHaveBeenCalled();
    expect(flywheel.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiSession: { protocol: 'flywheel' } }));
    expect(result.variables).toEqual({ sessionProtocol: 'flywheel' });
  });

  it('routes Daygf requests to an isolated Daygf session', async () => {
    const cms = { createSession: vi.fn(() => ({ protocol: 'cms' })), execute: vi.fn() };
    const editorial = { createSession: vi.fn(() => ({ protocol: 'editorial' })), execute: vi.fn() };
    const flywheel = { createSession: vi.fn(() => ({ protocol: 'flywheel' })), execute: vi.fn() };
    const daygf = {
      createSession: vi.fn(() => ({ protocol: 'daygf' })),
      execute: vi.fn(async (_step, context) => ({ variables: { sessionProtocol: context.apiSession.protocol } }))
    };
    const runner = new CompositeApiRunner({ cms, editorial, flywheel, daygf });
    const context = { apiSession: runner.createSession() };

    const result = await runner.execute({ request: { protocol: 'daygf' } }, context);

    expect(cms.execute).not.toHaveBeenCalled();
    expect(editorial.execute).not.toHaveBeenCalled();
    expect(flywheel.execute).not.toHaveBeenCalled();
    expect(daygf.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiSession: { protocol: 'daygf' } }));
    expect(result.variables).toEqual({ sessionProtocol: 'daygf' });
  });

  it('routes BY requests to an isolated BY session', async () => {
    const cms = { createSession: vi.fn(() => ({ protocol: 'cms' })), execute: vi.fn() };
    const by = {
      createSession: vi.fn(() => ({ protocol: 'by' })),
      execute: vi.fn(async (_step, context) => ({ variables: { sessionProtocol: context.apiSession.protocol } }))
    };
    const runner = new CompositeApiRunner({ cms, by });
    const context = { apiSession: runner.createSession() };

    const result = await runner.execute({ request: { protocol: 'by' } }, context);

    expect(cms.execute).not.toHaveBeenCalled();
    expect(by.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ apiSession: { protocol: 'by' } }));
    expect(result.variables).toEqual({ sessionProtocol: 'by' });
  });
});
