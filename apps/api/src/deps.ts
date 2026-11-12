// The real implementations of every route dependency: the core in ../../../src. server.ts uses this,
// and so do the route tests that run against an in-memory database.

import { answerFlag, applyAnswer } from "../../../src/agent/apply";
import { getClient, MODEL } from "../../../src/agent/client";
import { runAgent } from "../../../src/agent/service";
import { fetchMonth, importStatement } from "../../../src/imports";
import * as store from "../../../src/store";
import type { Deps } from "./app";

export function realDeps(): Deps {
  return {
    listMonths: store.listAllMonths,
    loadTransactions: store.loadTransactions,
    loadRules: store.loadRules,
    importStatement,
    listImports: store.listImports,
    fetchMonth: (month) => fetchMonth(month),
    searchTransactions: store.searchTransactions,
    editTransaction: store.editTransaction,
    listRules: store.listRules,
    setRule: store.setRule,
    updateRule: store.updateRule,
    deleteRule: store.deleteRule,
    listCategories: store.listCategories,
    addCategory: store.addCategory,
    renameCategory: store.renameCategory,
    deleteCategory: store.deleteCategory,
    // The real model, created on first use. The API key stays on the server.
    runAgent: (month) => runAgent({ month, client: getClient(), model: MODEL }),
    latestRun: store.latestRun,
    listProposals: store.listProposals,
    listFlags: store.listFlags,
    answerProposal: (id, answer) => applyAnswer(id, answer),
    answerFlag: (id, answer) => answerFlag(id, answer),
    listRecurring: store.listRecurring,
    createRecurring: store.createRecurring,
    updateRecurring: store.updateRecurring,
    changeRecurringFrom: store.changeRecurringFrom,
    deleteRecurring: store.deleteRecurring,
    setRecurringMonth: store.setRecurringMonth,
    recurringMonth: store.recurringMonth,
  };
}
