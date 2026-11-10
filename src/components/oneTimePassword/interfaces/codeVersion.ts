export interface CodeVersion {
  version: number;
  errorCodewordsPerBlock: number;
  firstGroupBlocks: number;
  firstGroupData: number;
  secondGroupBlocks: number;
  secondGroupData: number;
  remainderBits: number;
  alignmentCenters: number[];
}
