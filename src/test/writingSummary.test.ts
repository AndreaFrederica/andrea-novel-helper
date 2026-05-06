import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    IDatabaseBackend,
    WritingFileSummary,
    WritingProjectSummary,
} from '../database/IDatabaseBackend';
import { FileMetadata, FileTrackingDataManager } from '../utils/tracker/fileTrackingData';

class MemoryBackend implements IDatabaseBackend {
    public files = new Map<string, any>();
    public pathMappings = new Map<string, string>();
    public index: any = null;
    public projectSummary: WritingProjectSummary | null = null;
    public fileSummaries = new Map<string, WritingFileSummary>();

    constructor(private readonly workspaceRoot: string) {}

    private clone<T>(value: T): T {
        if (value === null || value === undefined) {
            return value;
        }
        return JSON.parse(JSON.stringify(value)) as T;
    }

    async initialize(): Promise<void> {}
    async close(): Promise<void> {}

    async saveFileMetadata(uuid: string, metadata: any): Promise<void> {
        this.files.set(uuid, this.clone(metadata));
    }

    async saveFileMetadataBatch(entries: Array<{ uuid: string; metadata: any }>): Promise<void> {
        for (const entry of entries) {
            await this.saveFileMetadata(entry.uuid, entry.metadata);
        }
    }

    async loadFileMetadata(uuid: string): Promise<any | null> {
        return this.clone(this.files.get(uuid) ?? null);
    }

    async loadFileMetadataBatch(uuids: string[]): Promise<Map<string, any>> {
        const result = new Map<string, any>();
        for (const uuid of uuids) {
            if (this.files.has(uuid)) {
                result.set(uuid, this.clone(this.files.get(uuid)));
            }
        }
        return result;
    }

    async deleteFileMetadata(uuid: string): Promise<void> {
        this.files.delete(uuid);
    }

    async deleteFileMetadataBatch(uuids: string[]): Promise<void> {
        for (const uuid of uuids) {
            this.files.delete(uuid);
        }
    }

    async savePathMapping(pathKey: string, uuid: string): Promise<void> {
        this.pathMappings.set(pathKey, uuid);
    }

    async savePathMappingBatch(mappings: Array<{ path: string; uuid: string }>): Promise<void> {
        for (const mapping of mappings) {
            this.pathMappings.set(mapping.path, mapping.uuid);
        }
    }

    async getUuidByPath(pathKey: string): Promise<string | null> {
        return this.pathMappings.get(pathKey) || null;
    }

    async deletePathMapping(pathKey: string): Promise<void> {
        this.pathMappings.delete(pathKey);
    }

    async deletePathMappingRaw(pathKey: string): Promise<void> {
        this.pathMappings.delete(pathKey);
    }

    async getAllPathMappings(): Promise<Map<string, string>> {
        return new Map(this.pathMappings);
    }

    async getAllFileUuids(): Promise<string[]> {
        return Array.from(new Set(this.pathMappings.values()));
    }

    async saveIndex(data: any): Promise<void> {
        this.index = this.clone(data);
    }

    async loadIndex(): Promise<any | null> {
        return this.clone(this.index);
    }

    async saveWritingProjectSummary(summary: WritingProjectSummary): Promise<void> {
        this.projectSummary = this.clone(summary);
    }

    async loadWritingProjectSummary(): Promise<WritingProjectSummary | null> {
        return this.clone(this.projectSummary);
    }

    async saveWritingFileSummary(summary: WritingFileSummary): Promise<void> {
        this.fileSummaries.set(summary.uuid, this.clone(summary));
    }

    async saveWritingFileSummaryBatch(entries: WritingFileSummary[]): Promise<void> {
        for (const summary of entries) {
            this.fileSummaries.set(summary.uuid, this.clone(summary));
        }
    }

    async loadWritingFileSummary(uuid: string): Promise<WritingFileSummary | null> {
        return this.clone(this.fileSummaries.get(uuid) ?? null);
    }

    async loadAllWritingFileSummaries(): Promise<Map<string, WritingFileSummary>> {
        return new Map(
            Array.from(this.fileSummaries.entries()).map(([uuid, summary]) => [uuid, this.clone(summary)])
        );
    }

    async deleteWritingFileSummary(uuid: string): Promise<void> {
        this.fileSummaries.delete(uuid);
    }

    async getStats(): Promise<{ totalFiles: number; totalMappings: number; dbSize?: number }> {
        return {
            totalFiles: this.files.size,
            totalMappings: this.pathMappings.size,
        };
    }

    async optimize(): Promise<void> {}

    async exportAll(): Promise<{ files: Map<string, any>; pathMappings: Map<string, string>; index: any; }> {
        return {
            files: new Map(Array.from(this.files.entries()).map(([uuid, metadata]) => [uuid, this.clone(metadata)])),
            pathMappings: new Map(this.pathMappings),
            index: this.clone(this.index),
        };
    }

    async importAll(data: { files: Map<string, any>; pathMappings: Map<string, string>; index: any; }): Promise<void> {
        this.files = new Map(Array.from(data.files.entries()).map(([uuid, metadata]) => [uuid, this.clone(metadata)]));
        this.pathMappings = new Map(data.pathMappings);
        this.index = this.clone(data.index);
    }

    async checkHealth(): Promise<{ healthy: boolean; issues?: string[]; }> {
        return { healthy: true };
    }

    getBackendType(): string {
        return 'memory';
    }
}

function createMetadata(filePath: string, uuid: string, writingStats?: FileMetadata['writingStats']): FileMetadata {
    return {
        uuid,
        filePath,
        fileName: path.basename(filePath),
        fileExtension: path.extname(filePath).toLowerCase(),
        size: 0,
        mtime: Date.now(),
        hash: `hash-${uuid}`,
        createdAt: Date.now(),
        lastTrackedAt: Date.now(),
        updatedAt: Date.now(),
        writingStats,
    };
}

function createStats(charsAdded: number, totalMillis = 60_000): NonNullable<FileMetadata['writingStats']> {
    const bucketStart = Math.floor(Date.now() / 60_000) * 60_000;
    return {
        totalMillis,
        charsAdded,
        charsDeleted: 0,
        lastActiveTime: bucketStart,
        sessionsCount: 1,
        averageCPM: Math.round(charsAdded / (totalMillis / 60_000)),
        buckets: [{ start: bucketStart, end: bucketStart + 60_000, charsAdded }],
        sessions: [{ start: bucketStart, end: bucketStart + totalMillis }],
        achievedMilestones: [],
    };
}

suite('Writing Summary Test Suite', () => {
    let tempDir: string;
    let originalInitializeBackendSync: any;

    suiteSetup(() => {
        originalInitializeBackendSync = (FileTrackingDataManager.prototype as any).initializeBackendSync;
        (FileTrackingDataManager.prototype as any).initializeBackendSync = function () {};
    });

    suiteTeardown(() => {
        (FileTrackingDataManager.prototype as any).initializeBackendSync = originalInitializeBackendSync;
    });

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writing-summary-test-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    function createManager(): { manager: FileTrackingDataManager; backend: MemoryBackend } {
        const manager = new FileTrackingDataManager(tempDir);
        const internal = manager as any;
        const backend = new MemoryBackend(tempDir);
        internal.backend = backend;
        internal.backendInitialized = true;
        const summary = internal.buildEmptyWritingProjectSummary();
        internal.writingProjectSummaryCache = summary;
        internal.setWritingSummaryState(summary);
        return { manager, backend };
    }

    async function seedTrackedFile(manager: FileTrackingDataManager, backend: MemoryBackend, metadata: FileMetadata): Promise<void> {
        const internal = manager as any;
        const relKey = manager.toRelativeKey(metadata.filePath);
        internal.database.files[metadata.uuid] = metadata;
        internal.database.pathToUuid[relKey] = metadata.uuid;
        await backend.saveFileMetadata(metadata.uuid, metadata);
        await backend.savePathMapping(relKey, metadata.uuid);
    }

    test('updateWritingStats should update project summary and file summary incrementally', async () => {
        const { manager, backend } = createManager();
        const filePath = path.join(tempDir, 'chapter-1.md');
        const metadata = createMetadata(filePath, 'uuid-1', createStats(0, 0));
        await seedTrackedFile(manager, backend, metadata);

        const nextStats = createStats(120, 120_000);
        await manager.updateWritingStats(filePath, nextStats);

        const summary = await manager.getWritingProjectSummaryAsync();
        const fileSummary = await manager.getWritingFileSummaryAsync('uuid-1');

        assert.ok(summary, 'project summary should exist');
        assert.ok(fileSummary, 'file summary should exist');
        assert.strictEqual(summary!.totalMillisAll, 120_000);
        assert.strictEqual(summary!.filesWithWritingStats, 1);
        assert.strictEqual(summary!.today.millis, 120_000);
        assert.strictEqual(summary!.today.chars, 120);
        assert.strictEqual(summary!.today.avgCPM, 60);
        assert.strictEqual(summary!.today.peakCPM, 120);
        assert.strictEqual(fileSummary!.totalMillis, 120_000);
        assert.strictEqual(fileSummary!.charsAdded, 120);
        assert.strictEqual(fileSummary!.todayPeakCPM, 120);
    });

    test('removeFile should decrement project summary and delete file summary', async () => {
        const { manager, backend } = createManager();
        const filePath = path.join(tempDir, 'chapter-2.md');
        const metadata = createMetadata(filePath, 'uuid-2', createStats(0, 0));
        await seedTrackedFile(manager, backend, metadata);

        await manager.updateWritingStats(filePath, createStats(80, 60_000));
        await manager.removeFile(filePath);

        const summary = await manager.getWritingProjectSummaryAsync();
        const fileSummary = await manager.getWritingFileSummaryAsync('uuid-2');

        assert.ok(summary, 'project summary should still exist');
        assert.strictEqual(summary!.totalMillisAll, 0);
        assert.strictEqual(summary!.filesWithWritingStats, 0);
        assert.strictEqual(summary!.today.millis, 0);
        assert.strictEqual(summary!.today.chars, 0);
        assert.strictEqual(summary!.today.peakCPM, 0);
        assert.strictEqual(fileSummary, undefined);
    });

    test('renameFile should only update file summary path', async () => {
        const { manager, backend } = createManager();
        const oldPath = path.join(tempDir, 'chapter-3.md');
        const newPath = path.join(tempDir, 'renamed', 'chapter-3.md');
        const metadata = createMetadata(oldPath, 'uuid-3', createStats(0, 0));
        await seedTrackedFile(manager, backend, metadata);

        await manager.updateWritingStats(oldPath, createStats(40, 60_000));
        const before = await manager.getWritingProjectSummaryAsync();
        await manager.renameFile(oldPath, newPath);
        const after = await manager.getWritingProjectSummaryAsync();
        const fileSummary = await manager.getWritingFileSummaryAsync('uuid-3');

        assert.ok(before && after && fileSummary, 'summary and file summary should exist');
        assert.strictEqual(after!.totalMillisAll, before!.totalMillisAll);
        assert.strictEqual(after!.today.chars, before!.today.chars);
        assert.strictEqual(after!.today.millis, before!.today.millis);
        assert.strictEqual(after!.today.peakCPM, before!.today.peakCPM);
        assert.strictEqual(fileSummary!.path, newPath);
    });

    test('rebuildWritingProjectSummary should rebuild from backend metadata', async () => {
        const { manager, backend } = createManager();
        const filePath1 = path.join(tempDir, 'chapter-a.md');
        const filePath2 = path.join(tempDir, 'chapter-b.md');
        const metadata1 = createMetadata(filePath1, 'uuid-a', createStats(30, 60_000));
        const metadata2 = createMetadata(filePath2, 'uuid-b', createStats(90, 180_000));

        await backend.saveFileMetadata(metadata1.uuid, metadata1);
        await backend.saveFileMetadata(metadata2.uuid, metadata2);
        await backend.savePathMapping(manager.toRelativeKey(filePath1), metadata1.uuid);
        await backend.savePathMapping(manager.toRelativeKey(filePath2), metadata2.uuid);

        const internal = manager as any;
        internal.writingProjectSummaryCache = null;
        await internal.rebuildWritingProjectSummary('test-rebuild');

        const summary = await manager.getWritingProjectSummaryAsync();
        const allFileSummaries = await manager.getAllWritingFileSummariesAsync(true);

        assert.ok(summary, 'project summary should be rebuilt');
        assert.strictEqual(summary!.totalMillisAll, 240_000);
        assert.strictEqual(summary!.filesWithWritingStats, 2);
        assert.strictEqual(summary!.today.chars, 120);
        assert.strictEqual(summary!.today.avgCPM, 30);
        assert.strictEqual(summary!.today.peakCPM, 90);
        assert.strictEqual(allFileSummaries.size, 2);
        assert.ok(backend.projectSummary, 'backend should persist rebuilt summary');
    });

    test('getWritingProjectSummaryAsync should rebuild stale today summary cache', async () => {
        const { manager, backend } = createManager();
        const filePath = path.join(tempDir, 'chapter-today.md');
        const metadata = createMetadata(filePath, 'uuid-today', createStats(150, 150_000));
        await seedTrackedFile(manager, backend, metadata);

        const internal = manager as any;
        const yesterdayKey = internal.getTodayKey(Date.now() - 24 * 60 * 60 * 1000);
        const staleSummary = internal.buildEmptyWritingProjectSummary(60000, yesterdayKey);
        internal.writingProjectSummaryCache = staleSummary;
        internal.setWritingSummaryState(staleSummary);
        await backend.saveWritingProjectSummary(staleSummary);

        const summary = await manager.getWritingProjectSummaryAsync();

        assert.ok(summary, 'project summary should be rebuilt from stale cache');
        assert.strictEqual(summary!.todayKey, internal.getTodayKey());
        assert.strictEqual(summary!.today.millis, 150_000);
        assert.strictEqual(summary!.today.chars, 150);
        assert.strictEqual(summary!.today.avgCPM, 60);
        assert.strictEqual(summary!.today.peakCPM, 150);
    });
});
