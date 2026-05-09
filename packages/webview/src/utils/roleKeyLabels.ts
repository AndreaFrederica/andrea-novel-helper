export type RoleKeyDisplayLanguage = 'zh' | 'en' | 'ja';

export interface RoleKeyLabel {
  primary: string;
  secondary: string;
}

type RoleKeyTranslation = Partial<Record<RoleKeyDisplayLanguage, string>>;

const ROLE_KEY_LABELS: Record<string, RoleKeyTranslation> = {
  name: { zh: '名称', en: 'Name', ja: '名前' },
  type: { zh: '类型', en: 'Type', ja: '種類' },
  uuid: { zh: 'UUID', en: 'UUID', ja: 'UUID' },
  color: { zh: '前景色', en: 'Text color', ja: '文字色' },
  style: { zh: '文本样式', en: 'Text style', ja: '文字スタイル' },
  priority: { zh: '优先级', en: 'Priority', ja: '優先度' },
  description: { zh: '描述', en: 'Description', ja: '説明' },
  affiliation: { zh: '从属', en: 'Affiliation', ja: '所属' },
  wordSegmentFilter: { zh: '分词过滤', en: 'Word segmentation filter', ja: '分かち書きフィルター' },
  aliases: { zh: '别名', en: 'Aliases', ja: '別名' },
  lookupKeys_pinyin: { zh: '拼音查询键', en: 'Pinyin lookup keys', ja: 'ピンイン検索キー' },
  lookupKeys_romanized: { zh: '罗马字查询键', en: 'Romanized lookup keys', ja: 'ローマ字検索キー' },
  lookupKeys_spelling: { zh: '拼写查询键', en: 'Spelling lookup keys', ja: '綴り検索キー' },
  fixes: { zh: '修复词', en: 'Fix candidates', ja: '修正候補' },
  regex: { zh: '正则模式', en: 'Regex pattern', ja: '正規表現パターン' },
  regexFlags: { zh: '正则标志', en: 'Regex flags', ja: '正規表現フラグ' },
  generation_culture: { zh: '生成文化背景', en: 'Generated culture', ja: '生成時の文化背景' },
  generation_Culture: { zh: '生成文化背景', en: 'Generated culture', ja: '生成時の文化背景' },
  generation_gender: { zh: '生成性别', en: 'Generated gender', ja: '生成時の性別' },
  generation_Gender: { zh: '生成性别', en: 'Generated gender', ja: '生成時の性別' },
  generation_style: { zh: '生成风格', en: 'Generated style', ja: '生成時のスタイル' },
  generation_Style: { zh: '生成风格', en: 'Generated style', ja: '生成時のスタイル' },
  generation_origin: { zh: '生成来源', en: 'Generated origin', ja: '生成元' },
  generation_Origin: { zh: '生成来源', en: 'Generated origin', ja: '生成元' },
  generation_count: { zh: '生成候选数', en: 'Generated candidate count', ja: '生成候補数' },
  generation_Count: { zh: '生成候选数', en: 'Generated candidate count', ja: '生成候補数' },
  generation_roleType: { zh: '生成角色类型', en: 'Generated role type', ja: '生成時の役割タイプ' },
  generation_RoleType: { zh: '生成角色类型', en: 'Generated role type', ja: '生成時の役割タイプ' },
  generation_affiliation: { zh: '生成从属', en: 'Generated affiliation', ja: '生成時の所属' },
  generation_Affiliation: { zh: '生成从属', en: 'Generated affiliation', ja: '生成時の所属' },
};

const EXTENDED_ROLE_KEY_ALIASES: Array<[string[], RoleKeyTranslation]> = [
  [['age', '年龄'], { zh: '年龄', en: 'Age', ja: '年齢' }],
  [['gender', '性别'], { zh: '性别', en: 'Gender', ja: '性別' }],
  [['occupation', '职业'], { zh: '职业', en: 'Occupation', ja: '職業' }],
  [['personality', '性格'], { zh: '性格', en: 'Personality', ja: '性格' }],
  [['appearance', '外貌'], { zh: '外貌', en: 'Appearance', ja: '外見' }],
  [['background', '背景'], { zh: '背景', en: 'Background', ja: '背景' }],
  [['relationship', 'relationships', '关系'], { zh: '关系', en: 'Relationships', ja: '関係' }],
  [['skill', 'skills', '技能'], { zh: '技能', en: 'Skills', ja: 'スキル' }],
  [['weakness', 'weaknesses', '弱点'], { zh: '弱点', en: 'Weaknesses', ja: '弱点' }],
  [['goal', 'goals', '目标'], { zh: '目标', en: 'Goals', ja: '目標' }],
  [['motivation', '动机'], { zh: '动机', en: 'Motivation', ja: '動機' }],
  [['fear', 'fears', '恐惧'], { zh: '恐惧', en: 'Fears', ja: '恐怖' }],
  [['secret', 'secrets', '秘密'], { zh: '秘密', en: 'Secrets', ja: '秘密' }],
  [['quote', 'quotes', '台词'], { zh: '台词', en: 'Quotes', ja: '台詞' }],
  [['note', 'notes', '备注'], { zh: '备注', en: 'Notes', ja: 'メモ' }],
  [['tag', 'tags', '标签'], { zh: '标签', en: 'Tags', ja: 'タグ' }],
  [['category', '分类'], { zh: '分类', en: 'Category', ja: 'カテゴリ' }],
  [['level', '等级'], { zh: '等级', en: 'Level', ja: 'レベル' }],
  [['status', '状态'], { zh: '状态', en: 'Status', ja: '状態' }],
  [['location', '位置'], { zh: '位置', en: 'Location', ja: '場所' }],
  [['origin', '出身'], { zh: '出身', en: 'Origin', ja: '出身' }],
  [['family', '家庭'], { zh: '家庭', en: 'Family', ja: '家族' }],
  [['education', '教育'], { zh: '教育', en: 'Education', ja: '教育' }],
  [['hobby', 'hobbies', '爱好'], { zh: '爱好', en: 'Hobbies', ja: '趣味' }],
  [['代表符卡'], { zh: '代表符卡', en: 'Signature spell cards', ja: '代表スペルカード' }],
  [['装备'], { zh: '装备', en: 'Equipment', ja: '装備' }],
  [['信仰'], { zh: '信仰', en: 'Faith', ja: '信仰' }],
  [['称号'], { zh: '称号', en: 'Titles', ja: '称号' }],
];

export const EXTENDED_ROLE_KEY_LIST = EXTENDED_ROLE_KEY_ALIASES.flatMap(([keys]) => keys);

for (const [keys, label] of EXTENDED_ROLE_KEY_ALIASES) {
  for (const key of keys) {
    ROLE_KEY_LABELS[key] = label;
  }
}

export function normalizeRoleKeyLanguage(language?: string): RoleKeyDisplayLanguage {
  const raw = String(language || '').toLowerCase();
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('ja')) return 'ja';
  return 'en';
}

export function getCurrentRoleKeyLanguage(): RoleKeyDisplayLanguage {
  const language = (
    (window as unknown as { __vscode_language__?: string }).__vscode_language__ ||
    document.documentElement.lang ||
    navigator.language ||
    'en'
  );
  return normalizeRoleKeyLanguage(language);
}

export function formatRoleKeyLabel(
  key: string,
  localized: boolean,
  language: string | undefined,
): RoleKeyLabel {
  const cleanKey = String(key || '');
  if (!localized) {
    return { primary: cleanKey, secondary: '' };
  }

  const lang = normalizeRoleKeyLanguage(language);
  const translated = ROLE_KEY_LABELS[cleanKey]?.[lang] || ROLE_KEY_LABELS[cleanKey]?.en;
  if (!translated || translated === cleanKey) {
    return { primary: cleanKey, secondary: '' };
  }
  return { primary: translated, secondary: cleanKey };
}

export function formatRoleKeyInline(
  key: string,
  localized: boolean,
  language: string | undefined,
): string {
  const label = formatRoleKeyLabel(key, localized, language);
  return label.secondary ? `${label.primary} (${label.secondary})` : label.primary;
}
