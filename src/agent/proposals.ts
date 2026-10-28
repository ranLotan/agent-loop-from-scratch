import type { Candidate } from "../candidates";
import type { CategoryProposal, ExceptionFlag } from "./tools";

/** data/proposals/YYYY-MM.json: the agent's output, waiting for human review. */
export interface ProposalsFile {
  month: string;
  createdAt: string;
  model: string;
  proposals: CategoryProposal[];
  flags: (ExceptionFlag & { candidate: Candidate })[];
  /** Merchants and flag ids the human has already answered, so `approve` can resume. */
  reviewed: string[];
}
