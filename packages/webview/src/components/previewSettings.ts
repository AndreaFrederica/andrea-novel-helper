export type ReaderSettings = {
  font: number;
  line: number;
  para: number;
  pad: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  lockVerticalMargins: boolean;
  lockHorizontalMargins: boolean;
  fontFamilyMode: 'auto' | 'custom';
  fontFamily: string;
  width: number;
  widthMode: 'auto' | 'manual';
  height: number;
  heightMode: 'auto' | 'manual';
  mode: 'scroll' | 'paged';
  theme: 'auto' | 'light' | 'dark' | 'custom';
  align: 'left' | 'justify';
  markdownHeadings: boolean;
  markdownLists: boolean;
  markdownBold: boolean;
  markdownItalic: boolean;
  markdownBoldItalic: boolean;
  markdownStrike: boolean;
  markdownBlockquotes: boolean;
  markdownCode: boolean;
  obsidianRenderWikilinks: boolean;
  obsidianRenderTags: boolean;
  obsidianRenderEscapedTags: boolean;
  separatorRenderMode: 'render' | 'hidden' | 'preserve';
  markdownHeadingStyle: 'left' | 'center';
  markdownListStyle: 'indent' | 'plain';
  cols: number;
  sync: 'on' | 'off';
  customBackground: string;
  customForeground: string;
  colorizeRoles: boolean;
  colorizeRoleTypes: string[] | null;
  roleHoverMode: 'custom' | 'native' | 'off';
  roleHoverDetail: 'compact' | 'standard' | 'full';
};

export function defaultReaderSettings(): ReaderSettings {
  return {
    font: 16,
    line: 1.6,
    para: 8,
    pad: 24,
    marginTop: 76,
    marginRight: 24,
    marginBottom: 64,
    marginLeft: 24,
    lockVerticalMargins: true,
    lockHorizontalMargins: true,
    fontFamilyMode: 'auto',
    fontFamily: '',
    width: 720,
    widthMode: 'manual',
    height: 0,
    heightMode: 'auto',
    mode: 'scroll',
    theme: 'auto',
    align: 'left',
    markdownHeadings: false,
    markdownLists: false,
    markdownBold: false,
    markdownItalic: false,
    markdownBoldItalic: false,
    markdownStrike: false,
    markdownBlockquotes: false,
    markdownCode: false,
    obsidianRenderWikilinks: true,
    obsidianRenderTags: true,
    obsidianRenderEscapedTags: false,
    separatorRenderMode: 'preserve',
    markdownHeadingStyle: 'left',
    markdownListStyle: 'indent',
    cols: 1,
    sync: 'on',
    customBackground: '#fafafa',
    customForeground: '#222222',
    colorizeRoles: false,
    colorizeRoleTypes: null,
    roleHoverMode: 'custom',
    roleHoverDetail: 'standard',
  };
}
