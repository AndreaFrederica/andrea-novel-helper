declare module 'webdav' {
  /** 兼容 Node / 浏览器的二进制类型 */
  export type BufferLike = Buffer | ArrayBuffer | Uint8Array;

  /** 认证类型 */
  export enum AuthType {
    None = "none",
    Auto = "auto",
    Password = "password",
    Digest = "digest",
    Token = "token",
  }

  /** OAuth token（简化） */
  export interface OAuthToken {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    refresh_token?: string;
    [key: string]: any;
  }

  /** 客户端全局配置 */
  export interface WebDAVClientOptions {
    authType?: AuthType | null;
    username?: string;
    password?: string;
    /** Digest 预计算的 HA1，可替代明文密码 */
    ha1?: string;
    token?: OAuthToken;
    /** 发送到所有请求的额外 headers（会被方法级 headers 覆盖） */
    headers?: Record<string, string>;
    /** 自定义 HTTP/HTTPS Agent（仅 Node） */
    httpsAgent?: any;
    httpAgent?: any;
    /** 在锁请求中使用的 contact URL */
    contactHref?: string;
    /** 自定义解析 props 属性时的属性名前缀（详见 README） */
    attributeNamePrefix?: string;
    /** 是否携带凭证（主要浏览器环境） */
    withCredentials?: boolean;

    /** ↓ 以下是 v4 时代 axios 的遗留字段，v5 已不再使用（可忽略） */
    /** @deprecated */
    maxContentLength?: number;
    /** @deprecated */
    maxBodyLength?: number;
  }

  /** 统一的方法选项：允许自定义 headers/中止信号/自定义 body */
  export interface WebDAVMethodOptions {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** 部分方法允许自定义底层请求体（如 PROPFIND body 或 SEARCH body） */
    data?: any;
  }

  export interface CreateDirectoryOptions extends WebDAVMethodOptions {
    recursive?: boolean;
  }

  export interface CreateReadStreamOptions extends WebDAVMethodOptions {
    range?: { start: number; end?: number };
  }

  export interface CreateWriteStreamOptions extends WebDAVMethodOptions {
    overwrite?: boolean;
  }

  export interface GetFileContentsOptions extends WebDAVMethodOptions {
    format?: 'binary' | 'text';
    details?: boolean;
  }

  export interface PutFileContentsOptions extends WebDAVMethodOptions {
    overwrite?: boolean;
    /** 传 true=自动计算，false=不设置，或传精确字节数 */
    contentLength?: boolean | number;
  }

  export interface GetDirectoryContentsOptions extends WebDAVMethodOptions {
    deep?: boolean;
    details?: boolean;
    glob?: string;
  }

  export interface GetQuotaOptions extends WebDAVMethodOptions {
    details?: boolean;
    path?: string;
  }

  export interface StatOptions extends WebDAVMethodOptions {
    details?: boolean;
  }

  export interface SearchOptions extends WebDAVMethodOptions {
    details?: boolean;
  }

  export interface LockOptions extends WebDAVMethodOptions {
    timeout?: number | string;
    refreshToken?: string;
  }

  export interface LockResponse {
    token: string;
    timeout?: number | string;
  }

  export interface ResponseDataDetailed<T> {
    data: T;
    headers: Record<string, string>;
    status: number;
    statusText: string;
  }

  export interface DiskQuota {
    used: number;
    available: number | 'unlimited' | null;
  }

  /** 文件/目录属性（与 README 对齐） */
  export interface FileStat {
    filename: string;
    basename: string;
    lastmod: string;
    size: number;
    type: 'file' | 'directory';
    etag?: string | null;
    mime?: string;
    /** 当调用处传了 { details: true } 时，可能包含 props */
    props?: Record<string, any>;
  }

  export interface WebDAVClient {
    // 目录与存在性
    getDirectoryContents(path: string, options?: GetDirectoryContentsOptions): Promise<FileStat[] | ResponseDataDetailed<FileStat[]>>;
    createDirectory(path: string, options?: CreateDirectoryOptions): Promise<void>;
    exists(path: string, options?: WebDAVMethodOptions): Promise<boolean>;

    // 文件内容
    getFileContents(filename: string, options?: GetFileContentsOptions): Promise<BufferLike | string | ResponseDataDetailed<BufferLike | string>>;
    putFileContents(filename: string, data: string | BufferLike | NodeJS.ReadableStream, options?: PutFileContentsOptions): Promise<boolean>;
    partialUpdateFileContents(filePath: string, start: number, end: number, data: string | BufferLike | NodeJS.ReadableStream, options?: WebDAVMethodOptions): Promise<void>;

    // 流
    createReadStream(filename: string, options?: CreateReadStreamOptions): NodeJS.ReadableStream;
    createWriteStream(filename: string, options?: CreateWriteStreamOptions, callback?: (response: any) => void): NodeJS.WritableStream;

    // 元数据 / 其他
    stat(path: string, options?: StatOptions): Promise<FileStat | ResponseDataDetailed<FileStat>>;
    getQuota(options?: GetQuotaOptions): Promise<DiskQuota | null | ResponseDataDetailed<DiskQuota | null>>;
    lock(path: string, options?: LockOptions): Promise<LockResponse>;
    unlock(path: string, token: string, options?: WebDAVMethodOptions): Promise<void>;

    // 链接生成
    getFileDownloadLink(filename: string): string;
    getFileUploadLink(filename: string): string;

    // 复制/移动/删除
    deleteFile(filename: string, options?: WebDAVMethodOptions): Promise<void>;
    moveFile(fromPath: string, toPath: string, options?: WebDAVMethodOptions): Promise<void>;
    copyFile(fromPath: string, toPath: string, options?: WebDAVMethodOptions): Promise<void>;

    // 搜索（RFC 5323）
    search(path: string, options?: SearchOptions): Promise<any | ResponseDataDetailed<any>>;

    // 自定义请求（底层 fetch/Response 类型视环境而定）
    customRequest(path: string, requestOptions: { method?: string; headers?: Record<string, string>; data?: any; url?: string }): Promise<any>;
  }

  export function createClient(url: string, options?: WebDAVClientOptions): WebDAVClient;
}
