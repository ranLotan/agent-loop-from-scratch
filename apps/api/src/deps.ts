// The real implementations of every route dependency: the core in ../../../src. server.ts uses this,
// and so do the route tests that run against an in-memory database.

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
  };
}
