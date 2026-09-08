/**
 * 极简进程内并发闸。模块化单体单实例架构下用于限制 Argon2id 等
 * CPU 密集计算的最大并发数；生产多实例部署属于既有非目标，不能依赖
 * 本进程内闸实现跨实例限流。
 */
export class ConcurrencyGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("ConcurrencyGate limit must be a positive integer");
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.waiters.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next();
      return;
    }
    this.active -= 1;
  }
}
