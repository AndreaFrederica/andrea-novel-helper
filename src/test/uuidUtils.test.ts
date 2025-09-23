/**
 * UUID 工具测试
 */

import * as assert from 'assert';
import { generateUUIDv7, generateRoleNameHash, isValidUUID, isValidUUIDv7, extractTimestampFromUUIDv7 } from '../utils/uuidUtils';

suite('UUID Utils Test Suite', () => {
    test('generateUUIDv7 should generate valid UUID v7', () => {
        const uuid = generateUUIDv7();
        
        // 检查格式
        assert.ok(isValidUUID(uuid), 'Generated UUID should be valid');
        assert.ok(isValidUUIDv7(uuid), 'Generated UUID should be v7');
        
        // 检查版本号
        assert.strictEqual(uuid.charAt(14), '7', 'Version should be 7');
        
        // 检查长度和格式
        assert.strictEqual(uuid.length, 36, 'UUID should be 36 characters long');
        assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'UUID should match v7 pattern');
    });

    test('generateUUIDv7 should generate unique UUIDs', () => {
        const uuid1 = generateUUIDv7();
        const uuid2 = generateUUIDv7();
        
        assert.notStrictEqual(uuid1, uuid2, 'Generated UUIDs should be unique');
    });

    test('generateRoleNameHash should generate consistent hash for same name', () => {
        const name = '测试角色';
        const hash1 = generateRoleNameHash(name);
        const hash2 = generateRoleNameHash(name);
        
        assert.strictEqual(hash1, hash2, 'Hash should be consistent for same name');
        assert.ok(isValidUUID(hash1), 'Generated hash should be valid UUID format');
        assert.strictEqual(hash1.length, 36, 'Hash should be 36 characters long');
    });

    test('generateRoleNameHash should generate different hashes for different names', () => {
        const hash1 = generateRoleNameHash('角色1');
        const hash2 = generateRoleNameHash('角色2');
        
        assert.notStrictEqual(hash1, hash2, 'Different names should generate different hashes');
    });

    test('isValidUUID should validate UUID format correctly', () => {
        // 有效的 UUID
        assert.ok(isValidUUID('550e8400-e29b-41d4-a716-446655440000'));
        assert.ok(isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'));
        
        // 无效的 UUID
        assert.ok(!isValidUUID('invalid-uuid'));
        assert.ok(!isValidUUID('550e8400-e29b-41d4-a716'));
        assert.ok(!isValidUUID('550e8400-e29b-41d4-a716-446655440000-extra'));
        assert.ok(!isValidUUID(''));
    });

    test('isValidUUIDv7 should validate UUID v7 format correctly', () => {
        const uuidv7 = generateUUIDv7();
        assert.ok(isValidUUIDv7(uuidv7), 'Generated UUID v7 should be valid');
        
        // 非 v7 UUID
        assert.ok(!isValidUUIDv7('550e8400-e29b-41d4-a716-446655440000')); // v4
        assert.ok(!isValidUUIDv7('6ba7b810-9dad-11d1-80b4-00c04fd430c8')); // v1
        assert.ok(!isValidUUIDv7('invalid-uuid'));
    });

    test('extractTimestampFromUUIDv7 should extract timestamp correctly', () => {
        const beforeTime = Date.now();
        const uuid = generateUUIDv7();
        const afterTime = Date.now();
        
        const extractedTime = extractTimestampFromUUIDv7(uuid);
        
        assert.ok(extractedTime !== null, 'Should extract timestamp from valid UUID v7');
        assert.ok(extractedTime! >= beforeTime, 'Extracted timestamp should be >= before time');
        assert.ok(extractedTime! <= afterTime, 'Extracted timestamp should be <= after time');
    });

    test('extractTimestampFromUUIDv7 should return null for invalid UUID', () => {
        assert.strictEqual(extractTimestampFromUUIDv7('invalid-uuid'), null);
        assert.strictEqual(extractTimestampFromUUIDv7('550e8400-e29b-41d4-a716-446655440000'), null); // v4
    });

    test('UUID v7 should be time-ordered', () => {
        const uuid1 = generateUUIDv7();
        // 等待一小段时间确保时间戳不同
        const start = Date.now();
        while (Date.now() - start < 2) {
            // 忙等待
        }
        const uuid2 = generateUUIDv7();
        
        const time1 = extractTimestampFromUUIDv7(uuid1);
        const time2 = extractTimestampFromUUIDv7(uuid2);
        
        assert.ok(time1! < time2!, 'Later generated UUID should have later timestamp');
        assert.ok(uuid1 < uuid2, 'UUID v7 should be lexicographically ordered by time');
    });
});
