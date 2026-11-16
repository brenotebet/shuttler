// __tests__/utils.firestoreReconnect.test.ts
import {
  createReconnector,
  isFeedStalled,
  shouldRestartAfterBackground,
  FEED_STALL_MS,
  FOREGROUND_RESTART_AFTER_MS,
  MIN_RESTART_INTERVAL_MS,
} from '../src/utils/firestoreReconnect';

describe('shouldRestartAfterBackground', () => {
  it('restarts only after a meaningful time in the background', () => {
    expect(shouldRestartAfterBackground(null)).toBe(false);
    expect(shouldRestartAfterBackground(FOREGROUND_RESTART_AFTER_MS - 1)).toBe(false);
    expect(shouldRestartAfterBackground(FOREGROUND_RESTART_AFTER_MS)).toBe(true);
  });
});

describe('isFeedStalled', () => {
  it('flags a live feed that went quiet', () => {
    expect(isFeedStalled(0, true, FEED_STALL_MS)).toBe(true);
  });
  it('ignores a quiet feed that has nothing live to report', () => {
    expect(isFeedStalled(0, false, FEED_STALL_MS * 10)).toBe(false);
  });
  it('ignores a feed that updated recently or never started', () => {
    expect(isFeedStalled(0, true, FEED_STALL_MS - 1)).toBe(false);
    expect(isFeedStalled(null, true, FEED_STALL_MS * 10)).toBe(false);
  });
});

describe('createReconnector', () => {
  function setup() {
    let t = 1_000_000;
    const calls: string[] = [];
    const r = createReconnector({
      disableNetwork: async () => { calls.push('disable'); },
      enableNetwork: async () => { calls.push('enable'); },
      now: () => t,
    });
    return { r, calls, advance: (ms: number) => { t += ms; } };
  }

  it('disables then re-enables the network', async () => {
    const { r, calls } = setup();
    await expect(r.restart('test')).resolves.toBe(true);
    expect(calls).toEqual(['disable', 'enable']);
  });

  it('throttles restarts', async () => {
    const { r, calls, advance } = setup();
    await r.restart('a');
    advance(MIN_RESTART_INTERVAL_MS - 1);
    await expect(r.restart('b')).resolves.toBe(false);
    advance(1);
    await expect(r.restart('c')).resolves.toBe(true);
    expect(calls).toEqual(['disable', 'enable', 'disable', 'enable']);
  });

  it('shares one restart between concurrent callers', async () => {
    const { r, calls } = setup();
    const [a, b] = await Promise.all([r.restart('a'), r.restart('b')]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toEqual(['disable', 'enable']);
  });

  it('re-enables the network even if disabling fails', async () => {
    const calls: string[] = [];
    const r = createReconnector({
      disableNetwork: async () => { calls.push('disable'); throw new Error('boom'); },
      enableNetwork: async () => { calls.push('enable'); },
    });
    await expect(r.restart('x')).rejects.toThrow('boom');
    expect(calls).toEqual(['disable', 'enable']);
  });
});
