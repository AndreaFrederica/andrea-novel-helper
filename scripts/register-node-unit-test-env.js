const Module = require('module');

const originalLoad = Module._load;

Module._load = function loadWithNodeUnitTestStubs(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration() {
          return {
            get(_key, fallback) {
              return fallback;
            },
          };
        },
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};
