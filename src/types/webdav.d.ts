declare module 'webdav' {
  export interface WebDAVClientOptions {
    username?: string;
    password?: string;
    token?: string;
    digest?: boolean;
    maxContentLength?: number;
    maxBodyLength?: number;
    withCredentials?: boolean;
    headers?: Record<string, string>;
    httpsAgent?: any;
    httpAgent?: any;
  }

  export interface FileStat {
    filename: string;
    basename: string;
    lastmod: string;
    size: number;
    type: 'file' | 'directory';
    etag?: string;
    mime?: string;
  }

  export interface WebDAVClient {
    getDirectoryContents(path: string): Promise<FileStat[]>;
    putFileContents(path: string, data: string | Buffer | ArrayBuffer): Promise<boolean>;
    getFileContents(path: string, options?: { format?: 'binary' | 'text' }): Promise<string | Buffer | ArrayBuffer>;
    stat(path: string): Promise<FileStat>;
    createDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;
    exists(path: string): Promise<boolean>;
    deleteFile(path: string): Promise<void>;
    moveFile(fromPath: string, toPath: string): Promise<void>;
    copyFile(fromPath: string, toPath: string): Promise<void>;
  }

  export function createClient(url: string, options?: WebDAVClientOptions): WebDAVClient;
}