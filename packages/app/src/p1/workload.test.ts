import { describe, expect, test } from "bun:test"
import { achieved, period, readReviews, readScores, readSummary, reviewed, spans, standing, team } from "./workload"

describe("p1 workload", () => {
  test("reads the month's spec points and each member's points, workload and completion", () => {
    const got = readSummary({
      AllSpecPoints: 440,
      AllSpecFinishPoints: 16.23,
      AllAssignedSpecPoints: 48.38,
      AllWorkload: 11,
      SpecWorkSummarys: [
        {
          UserID: 1276,
          UserName: "Hui Zhang",
          AssignedSpecPoints: 3,
          TargetSpecPoints: 40,
          TaskPoints: 40,
          TargetTaskPoints: 40,
          Workload: 7,
          TaskWorkload: 100,
          Complete: 0,
        },
        {
          UserID: 578,
          UserName: "David He",
          AssignedSpecPoints: 44,
          TargetSpecPoints: 20,
          TaskPoints: 46,
          TargetTaskPoints: 20,
          Workload: 219,
          TaskWorkload: 230,
          Complete: 35,
        },
      ],
    })
    expect([got.finished, got.points, got.load]).toEqual([16.23, 440, 11])
    expect(
      got.members.map((item) => [item.name, item.spec, item.target, item.task, item.tasks, item.work, item.done]),
    ).toEqual([
      ["David He", 44, 20, 46, 20, 230, 35],
      ["Hui Zhang", 3, 40, 40, 40, 100, 0],
    ])
  })

  test("reads monthly scores and averages the team's", () => {
    const marks = readScores(
      {
        Data: {
          MonthlyScores: [
            { MonthId: 202609, PersonScores: [{ PersonId: 1, AverageScore: 9 }] },
            {
              MonthId: 202610,
              PersonScores: [
                { PersonId: 1, AverageScore: 3.6 },
                { PersonId: 2, AverageScore: 2 },
                { PersonId: 3, AverageScore: 0.9 },
              ],
            },
          ],
        },
      },
      "202610",
    )
    expect(marks).toEqual({ 1: 3.6, 2: 2, 3: 0.9 })
    expect(team(marks)).toBe(2.2)
    expect(team(marks, [1, 2, 9])).toBe(2.8)
    expect(team({})).toBeUndefined()
    expect(standing(marks, [1, 2, 9])).toEqual({ score: 2.8, high: 3.6, low: 2 })
    expect(standing({})).toBeUndefined()
  })

  test("scores WO reviews from reviewers who may score and have, out of their full score", () => {
    expect(
      achieved([
        { ReportToOption: 1, Score: 8, FullScore: 10 },
        { ReportToOption: 2, Score: 3, FullScore: 5 },
        { ReportToOption: 3, Score: 1, FullScore: 10 },
        { ReportToOption: 1, Score: 0, FullScore: 10 },
      ]),
    ).toBe(70)
    const syncs = {
      Data: [
        {
          MemberId: 578,
          MindSyncs: [
            { WeekNo: 0, WorkObjectives: [{ WeekId: 20260928, Reviewers: [{ ReportToOption: 1, Score: 5 }] }] },
            {
              WeekNo: 1,
              WorkObjectives: [{ WeekId: 20261005, Reviewers: [{ ReportToOption: 1, Score: 9, FullScore: 10 }] }],
            },
            { WeekNo: 2, WorkObjectives: [{ WeekId: 20261012, Reviewers: [] }] },
          ],
        },
      ],
    }
    // The month averages the weeks with a score; a week takes its own review, else the carried-over one.
    expect(readReviews(syncs, { week: 0, from: 20261001, to: 20261031 })).toEqual({ 578: 70 })
    expect(readReviews(syncs, { week: 2, from: 20261005, to: 20261011 })).toEqual({ 578: 90 })
    expect(readReviews(syncs, { week: 1, from: 20261001, to: 20261004 })).toEqual({ 578: 50 })
  })

  test("counts members as reviewed only with a WO template and review left on", () => {
    const prefs = {
      Data: [
        { UserId: 1, Preferences: [{ PrefId: 6, PreferenceText: "0" }] },
        { UserId: 2, Preferences: [{ PrefId: 6, PreferenceText: "1" }] },
        { UserId: 3, Preferences: [] },
      ],
    }
    const templates = {
      Data: [
        { PersonId: 1, WorkObjectiveTemplates: [{ TemplateId: 159 }] },
        { PersonId: 2, WorkObjectiveTemplates: [{ TemplateId: 158 }] },
        { PersonId: 4, WorkObjectiveTemplates: [{ TemplateId: 150 }] },
      ],
    }
    expect(reviewed(prefs, templates)).toEqual([1])
  })

  test("splits a month into P1's tabs and its summary line's days", () => {
    expect(spans("202610")).toEqual([
      { week: 0, from: 20261001, to: 20261031 },
      { week: 1, from: 20261001, to: 20261004 },
      { week: 2, from: 20261005, to: 20261011 },
      { week: 3, from: 20261012, to: 20261018 },
      { week: 4, from: 20261019, to: 20261025 },
      { week: 5, from: 20261026, to: 20261031 },
    ])
    // October 2026 starts on a Thursday, so the line counts from Monday the 5th.
    expect(period("202610")).toEqual({ week: 0, from: 20261005, to: 20261031 })
    // June 2026 starts on a Monday.
    expect(period("202606").from).toBe(20260601)
  })
})
