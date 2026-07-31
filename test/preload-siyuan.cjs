"use strict";

const Module = require("module");

/** 可变实现，供 query 测试替换；对外始终导出同一函数引用 */
const state = {
    fetchSyncPost: async () => ({
        code: 0,
        msg: "",
        data: [],
    }),
};

const siyuanStub = {
    fetchSyncPost: (...args) => state.fetchSyncPost(...args),
    Menu: class Menu {
        addItem() {}
        open() {}
        fullscreen() {}
    },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === "siyuan") {
        return siyuanStub;
    }
    return originalLoad.apply(this, arguments);
};

globalThis.__heatmapSiyuanStub = state;
