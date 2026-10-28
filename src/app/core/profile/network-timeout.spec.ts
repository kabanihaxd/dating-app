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

  it('keeps the original server error', async () => {
    const error = new Error('permission-denied');
    await expect(withNetworkTimeout(Promise.reject(error), window, 1000)).rejects.toBe(error);
  });
});
