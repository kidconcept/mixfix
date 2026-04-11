import { describe, it, expect } from "vitest";
import {
  getUTCWindowForLocalDate,
  convertUTCToLocalDate,
} from "../timezone";

// NOTE: normalizeUTCTimestamp and zonedLocalDateTimeToUTC are not exported
// directly, but we can test them through the public API (getUTCWindowForLocalDate,
// convertUTCToLocalDate). For normalizeUTCTimestamp we test via convertUTCToLocalDate
// which calls it internally.

describe("getUTCWindowForLocalDate", () => {
  it("offsets Eastern (EST, UTC-5) midnight to 05:00 UTC", () => {
    // Jan 15 is standard time (EST = UTC-5)
    const window = getUTCWindowForLocalDate("2024-01-15", "America/New_York");
    // Local midnight 2024-01-15 EST = 2024-01-15T05:00:00Z
    expect(window.startUTCISO).toBe("2024-01-15T05:00:00.000Z");
    // Local midnight 2024-01-16 EST = 2024-01-16T05:00:00Z
    expect(window.endUTCISO).toBe("2024-01-16T05:00:00.000Z");
  });

  it("covers a full local day across DST spring forward (Denver)", () => {
    // 2024-03-10: DST begins in US (clocks spring forward 2AM → 3AM)
    // America/Denver: MST (UTC-7) → MDT (UTC-6)
    const window = getUTCWindowForLocalDate("2024-03-10", "America/Denver");
    // Local midnight start is still MST: 2024-03-10T07:00:00Z
    expect(window.startUTCISO).toBe("2024-03-10T07:00:00.000Z");
    // Next local midnight is now MDT: 2024-03-11T06:00:00Z — only 23h span
    expect(window.endUTCISO).toBe("2024-03-11T06:00:00.000Z");
    // Verify the window is exactly 23 hours (DST spring forward loses 1 hour)
    const spanHours =
      (new Date(window.endUTCISO).getTime() - new Date(window.startUTCISO).getTime()) /
      (60 * 60 * 1000);
    expect(spanHours).toBe(23);
  });

  it("extends end by bufferAfterHours", () => {
    const window = getUTCWindowForLocalDate("2024-01-15", "America/New_York", {
      bufferAfterHours: 1,
    });
    // Normal end would be 2024-01-16T05:00:00Z; +1h buffer = 06:00:00Z
    expect(window.endUTCISO).toBe("2024-01-16T06:00:00.000Z");
    // Start unaffected
    expect(window.startUTCISO).toBe("2024-01-15T05:00:00.000Z");
  });
});

describe("zonedLocalDateTimeToUTC (via getUTCWindowForLocalDate)", () => {
  it("converts a standard summer Eastern time correctly", () => {
    // EDT = UTC-4 in summer. Midnight June 15 local → 04:00 UTC
    const window = getUTCWindowForLocalDate("2024-06-15", "America/New_York");
    expect(window.startUTCISO).toBe("2024-06-15T04:00:00.000Z");
  });

  it("handles DST spring forward without crashing", () => {
    // The function should produce a valid result even for the DST transition date
    const window = getUTCWindowForLocalDate("2024-03-10", "America/Denver");
    expect(window.startUTCISO).toBeTruthy();
    expect(window.endUTCISO).toBeTruthy();
    // Start must be before end
    expect(new Date(window.startUTCISO).getTime()).toBeLessThan(
      new Date(window.endUTCISO).getTime()
    );
  });
});

describe("convertUTCToLocalDate", () => {
  it("converts early UTC hour to previous local date in Pacific", () => {
    // 2024-07-04T03:00 UTC = 2024-07-03 20:00 PDT (UTC-7)
    const localDate = convertUTCToLocalDate("2024-07-04T03", "America/Los_Angeles");
    expect(localDate).toBe("2024-07-03");
  });
});

describe("normalizeUTCTimestamp (via convertUTCToLocalDate)", () => {
  it("rolls hour 24 to next day", () => {
    // "2024-03-10T24" should be treated as 2024-03-11T00:00:00Z
    // Converting to UTC local date should give 2024-03-11
    const localDate = convertUTCToLocalDate("2024-03-10T24", "UTC");
    expect(localDate).toBe("2024-03-11");
  });

  it("returns empty string for empty input", () => {
    const localDate = convertUTCToLocalDate("", "UTC");
    expect(localDate).toBe("");
  });
});
