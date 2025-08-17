import * as fs from 'fs';
import * as path from 'path';
import { generateSensitiveWordsJson5, generateVocabularyJson5, generateCharacterGalleryJson5, generateRegexPatternsTemplate } from '../templates/templateGenerators';

export function ensureDir(p: string) {
  if (!fs.existsSync(p)) { fs.mkdirSync(p, { recursive: true }); }
}

export function createCharacterGalleryFile(dir: string) {
  ensureDir(dir);
  const file = path.join(dir, 'character-gallery.json5');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateCharacterGalleryJson5());
  }
  return file;
}

export function createSensitiveWordsFile(dir: string, baseName = 'sensitive-words') {
  ensureDir(dir);
  const file = path.join(dir, `${baseName}.json5`);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, generateSensitiveWordsJson5());
  }
  return file;
}

export function createVocabularyFile(dir: string, baseName = 'vocabulary') {
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
