export { default as PatchouliReader } from './components/PatchouliReader.vue';

export type PatchouliReaderDebugInfo = {
  currentPage: number;
  totalPages: number;
  rawElementCount: number;
  rawDomChildren: number;
  pointerInputCount: number;
  readerWidth: number;
  maxHeight: number;
  singlePageMode: boolean;
  pointerEngine: boolean;
  highLevelPagedEngine: boolean;
};
