import * as assert from "node:assert/strict";
import {
    describe,
    it,
} from "node:test";
import {
    buildYearOptions,
    expandYearRange,
    isDisplayMode,
    isStatMode,
    isViewMode,
    isWeekStart,
    isYearOrder,
    normalizeFromYear,
    normalizeIncludedBoxIds,
} from "./config";

describe("expandYearRange", () => {
    it("展开闭区间年份，含端点", () => {
        assert.deepEqual(expandYearRange(2022, 2024), [2022, 2023, 2024]);
        assert.deepEqual(expandYearRange(2024, 2024), [2024]);
    });

    it("起止颠倒时仍按升序展开", () => {
        assert.deepEqual(expandYearRange(2024, 2022), [2022, 2023, 2024]);
    });
});

describe("buildYearOptions", () => {
    const now = new Date(2026, 6, 31);

    it("至少包含今年，且按从新到旧排列", () => {
        assert.deepEqual(buildYearOptions(null, null, now), [2026]);
    });

    it("从库内最早年延伸到今年", () => {
        assert.deepEqual(buildYearOptions(2024, null, now), [2026, 2025, 2024]);
    });

    it("已选 fromYear 早于库内最早年时仍纳入选项", () => {
        assert.deepEqual(buildYearOptions(2025, 2023, now), [2026, 2025, 2024, 2023]);
    });

    it("未来已选年不会抬高上界，上界仍是今年", () => {
        assert.deepEqual(buildYearOptions(null, 2030, now), [2026]);
    });
});

describe("配置值校验", () => {
    it("识别合法统计方式", () => {
        assert.equal(isStatMode("created"), true);
        assert.equal(isStatMode("updated"), true);
        assert.equal(isStatMode("mixed"), true);
        assert.equal(isStatMode("create"), false);
        assert.equal(isStatMode(""), false);
        assert.equal(isStatMode(null), false);
    });

    it("识别合法周起始", () => {
        assert.equal(isWeekStart("monday"), true);
        assert.equal(isWeekStart("sunday"), true);
        assert.equal(isWeekStart("Saturday"), false);
    });

    it("识别合法年份排序与显示范围、展示形式", () => {
        assert.equal(isYearOrder("newestFirst"), true);
        assert.equal(isYearOrder("oldestFirst"), true);
        assert.equal(isYearOrder("asc"), false);

        assert.equal(isDisplayMode("recent"), true);
        assert.equal(isDisplayMode("years"), true);
        assert.equal(isDisplayMode("all"), false);

        assert.equal(isViewMode("heatmap"), true);
        assert.equal(isViewMode("calendar"), true);
        assert.equal(isViewMode("list"), false);
    });
});

describe("normalizeFromYear", () => {
    it("接受合理整数年份", () => {
        assert.equal(normalizeFromYear(2020), 2020);
        assert.equal(normalizeFromYear("1999"), 1999);
        assert.equal(normalizeFromYear(1970), 1970);
        assert.equal(normalizeFromYear(2100), 2100);
    });

    it("拒绝非整、越界与空值", () => {
        assert.equal(normalizeFromYear(2020.5), null);
        assert.equal(normalizeFromYear(1969), null);
        assert.equal(normalizeFromYear(2101), null);
        assert.equal(normalizeFromYear("abc"), null);
        assert.equal(normalizeFromYear(null), null);
        assert.equal(normalizeFromYear(undefined), null);
        assert.equal(normalizeFromYear(""), null);
    });
});

describe("normalizeIncludedBoxIds", () => {
    it("null / 缺省 / 非数组回退为不限制", () => {
        assert.equal(normalizeIncludedBoxIds(null), null);
        assert.equal(normalizeIncludedBoxIds(undefined), null);
        assert.equal(normalizeIncludedBoxIds("box"), null);
        assert.equal(normalizeIncludedBoxIds(1), null);
    });

    it("保留空数组（表示不统计任何笔记本）", () => {
        assert.deepEqual(normalizeIncludedBoxIds([]), []);
    });

    it("去重并丢弃非法项", () => {
        assert.deepEqual(
            normalizeIncludedBoxIds(["a", "  ", "b", "a", 1, null, " c "]),
            ["a", "b", "c"],
        );
    });
});
