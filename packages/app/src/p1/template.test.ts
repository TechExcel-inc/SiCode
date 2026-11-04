import { describe, expect, test } from "bun:test"
import { body, readChoices, readOwners, readPages, readRules, readStates } from "./template"

describe("p1 new test case", () => {
  test("reads the tabs P1 picks for a new test case, in its order", () => {
    expect(
      readPages({
        TestTemplatePage: {
          GUIFunctionPages: [{ FunctionID: 1, FunctionPage: "2,106" }],
          GUIPages: [
            {
              Pages: [
                { PageID: 1, PageName: "Other", Fields: [{ FieldID: 1101 }] },
                { PageID: 2, PageName: "Template Description", Fields: [{ FieldID: 1101 }, { FieldID: 1010, FieldName: "Owner" }] },
                { PageID: 106, PageName: "Environment Variable" },
              ],
            },
          ],
        },
        TestTemplateField: [{ id: 1101, name: "Title", type: 5 }, { id: 1010, name: "Template Owner", type: 7 }],
      }),
    ).toEqual([
      {
        id: 2,
        name: "Template Description",
        parent: 2,
        fields: [
          { id: 1101, name: "Title", type: 5 },
          { id: 1010, name: "Owner", type: 7 },
        ],
      },
      { id: 106, name: "Environment Variable", parent: 106, fields: [] },
    ])
  })

  test("reads states from transitions or state definitions", () => {
    expect(
      readStates({
        TempDetailPageInfo: {
          WorkflowSetting: { EnableStateTransition: 0 },
          StateSet: { StateDefs: [{ StateID: 2, StateName: "Draft" }, { StateID: 5, StateName: "Done", IsClosed: true }] },
        },
      }),
    ).toEqual([
      { id: 2, name: "Draft", transition: 0, closed: false },
      { id: 5, name: "Done", transition: 0, closed: true },
    ])
    expect(
      readStates({
        TempDetailPageInfo: {
          WorkflowSetting: { EnableStateTransition: 1 },
          TransitionSet: { Transitions: [{ NextStateID: 3, NextStateName: "Approved", TransitionID: 8 }] },
        },
      }),
    ).toEqual([{ id: 3, name: "Approved", transition: 8, closed: false }])
  })

  test("reads field rules, choices and owners", () => {
    expect(readRules({ Pages: [{ PageID: 2, MandatoryIDs: "2-1101,2-1010", ReadonlyIDs: "", InvisibleIDs: "1014" }] })).toEqual({
      required: [1101, 1010],
      readonly: [],
      hidden: [1014],
    })
    expect(readChoices([{ ChoiceList: [{ ChoiceID: 4, ChoiceName: "High" }] }])).toEqual([{ id: 4, name: "High" }])
    expect(readOwners({ Data: [{ MemberId: { Id: 7 }, MemberName: "Guifu Zhao" }, { UserID: 8, UserName: "Ann" }] })).toEqual([
      { id: 7, name: "Guifu Zhao" },
      { id: 8, name: "Ann" },
    ])
  })

  test("builds NewEx's body: seconds, base64 rich text, ids, the parent spec", () => {
    const pages = [
      {
        id: 2,
        name: "",
        parent: 2,
        fields: [
          { id: 1101, name: "Title", type: 5 },
          { id: 1010, name: "Owner", type: 7 },
          { id: 1015, name: "Est. Test Time", type: 1 },
          { id: 1102, name: "Procedure", type: 6 },
          { id: 1166, name: "Parent Requirement", type: 5 },
          { id: 1169, name: "Product Module", type: 7 },
        ],
      },
    ]
    expect(
      body({
        project: 9,
        folder: 3,
        id: 8901,
        pages,
        spec: { project: 1, id: 30402 },
        values: { 1101: "Bulk edit", 1010: "7", 1015: "1800", 1102: "<p>Go</p>", 1008: "2" },
      }),
    ).toEqual({
      projectId: 9,
      folderId: 3,
      preAllocatedTempId: 8901,
      fields: [{ 1101: "Bulk edit" }, { 1010: 7 }, { 1015: 1800 }, { 1102: "PHA+R288L3A+" }, { 1166: "1:30402" }, { 1008: 2 }],
      specProjectId: 1,
      reqID: 30402,
    })
  })
})
