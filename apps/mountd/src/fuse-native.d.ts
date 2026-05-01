declare module "fuse-native" {
  export default class Fuse {
    static ENOENT: number;
    static EISDIR: number;
    static ENOTDIR: number;
    static EROFS: number;
    static EACCES: number;
    static EINVAL: number;
    static ENOTEMPTY: number;
    static ENOTSUP: number;
    static EBUSY: number;
    static EBADF: number;
    static isConfigured?(callback: (error: Error | null, configured?: boolean) => void): void;

    constructor(mountpoint: string, operations: Record<string, unknown>, options?: Record<string, unknown>);
    mount(callback: (error?: Error | null) => void): void;
    unmount(callback: (error?: Error | null) => void): void;
  }
}
