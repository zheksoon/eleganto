import type { IRevision } from "../types";

let revisionId: IRevision = 0;

export const newRevision = (): IRevision => {
  return revisionId++;
};
