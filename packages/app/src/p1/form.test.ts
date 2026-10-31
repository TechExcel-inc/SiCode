import { describe, expect, test } from "bun:test"
import { readMemory } from "./api"
import { decode64 } from "./doc"
import { created, encode64, entry, readLayout, readPages, readRules, readStates, readValues } from "./form"

describe("p1 form", () => {
  test("reads the pages for a spec type with every field, and keeps P1's own pages", () => {
    const pages = readPages(
      {
        GUIPageSet: {
          GUIPages: [
            {
              TypeID: 272,
              Pages: [
                { PageID: 9, PageName: "Other", Fields: [{ DataFieldID: 1101, FieldType: 5, FieldName: "Title" }] },
              ],
            },
            {
              TypeID: -1,
              Pages: [
                {
                  PageID: 1505,
                  PageName: "Description",
                  Fields: [
                    { DataFieldID: 1101, FieldType: 5, FieldName: "Title" },
                    { DataFieldID: 1105, FieldType: 23, FieldName: "Document" },
                    {
                      DataFieldID: 1113,
                      FieldType: 7,
                      FieldName: "Spec Owner",
                      IfMandotary: 1,
                      Label_Pos_Left: 10,
                      Label_Pos_Right: 100,
                      Label_Pos_Top: 50,
                      Label_Pos_Bottom: 80,
                      Ctrl_Pos_Left: 110,
                      Ctrl_Pos_Right: 500,
                      Ctrl_Pos_Top: 50,
                      Ctrl_Pos_Bottom: 80,
                    },
                  ],
                },
                { PageID: 104, PageName: "History", Fields: [] },
                { PageID: 99, PageName: "Empty", Fields: [] },
              ],
            },
          ],
        },
      },
      -1,
    )
    expect(pages).toEqual([
      {
        id: 1505,
        name: "Description",
        parent: 1505,
        fields: [
          { id: 1101, name: "Title", type: 5, at: undefined, must: false },
          { id: 1105, name: "Document", type: 23, at: undefined, must: false },
          {
            id: 1113,
            name: "Spec Owner",
            type: 7,
            at: { ll: 10, lr: 100, lt: 50, lb: 80, cl: 110, cr: 500, ct: 50, cb: 80 },
            must: true,
          },
        ],
      },
      { id: 104, name: "History", fields: [], parent: 104 },
    ])
  })

  test("lays a page out as its admin designed it, keeping what the page knew of each field", () => {
    const pages = readLayout(
      [
        {
          id: 1505,
          name: "Description",
          parent: 1505,
          fields: [{ id: 1113, name: "Spec Owner", type: 7, must: true }],
        },
        { id: 77, name: "How to Test", parent: 77, fields: [{ id: 1601, name: "Test", type: 6 }] },
      ],
      {
        1505: {
          Data: [
            {
              FieldID: 1105,
              FieldName: "Document",
              FieldType: 23,
              Label_Pos_Left: 2,
              Label_Pos_Right: 82,
              Label_Pos_Top: 300,
              Label_Pos_Bottom: 330,
              Ctrl_Pos_Left: 86,
              Ctrl_Pos_Right: 1000,
              Ctrl_Pos_Top: 300,
              Ctrl_Pos_Bottom: 500,
            },
            {
              FieldID: 1113,
              FieldName: "Spec Owner",
              FieldType: 7,
              Label_Pos_Left: 2,
              Label_Pos_Right: 82,
              Label_Pos_Top: 10,
              Label_Pos_Bottom: 40,
              Ctrl_Pos_Left: 86,
              Ctrl_Pos_Right: 500,
              Ctrl_Pos_Top: 10,
              Ctrl_Pos_Bottom: 40,
            },
          ],
        },
      },
    )
    expect(pages[0].fields.map((field) => [field.id, field.type, field.must, field.at?.cr])).toEqual([
      [1105, 23, false, 1000],
      [1113, 7, true, 500],
    ])
    expect(pages[1].fields).toEqual([{ id: 1601, name: "Test", type: 6 }])
  })

  test("reads values, states and rules", () => {
    expect(
      readValues({
        Values: [
          { ID: 1114, ChoiceId: 71, Value: "Design Review" },
          { ID: 1102, Value: "x", ValueHTML: encode64("<p>需求</p>") },
        ],
      }),
    ).toEqual({
      1114: { value: "Design Review", choice: "71", html: "" },
      1102: { value: "x", choice: "", html: "<p>需求</p>" },
    })
    expect(
      readStates({
        TransitionSet: {
          Transition: [
            { NextStateID: 70, NextStateName: "Committed", TransitionID: 201, NextIsActive: 1 },
            {
              NextStateID: 9,
              NextStateName: "Dropped",
              TransitionName: "Drop Request",
              TransitionID: 202,
              NextIsActive: 0,
            },
          ],
        },
      }),
    ).toEqual([
      { id: 70, name: "Committed", transition: 201, closed: false },
      { id: 9, name: "Drop Request", transition: 202, closed: true },
    ])
    expect(readStates({ StatusList: [{ StateID: 62, StateName: "Finished", IsClosed: 1 }] })).toEqual([
      { id: 62, name: "Finished", transition: 0, closed: true },
    ])
    expect(
      readRules(
        {
          AllFieldReadonly: 0,
          Pages: [
            { PageID: 0, ReadonlyIDs: "1104", InvisibleIDs: "", MandatoryIDs: "1113" },
            { PageID: 1505, ReadonlyIDs: "", InvisibleIDs: "1611", MandatoryIDs: "1113,1131" },
            { PageID: 77, ReadonlyIDs: "1101", InvisibleIDs: "", MandatoryIDs: "" },
          ],
        },
        [1505],
      ),
    ).toEqual({ readonly: [1104], hidden: [1611], required: [1113, 1131], locked: false })
  })

  test("builds what P1 saves", () => {
    expect(entry({ id: 1113, name: "Owner", type: 7 }, { value: "Ada", choice: "657", html: "" })).toEqual({
      ID: 1113,
      ChoiceId: 657,
    })
    expect(entry({ id: 13002, name: "Module", type: 8 }, { value: "", choice: "1,2", html: "" })).toEqual({
      ID: 13002,
      ChoiceId: "1,2",
    })
    const html = entry(
      { id: 1102, name: "Description", type: 6 },
      { value: "", choice: "", html: "<p>Hi &amp; bye</p>" },
    )
    expect("ValueHTML" in html && decode64(String(html.ValueHTML))).toBe("<p>Hi &amp; bye</p>")
    expect("Value" in html && decode64(String(html.Value))).toBe("Hi & bye")
    const body = created({
      project: 190,
      folder: 17243,
      user: "20",
      name: "Tieren Zhou",
      state: { id: 71, name: "Design Review", transition: 208 },
      owner: { id: 657, name: "Yue Li" },
      fields: [
        { id: 1101, name: "Title", type: 5 },
        { id: 1145, name: "PriorityType", type: 7 },
      ],
      values: {
        1101: { value: "New one", choice: "", html: "" },
        1145: { value: "3 - High", choice: "236", html: "" },
      },
    })
    expect(body).toMatchObject({
      ProjectID: 190,
      FolderID: 17243,
      Title: "New one",
      1101: "New one",
      StatusID: 71,
      1114: 71,
      "Spec OwnerID": 657,
      1113: 657,
      1145: 236,
    })
  })

  test("reads the remembered tree: selected folder first, then the open ones", () => {
    expect(readMemory({ Data: [{ PreferenceText: "9128,9128,9207,16876" }] })).toEqual({
      folder: 9128,
      open: [9128, 9207, 16876],
    })
    expect(readMemory({ Data: [] })).toEqual({ folder: 0, open: [] })
  })
})
