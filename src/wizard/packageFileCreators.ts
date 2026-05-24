import * as fs from 'fs';
import * as path from 'path';
import { generateSensitiveWordsJson5, generateVocabularyJson5, generateCharacterGalleryJson5, generateCharacterGalleryCsv, generateRegexPatternsTemplate } from '../templates/templateGenerators';
import { LEGACY_RESOURCE_KEYWORDS } from '../projectConfig/resourceFileNaming';

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); }
}

export function createCharacterGalleryFile(dir: string) {
  ensureDir(dir);
  const file = path.join(dir, `${LEGACY_RESOURCE_KEYWORDS.character}.json5`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateCharacterGalleryJson5());
  }
  return file;
}

export function createCharacterGalleryCsvFile(dir: string) {
  ensureDir(dir);
  const file = path.join(dir, `${LEGACY_RESOURCE_KEYWORDS.character}.csv`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateCharacterGalleryCsv(), 'utf8');
  }
  return file;
}

export function createSensitiveWordsFile(dir: string, baseName = LEGACY_RESOURCE_KEYWORDS.sensitive) {
  ensureDir(dir);
  const file = path.join(dir, `${baseName}.json5`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateSensitiveWordsJson5());
  }
  return file;
}

export function createVocabularyFile(dir: string, baseName = LEGACY_RESOURCE_KEYWORDS.vocabulary) {
  ensureDir(dir);
  const file = path.join(dir, `${baseName}.json5`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateVocabularyJson5());
  }
  return file;
}

export function createRegexPatternsFile(dir: string) {
  ensureDir(dir);
  const file = path.join(dir, 'regex-patterns.json5');
  if (!fs.existsSync(file)) {
  fs.writeFileSync(file, generateRegexPatternsTemplate());
  }
  return file;
}
