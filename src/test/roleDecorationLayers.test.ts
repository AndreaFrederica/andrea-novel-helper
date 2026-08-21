import * as assert from 'assert';
import {
    buildCompositeDecorationSegments,
    resolvePriorityLayer,
} from '../utils/roleDecorationLayers';

suite('Role decoration layers', () => {
    test('keeps an outer background under a higher-priority foreground role', () => {
        const segments = buildCompositeDecorationSegments(
            [
                { start: 0, end: 2, priority: 604, value: 'dialogue-text' },
                { start: 2, end: 5, priority: 10, value: 'character-text' },
                { start: 5, end: 10, priority: 604, value: 'dialogue-text' },
            ],
            [{ start: 0, end: 10, priority: 604, value: 'dialogue-background' }]
        );

        assert.deepStrictEqual(segments, [
            { start: 0, end: 2, foreground: 'dialogue-text', background: 'dialogue-background' },
            { start: 2, end: 5, foreground: 'character-text', background: 'dialogue-background' },
            { start: 5, end: 10, foreground: 'dialogue-text', background: 'dialogue-background' },
        ]);
    });

    test('lets a higher-priority inner background override the outer background locally', () => {
        const backgrounds = resolvePriorityLayer([
            { start: 0, end: 10, priority: 604, value: 'dialogue-background' },
            { start: 2, end: 5, priority: 10, value: 'character-background' },
        ]);

        assert.deepStrictEqual(backgrounds, [
            { start: 0, end: 2, value: 'dialogue-background' },
            { start: 2, end: 5, value: 'character-background' },
            { start: 5, end: 10, value: 'dialogue-background' },
        ]);
    });

    test('uses the longer match when priorities are equal', () => {
        const segments = resolvePriorityLayer([
            { start: 2, end: 5, priority: 100, value: 'short' },
            { start: 0, end: 10, priority: 100, value: 'long' },
        ]);

        assert.deepStrictEqual(segments, [{ start: 0, end: 10, value: 'long' }]);
    });

    test('merges adjacent segments with the same foreground and background owners', () => {
        const segments = buildCompositeDecorationSegments(
            [
                { start: 0, end: 2, priority: 10, value: 'character' },
                { start: 2, end: 5, priority: 10, value: 'character' },
            ],
            []
        );

        assert.deepStrictEqual(segments, [
            { start: 0, end: 5, foreground: 'character', background: undefined },
        ]);
    });

    test('preserves foreground-only behavior when no background is configured', () => {
        const segments = buildCompositeDecorationSegments(
            [{ start: 1, end: 4, priority: 10, value: 'character' }],
            []
        );

        assert.deepStrictEqual(segments, [
            { start: 1, end: 4, foreground: 'character', background: undefined },
        ]);
    });
});
