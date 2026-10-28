import { NetworkTimeoutError, withNetworkTimeout } from './network-timeout';

describe('withNetworkTimeout', () => {
  it('passes the answer through when the server replies in time', async () => {
    await expect(withNetworkTimeout(Promise.resolve('ok'), window, 1000)).resolves.toBe('ok');
  });

  it('gives up when the server is silent too long', async () => {
    const never = new Promise<void>(() => undefined);
    await expect(withNetworkTimeout(never, window, 10)).rejects.toBeInstanceOf(NetworkTimeoutError);
  });

  it('gives up as soon as the browser goes offline', async () => {
    const never = new Promise<void>(() => undefined);
    const result = withNetworkTimeout(never, window, 60_000);
    window.dispatchEvent(new Event('offline'));
    await expect(result).rejects.toBeInstanceOf(NetworkTimeoutError);
  });

  it('hands back the queued write so the page can tell when it finally lands', async () => {
    let land!: () => void;
    const queued = new Promise<void>((resolve) => (land = resolve));
    const error = await withNetworkTimeout(queued, window, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkTimeoutError);
    land();
    await expect((error as NetworkTimeoutError).pending).resolves.toBeUndefined();
  });

  it('keeps the original server error', async () => {
    const error = new Error('permission-denied');
    await expect(withNetworkTimeout(Promise.reject(error), window, 1000)).rejects.toBe(error);
  });
});
