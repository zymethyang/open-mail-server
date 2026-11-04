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

export const codeVersions: CodeVersion[] = [
  { version: 1, errorCodewordsPerBlock: 10, firstGroupBlocks: 1, firstGroupData: 16, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 0, alignmentCenters: [] },
  { version: 2, errorCodewordsPerBlock: 16, firstGroupBlocks: 1, firstGroupData: 28, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 7, alignmentCenters: [6, 18] },
  { version: 3, errorCodewordsPerBlock: 26, firstGroupBlocks: 1, firstGroupData: 44, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 7, alignmentCenters: [6, 22] },
  { version: 4, errorCodewordsPerBlock: 18, firstGroupBlocks: 2, firstGroupData: 32, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 7, alignmentCenters: [6, 26] },
  { version: 5, errorCodewordsPerBlock: 24, firstGroupBlocks: 2, firstGroupData: 43, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 7, alignmentCenters: [6, 30] },
  { version: 6, errorCodewordsPerBlock: 16, firstGroupBlocks: 4, firstGroupData: 27, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 7, alignmentCenters: [6, 34] },
  { version: 7, errorCodewordsPerBlock: 18, firstGroupBlocks: 4, firstGroupData: 31, secondGroupBlocks: 0, secondGroupData: 0, remainderBits: 0, alignmentCenters: [6, 22, 38] },
  { version: 8, errorCodewordsPerBlock: 22, firstGroupBlocks: 2, firstGroupData: 38, secondGroupBlocks: 2, secondGroupData: 39, remainderBits: 0, alignmentCenters: [6, 24, 42] },
  { version: 9, errorCodewordsPerBlock: 22, firstGroupBlocks: 3, firstGroupData: 36, secondGroupBlocks: 2, secondGroupData: 37, remainderBits: 0, alignmentCenters: [6, 26, 46] },
  { version: 10, errorCodewordsPerBlock: 26, firstGroupBlocks: 4, firstGroupData: 43, secondGroupBlocks: 1, secondGroupData: 44, remainderBits: 0, alignmentCenters: [6, 28, 50] }
];
