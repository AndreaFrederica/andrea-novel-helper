import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';
import { findBestCompletionPrefix, getCompletionPrefixCandidates } from '../utils/completionPrefix';

function mockSegmentText(text: string): string[] {
	if (text === '张三丰') {
		return ['张', '三丰'];
	}
	if (text === '这是张三丰') {
		return ['这是', '张', '三丰'];
	}
	return [text];
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Completion prefix keeps full multi-segment Chinese input', () => {
		const candidates = getCompletionPrefixCandidates('张三丰', mockSegmentText);
		assert.ok(candidates.includes('张三丰'));
		assert.strictEqual(findBestCompletionPrefix('张三丰', candidates, (target, prefix) => target.includes(prefix)), '张三丰');
	});

	test('Completion prefix falls back to tail phrase inside prose', () => {
		const candidates = getCompletionPrefixCandidates('这是张三丰', mockSegmentText);
		assert.strictEqual(findBestCompletionPrefix('张三丰', candidates, (target, prefix) => target.includes(prefix)), '张三丰');
	});
});
