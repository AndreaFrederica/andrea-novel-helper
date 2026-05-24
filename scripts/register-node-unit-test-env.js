const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoad = Module._load;
const vscodeMock = {
  workspace: {
    getConfiguration() {
      return {
        get(_key, fallback) {
          return fallback;
        },
      };
    },
  },
  window: {
    showInformationMessage() {
      return undefined;
    },
    showErrorMessage() {
      return undefined;
    },
    showWarningMessage() {
      return undefined;
    },
  },
  Uri: {
    file(fsPath) {
      return { fsPath };
    },
  },
  languages: {
    createDiagnosticCollection() {
      return { set() {}, clear() {}, delete() {}, dispose() {} };
    },
  },
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
    Hint: 3,
  },
  EventEmitter: class {
    constructor() {
      this.event = () => ({ dispose() {} });
    }
    fire() {}
    dispose() {}
  },
  TreeItem: class {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
};

Module._load = function loadWithNodeUnitTestStubs(request, parent, isMain) {
  if (
    request.endsWith('/activate') ||
    request.endsWith('\\activate') ||
    request === '../../activate' ||
    request === '../activate'
  ) {
    return { roles: [] };
  }

  if (
    request === './utils' &&
    parent &&
    typeof parent.filename === 'string' &&
    parent.filename.endsWith(path.join('out', 'utils', 'roleUuidManager.js'))
  ) {
    return {
      readTextFileDetectEncoding(filePath) {
        return Promise.resolve(fs.readFileSync(filePath, 'utf8'));
      },
    };
  }

  if (request === 'vscode') {
    return vscodeMock;
  }

  return originalLoad.call(this, request, parent, isMain);
};
