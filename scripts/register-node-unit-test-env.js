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
};

Module._load = function loadWithNodeUnitTestStubs(request, parent, isMain) {
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
