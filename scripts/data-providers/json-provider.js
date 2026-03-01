const path = require('path');
const fs = require('fs/promises');

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function createJsonProvider(options = {}) {
  const dataRoot = options.dataRoot;
  if (!dataRoot) {
    throw new Error('json provider requires dataRoot');
  }

  function getCorpDir(corpCode) {
    return path.join(dataRoot, 'corp', String(corpCode || ''));
  }

  async function getCorpDetailBase(corpCode) {
    const corpDir = getCorpDir(corpCode);
    const overviewPath = path.join(corpDir, 'overview.json');
    const financialsPath = path.join(corpDir, 'financials.json');
    const dividendsPath = path.join(corpDir, 'dividends.json');
    const guidancePath = path.join(corpDir, 'guidance.json');
    const treasuryPath = path.join(corpDir, 'treasury.json');
    const shareholdersPath = path.join(corpDir, 'shareholders.json');
    const officersPath     = path.join(corpDir, 'officers.json');

    const [overview, financials, dividends, guidance, treasury, shareholders, officers] = await Promise.all([
      readJsonSafe(overviewPath),
      readJsonSafe(financialsPath),
      readJsonSafe(dividendsPath),
      readJsonSafe(guidancePath),
      readJsonSafe(treasuryPath),
      readJsonSafe(shareholdersPath),
      readJsonSafe(officersPath),
    ]);

    if (!overview && !financials && !dividends && !guidance && !treasury) {
      return null;
    }

    return { overview, financials, dividends, guidance, treasury, shareholders, officers };
  }

  async function getCorpIndex() {
    return readJsonSafe(path.join(dataRoot, 'corp-index.json'));
  }

  return {
    mode: 'json',
    getCorpDetailBase,
    getCorpIndex,
  };
}

module.exports = {
  createJsonProvider,
};
