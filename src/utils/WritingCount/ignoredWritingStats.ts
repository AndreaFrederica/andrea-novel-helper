import * as fs from 'fs';
import * as path from 'path';

/**
 * 轻量级忽略文件写作统计分片：
 * 只记录总时长与字符增量，用追加方式写入，超出阈值换新分片。
 */
export interface IgnoredWritingStatEntry {
  id: string;            // 固定 "__IGNORED__"
  totalMillis: number;   // 聚合全部忽略文件的写作时长
  charsAdded: number;    // 聚合新增
  charsDeleted: number;  // 聚合删除
  lastActiveTime: number;
}

export class IgnoredWritingStatsManager {
  private shardDir: string;
  private maxShardSize = 200 * 1024; // 200KB 阈值（可根据需要调整）
  private currentShardPath: string | null = null;
  private pending: IgnoredWritingStatEntry | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly FLUSH_DEBOUNCE = 1500;

  constructor(workspaceRoot: string) {
    this.shardDir = path.join(workspaceRoot, 'novel-helper', '.anh-fsdb', 'ignored-writing');
    if (!fs.existsSync(this.shardDir)) { fs.mkdirSync(this.shardDir, { recursive: true }); }
  }

  private pickShard(): string {
    if (this.currentShardPath && fs.existsSync(this.currentShardPath)) {
      const size = fs.statSync(this.currentShardPath).size;
      if (size < this.maxShardSize) { return this.currentShardPath; }
    }
    // 创建新分片
    const shardName = `ignored-${Date.now()}.log`;
    this.currentShardPath = path.join(this.shardDir, shardName);
    fs.writeFileSync(this.currentShardPath, '');
    return this.currentShardPath;
  }

  update(entry: { deltaMillis: number; deltaAdded: number; deltaDeleted: number; timestamp: number; }) {
    const base: IgnoredWritingStatEntry = this.pending || {
      id: '__IGNORED__',
      totalMillis: 0,
      charsAdded: 0,
      charsDeleted: 0,
      lastActiveTime: entry.timestamp
    };
    base.totalMillis += entry.deltaMillis;
    if (entry.deltaAdded > 0) { base.charsAdded += entry.deltaAdded; }
    if (entry.deltaDeleted > 0) { base.charsDeleted += entry.deltaDeleted; }
    base.lastActiveTime = entry.timestamp;
    this.pending = base;
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); }
    this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_DEBOUNCE);
  }

  private flush() {
  if (!this.pending) { return; }
    const shard = this.pickShard();
  fs.appendFileSync(shard, JSON.stringify(this.pending) + '\n', 'utf8');
  this.pending = null;
  }

  dispose() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); }
    this.flush();
  }
}

// 全局单例缓存（按 workspaceRoot）
const managers = new Map<string, IgnoredWritingStatsManager>();
export function getIgnoredWritingStatsManager(workspaceRoot: string | undefined): IgnoredWritingStatsManager | undefined {
  if (!workspaceRoot) { return undefined; }
  let m = managers.get(workspaceRoot);
  if (!m) {
    m = new IgnoredWritingStatsManager(workspaceRoot);
    managers.set(workspaceRoot, m);
  }
  return m;
}
export function disposeIgnoredManagers() {
  for (const m of managers.values()) { m.dispose(); }
  managers.clear();
}
