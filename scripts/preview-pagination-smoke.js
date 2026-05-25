require('./register-node-unit-test-env');

const fs = require('fs');
const path = require('path');
const { mdToPlainText } = require('../out/utils/md_plain');
const { PreviewManager } = require('../out/Provider/view/previewPane');

const input = process.argv[2] || path.join(__dirname, '..', 'test', 'preview-pagination-regression.md');
const baseSrc = fs.readFileSync(input, 'utf8');
const repeat = Math.max(1, Number(process.env.PREVIEW_PAGINATION_REPEAT || 6) || 6);
const src = Array.from({ length: repeat }, (_, index) => `${baseSrc}\n\n## 回归重复段 ${index + 1}`).join('\n\n');
const { blocks } = mdToPlainText(src, {
  renderWikilinks: true,
  renderTags: true,
  renderEscapedTags: false,
  separatorRenderMode: 'preserve',
});

const manager = Object.create(PreviewManager.prototype);
const html = manager.makeHtmlFromBlocks(blocks);
const renderedNodes = [...html.matchAll(/<div\s+([^>]*)>([\s\S]*?)<\/div>/g)]
  .filter((m) => /\bdata-line=/.test(m[1]))
  .map((m) => ({
    attrs: m[1],
    kind: (m[1].match(/data-md-kind="([^"]+)"/) || [])[1] || 'paragraph',
    srcLine: Number((m[1].match(/data-line="(\d+)"/) || [])[1] || 0),
    mdOffset: Number((m[1].match(/data-md-offset="(\d+)"/) || [])[1] || 0),
    text: m[2].replace(/<[^>]+>/g, ''),
  }))
  .map((node) => ({ ...node, len: node.text.length }));

const blockSummary = blocks.reduce((acc, block) => {
  const key = block.kind || 'paragraph';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const htmlSummary = renderedNodes.reduce((acc, node) => {
  acc[node.kind] = (acc[node.kind] || 0) + 1;
  return acc;
}, {});
const longNodes = renderedNodes
  .map((node, index) => ({ index, len: node.len, kind: node.kind, srcLine: node.srcLine }))
  .filter((x) => x.len > 220);
const nodesBySourceLine = renderedNodes.reduce((acc, node) => {
  const arr = acc.get(node.srcLine) || [];
  arr.push(node);
  acc.set(node.srcLine, arr);
  return acc;
}, new Map());
const splitLineOffsetProblems = [...nodesBySourceLine.entries()]
  .filter(([, nodes]) => nodes.length > 1)
  .map(([srcLine, nodes]) => ({
    srcLine,
    offsets: nodes.map((node) => node.mdOffset),
    lengths: nodes.map((node) => node.len),
  }))
  .filter((entry) => entry.offsets.some((offset, index) => index > 0 && offset <= entry.offsets[index - 1]));

console.log(JSON.stringify({
  input,
  repeat,
  sourceLines: src.split(/\r?\n/).length,
  sourceChars: src.length,
  blockCount: blocks.length,
  blockSummary,
  renderedDataLineCount: renderedNodes.length,
  htmlSummary,
  maxRenderedTextLen: renderedNodes.reduce((max, node) => Math.max(max, node.len), 0),
  longRenderedNodes: longNodes.slice(0, 10),
  splitLineOffsetProblems: splitLineOffsetProblems.slice(0, 10),
}, null, 2));

const minExpectedNodes = Math.max(10, Math.floor(src.length / 90));
if (renderedNodes.length < minExpectedNodes) {
  console.error(`Expected at least ${minExpectedNodes} rendered data-line nodes, got ${renderedNodes.length}`);
  process.exit(1);
}
if (longNodes.length) {
  console.error(`Rendered HTML still contains ${longNodes.length} overlong data-line nodes`);
  process.exit(1);
}
if (splitLineOffsetProblems.length) {
  console.error(`Rendered HTML has ${splitLineOffsetProblems.length} split source lines without increasing data-md-offset`);
  process.exit(1);
}
