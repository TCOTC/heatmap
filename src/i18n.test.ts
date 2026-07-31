import * as assert from "node:assert/strict";
import {
    describe,
    it,
} from "node:test";
import {
    getDefaultWeekStart,
    getI18n,
} from "./i18n";

function withLang(lang: string | undefined, run: () => void): void {
    const g = globalThis as any;
    const prev = g.window;
    g.window = {siyuan: {config: lang === undefined ? {} : {lang}}};
    try {
        run();
    } finally {
        if (prev === undefined) {
            delete g.window;
        } else {
            g.window = prev;
        }
    }
}

describe("getI18n", () => {
    it("中文语言返回中文文案", () => {
        withLang("zh_CN", () => {
            const i18n = getI18n();
            assert.equal(i18n.openHeatMap, "文档热力统计");
            assert.equal(i18n.weekdays.length, 7);
            assert.equal(i18n.months.length, 12);
            assert.equal(i18n.weekdays[0], "日");
            assert.ok(i18n.totalCount.includes("${count}"));
        });
    });

    it("zh 前缀均视为中文", () => {
        withLang("zh_TW", () => {
            assert.equal(getI18n().heatmapTitle, "文档热力统计");
        });
    });

    it("非中文回退英文", () => {
        withLang("en_US", () => {
            const i18n = getI18n();
            assert.equal(i18n.openHeatMap, "Document Heat Stats");
            assert.equal(i18n.weekdays[0], "Sun");
            assert.equal(i18n.months[0], "Jan");
        });
    });

    it("缺失语言配置时回退英文", () => {
        withLang(undefined, () => {
            assert.equal(getI18n().loading, "Loading…");
        });
    });
});

describe("getDefaultWeekStart", () => {
    it("中文默认周一", () => {
        withLang("zh_CN", () => {
            assert.equal(getDefaultWeekStart(), "monday");
        });
    });

    it("英文默认周日", () => {
        withLang("en_US", () => {
            assert.equal(getDefaultWeekStart(), "sunday");
        });
    });

    it("缺失语言配置时默认周日", () => {
        withLang(undefined, () => {
            assert.equal(getDefaultWeekStart(), "sunday");
        });
    });
});
