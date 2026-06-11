// The brush-zoom slice: a dragged window becomes the chart view, with the
// estimated/recorded boundary staying honest inside the slice.
import { describe, expect, it } from "vitest";
import { zoomSlice } from "./AccountStack";

const times = [10, 20, 30, 40, 50, 60];
const bands = [{ values: [1, 2, 3, 4, 5, 6] }, { values: [10, 20, 30, 40, 50, 60] }];

describe("zoomSlice", () => {
  it("slices times and every band to the dragged window (inclusive bounds)", () => {
    const z = zoomSlice(times, bands, 0, 20, 50)!;
    expect(z.times).toEqual([20, 30, 40, 50]);
    expect(z.bands[0].values).toEqual([2, 3, 4, 5]);
    expect(z.bands[1].values).toEqual([20, 30, 40, 50]);
    expect(z.splitIndex).toBe(0);
  });

  it("snaps loose drag edges to the available points", () => {
    const z = zoomSlice(times, bands, 0, 14, 47)!;
    expect(z.times).toEqual([20, 30, 40]);
  });

  it("re-bases the estimated/recorded divider into the slice", () => {
    // splitIndex 3 → boundary at t=40.
    expect(zoomSlice(times, bands, 3, 20, 60)!.splitIndex).toBe(2); // divider mid-slice
    expect(zoomSlice(times, bands, 3, 40, 60)!.splitIndex).toBe(0); // all recorded
    const allEst = zoomSlice(times, bands, 6, 10, 40)!;
    expect(allEst.splitIndex).toBeGreaterThanOrEqual(allEst.times.length); // all estimated
  });

  it("refuses windows with fewer than 3 points", () => {
    expect(zoomSlice(times, bands, 0, 20, 30)).toBeNull();
    expect(zoomSlice(times, bands, 0, 100, 200)).toBeNull();
  });
});
