import * as assert from "node:assert/strict";
import {
    describe,
    it,
} from "node:test";
import {getI18n} from "./i18n";

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
            assert.equal(i18n.openHeatMap, "热力图");
            assert.equal(i18n.weekdays.length, 7);
            assert.equal(i18n.months.length, 12);
            assert.equal(i18n.weekdays[0], "日");
            assert.ok(i18n.totalCount.includes("${count}"));
        });
    });

    it("zh 前缀均视为中文", () => {
        withLang("zh_TW", () => {
            assert.equal(getI18n().heatmapTitle, "笔记热力图");
        });
    });

    it("非中文回退英文", () => {
        withLang("en_US", () => {
            const i18n = getI18n();
            assert.equal(i18n.openHeatMap, "Heat Map");
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
