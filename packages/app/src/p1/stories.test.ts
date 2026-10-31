import { describe, expect, test } from "bun:test"
import { aim, areas, hours, readStories, rollup, spread, type Task } from "./stories"

describe("p1 stories", () => {
  test("reads hours the way P1 writes them", () => {
    expect(hours("1.5h")).toBe(1.5)
    expect(hours("90m")).toBe(1.5)
    expect(hours(2)).toBe(2)
    expect(hours("")).toBe(0)
  })

  test("reads a spec's stories with their tasks, and a story's modules from both", () => {
    const [story] = readStories({
      Success: true,
      Data: [
        {
          StoryItemId: 7,
          DisplayId: "S-7",
          ProjectId: 40,
          ParentSubProjectId: 41,
          StoryTitle: "Bulk edit",
          CurrentOwnerId: 3,
          CurrentOwnerName: "David He",
          ImplementationModuleId: 10,
          ImplementationModuleName: "Web",
          StoryPoints: 5,
          TimeSpent: "3h",
          FinishPercentage: 60,
          LinkedTasks: [
            {
              IssueId: 70,
              Title: "Validate",
              CurrentOwnerId: 3,
              ImplementationModuleId: 10,
              ImplementationModuleName: "Web",
              TaskPoints: 3,
              TimeSpent: "2.5h",
              TimeRemain: "1h",
              FinishPercentage: 80,
            },
            {
              IssueId: 71,
              Title: "Errors",
              CurrentOwnerId: 4,
              ImplementationModuleId: 11,
              ImplementationModuleName: "API",
              TaskPoints: 2,
              TimeSpent: "0.5h",
            },
          ],
        },
      ],
    })
    expect(story.name).toBe("Bulk edit")
    expect(story.spent).toBe(3)
    expect(story.tasks.map((task) => [task.id, task.spent, task.remain, task.finish])).toEqual([
      [70, 2.5, 1, 80],
      [71, 0.5, 0, 0],
    ])
    expect(story.remain).toBe(1)
    expect(story.target).toBe(5)
    expect(areas(story).map((item) => item.name)).toEqual(["Web", "API"])
  })

  test("starts a task's remaining time at its points, and names a story's module when P1 leaves it out", () => {
    const [story] = readStories([
      {
        StoryItemId: 8,
        ImplementationModuleId: 10,
        ImplementationModuleName: "",
        StoryPoints: 4,
        LinkedTasks: [
          { IssueId: 80, ImplementationModuleId: 10, ImplementationModuleName: "", TaskPoints: 4, TimeRemain: "0h" },
        ],
      },
    ])
    expect(story.tasks[0].remain).toBe(4)
    expect(story.remain).toBe(4)
    expect(areas(story, [{ id: 10, name: "DevTest Web" }])).toEqual([{ id: 10, name: "DevTest Web" }])
    expect(areas(story)).toEqual([])
  })

  test("spreads a story's time over its tasks", () => {
    const task = (remain: number) => ({ remain }) as Task
    expect(spread([task(1), task(3)], 120)).toEqual([30, 90])
    expect(spread([task(0), task(0), task(0)], 100)).toEqual([33, 33, 34])
    expect(spread([task(2)], 45)).toEqual([45])
  })

  test("reads a story's target time back in seconds and saves it in minutes, with whole points beside it", () => {
    const [story] = readStories({ Data: [{ StoryItemId: 9, StoryPoints: 4, StoryEstimatedTime: 12600 }] })
    expect(story.target).toBe(3.5)
    expect(story.remain).toBe(3.5)
    expect(aim(3.5)).toEqual({ StoryEstimatedTime: 210, StoryPoints: 4 })
  })

  test("keeps a story's own time left while its related-module tasks have none", () => {
    const [story] = readStories({
      Data: [
        {
          StoryItemId: 9,
          StoryEstimatedTime: 12600,
          LinkedTasks: [
            { IssueId: 1, ImplementationModuleId: 10, TaskPoints: 0 },
            { IssueId: 2, ImplementationModuleId: 11, TaskPoints: 0 },
          ],
        },
      ],
    })
    expect(story.remain).toBe(3.5)
    expect(story.tasks.map((task) => task.remain)).toEqual([0, 0])
  })

  test("rolls a story's % finish up from its tasks, weighted by their hours", () => {
    const [story, lone] = readStories({
      Data: [
        {
          StoryItemId: 9,
          FinishPercentage: 5,
          LinkedTasks: [
            { IssueId: 1, TimeSpent: "6h", TimeRemain: "0h", FinishPercentage: 100 },
            { IssueId: 2, TimeSpent: "0h", TimeRemain: "2h", FinishPercentage: 0 },
          ],
        },
        { StoryItemId: 10, FinishPercentage: 40 },
      ],
    })
    expect(story.finish).toBe(75)
    expect(lone.finish).toBe(40)
    expect(
      rollup([
        { spent: 0, remain: 0, finish: 100 },
        { spent: 0, remain: 0, finish: 0 },
      ]),
    ).toBe(50)
  })
})
