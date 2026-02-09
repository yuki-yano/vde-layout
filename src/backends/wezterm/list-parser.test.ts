import { describe, expect, it } from "vitest"

import { parseWeztermListResult } from "./list-parser"

describe("parseWeztermListResult", () => {
  it("parses array-form list output and groups panes by window/tab", () => {
    const stdout = JSON.stringify([
      { window_id: 1, tab_id: 2, pane_id: 10, is_active: true },
      { window_id: 1, tab_id: 2, pane_id: 11, is_active: false },
      { window_id: 1, tab_id: 3, pane_id: 12, is_active: false },
    ])

    expect(parseWeztermListResult(stdout)).toEqual({
      windows: [
        {
          windowId: "1",
          isActive: true,
          workspace: undefined,
          tabs: [
            {
              tabId: "2",
              isActive: true,
              panes: [
                { paneId: "10", isActive: true },
                { paneId: "11", isActive: false },
              ],
            },
            {
              tabId: "3",
              isActive: false,
              panes: [{ paneId: "12", isActive: false }],
            },
          ],
        },
      ],
    })
  })

  it("parses object-form list output and filters invalid entries", () => {
    const stdout = JSON.stringify({
      windows: [
        {
          window_id: "w1",
          is_active: true,
          workspace: "dev",
          tabs: [
            {
              tab_id: "tab-1",
              is_active: true,
              panes: [
                { pane_id: "10", is_active: true },
                { pane_id: null, is_active: false },
              ],
            },
          ],
        },
        {
          window_id: null,
          tabs: [],
        },
      ],
    })

    expect(parseWeztermListResult(stdout)).toEqual({
      windows: [
        {
          windowId: "w1",
          isActive: true,
          workspace: "dev",
          tabs: [
            {
              tabId: "tab-1",
              isActive: true,
              panes: [{ paneId: "10", isActive: true }],
            },
          ],
        },
      ],
    })
  })

  it("returns undefined when output is invalid json", () => {
    expect(parseWeztermListResult("not-json")).toBeUndefined()
  })
})
