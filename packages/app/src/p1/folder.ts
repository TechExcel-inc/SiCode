import { call } from "./api"

/** A requirement folder as P1's folder dialog reads and saves it (`GET`/`PUT`/`POST ReqFolder`). */

/** Where a new folder goes relative to the selected one: inside it, above it or below it. */
export type Place = 0 | -1 | 1

export type Shape = {
  name: string
  open: boolean
  type: number
  html: string
  start: string
  end: string
  /** Roadmap months as YYYYMM. */
  from: string
  to: string
  parent: string
}

/** Folder types SiCode lets you pick, by id: P1's regular, release and roadmap month folders. */
export const types: Record<number, string> = {
  0: "Regular",
  36: "Release",
  30: "Roadmap Month",
}

/** Every folder type's name, for showing one P1 set elsewhere. */
export const names: Record<number, string> = {
  ...types,
  31: "Customer Service",
  37: "Product Service Project",
  32: "Customer Requirement",
  33: "Review And Change Management",
  34: "Requirement Management",
  35: "BOM",
  38: "Vendor",
  39: "Product Requirement",
  40: "Additional Requirement",
  41: "Supplier",
}

/** Roadmap-type folders need their months. */
export function roadmap(type: number) {
  return type >= 30 && type <= 35
}

export function readFolder(data: unknown): Shape {
  const row = record(data) ? data : {}
  const text = (key: string) => (row[key] === undefined || row[key] === null ? "" : String(row[key]))
  const path = Array.isArray(row.FolderPath) ? row.FolderPath.map(String) : []
  return {
    name: text("Folder Name"),
    open: text("Folder Status") !== "Close",
    type: Number(row.TypeID) || 0,
    html: text("Folder Description"),
    start: text("PlanStartDate").slice(0, 10),
    end: text("PlanEndDate").slice(0, 10),
    from: text("RoadMapMonthStart"),
    to: text("RoadMapMonthEnd"),
    parent: path.slice(0, -1).join(" / "),
  }
}

export async function folder(base: string, token: string, project: number, id: number, locale: string) {
  const data = await call(base, token, `/DevSpecAPI/ReqFolder?ProjectID=${project}&FolderID=${id}`, locale)
  return { shape: readFolder(data), raw: record(data) ? data : {} }
}

/** Your access to a folder, 0 to 4: 2 can edit it, 3 can add folders. */
export async function access(base: string, token: string, project: number, id: number, locale: string) {
  const data = await call(base, token, "/DevSpecAPI/AccessControl", locale, {
    ProjectID: project,
    FolderID: id,
    ViewType: 402,
    IsFolderAccess: 1,
  })
  return Number(typeof data === "string" ? data.replace(/"/g, "") : data) || 0
}

function fields(next: Shape) {
  return {
    "Folder Name": next.name.trim(),
    "Folder Description": next.html,
    PlanStartDate: next.start,
    PlanEndDate: next.end,
    TypeID: next.type,
    RoadMapMonthStart: roadmap(next.type) ? next.from : "",
    RoadMapMonthEnd: roadmap(next.type) ? next.to : "",
    EnableRoadMapMonth: next.type ? 1 : 0,
  }
}

/** Saves an edit, sending back what was read with the dialog's fields on top, as P1's dialog does. */
export function edited(project: number, id: number, raw: Record<string, unknown>, next: Shape) {
  return {
    ProjectID: project,
    FolderID: id,
    CustomerServiceType: raw.CustomerServiceType ?? "",
    EnableServiceContract: raw.EnableServiceContract ? 1 : 0,
    CustomerID: raw.CustomerID ?? "",
    LinkedReqTemplateName: raw.LinkedReqTemplateName ?? "",
    LinkedReqTemplateID: raw.LinkedReqTemplateID ?? 0,
    ApplicableSpecTypes: raw.ApplicableSpecTypes ?? "",
    DefaultSpecType: raw.DefaultSpecType ?? "",
    ApplyToChild: raw.ApplyToChild ?? 0,
    ...(next.type === 37 ? { ProductServiceStatusID: raw.ProductServiceStatusID ?? 0 } : {}),
    ...fields(next),
    "Folder Status": next.open ? "Open" : "Close",
  }
}

export function made(project: number, at: number, place: Place, next: Shape) {
  return {
    ProjectID: project,
    ParentFolderID: at,
    position: place,
    CustomerServiceType: "",
    LinkedReqTemplateName: "",
    LinkedReqTemplateID: 0,
    ApplicableSpecTypes: "",
    DefaultSpecType: "",
    ApplyToChild: 0,
    ...fields(next),
  }
}

export async function save(base: string, token: string, body: Record<string, unknown>, locale: string) {
  const data = await call(base, token, "/DevSpecAPI/ReqFolder", locale, body, "PUT")
  // P1 can answer 200 with a Message when it refuses.
  if (record(data) && typeof data.Message === "string" && data.Message) throw new Error(data.Message)
}

/** Creates a folder and returns its id. */
export async function add(base: string, token: string, body: Record<string, unknown>, locale: string) {
  const data = await call(base, token, "/DevSpecAPI/ReqFolder", locale, body)
  if (record(data) && typeof data.Message === "string" && data.Message) throw new Error(data.Message)
  const id = Number(typeof data === "string" ? data.replace(/"/g, "") : data) || 0
  if (!id) throw new Error("P1 didn't return the new folder")
  return id
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
