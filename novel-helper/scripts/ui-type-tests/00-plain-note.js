// Plain script sample: no run(), no activate()/register().
// Expected type in UI: 普通脚本

const info = {
  purpose: 'Type detection smoke test',
  createdAt: new Date().toISOString(),
};

// Intentionally no exports.
console.log('plain sample loaded', info.purpose);
