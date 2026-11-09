import type { ComposeDraft } from "../../interfaces/models.js";

export const mailboxActions: {
  render: () => Promise<void>;
  openComposer: (draft?: ComposeDraft) => void;
} = {
  render: async () => undefined,
  openComposer: () => undefined
};
