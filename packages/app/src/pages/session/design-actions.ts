// One-click requests in the Design tab's chat. Each prompt is sent as-is to the Design agent with the open
// doc attached; edit the wording here.
export const ACTIONS = [
  {
    id: "improve",
    label: "design.action.improve",
    prompt: (doc: string) =>
      `Improve the writing in the design doc \`${doc}\`. Make it clearer and more concise, fix grammar and awkward phrasing, and make headings and terms consistent. Keep its meaning, structure and language, and do not add new content.`,
  },
  {
    id: "fill",
    label: "design.action.fill",
    prompt: (doc: string) =>
      `Fill in the missing sections of \`${doc}\`. Compare it with what a complete design doc for this topic needs, such as overview, goals and non-goals, requirements, architecture, data model, API, error handling, security, testing, rollout and open questions. Add only the sections that are missing or empty, based on the existing content and the project code, and list anything you cannot determine under open questions.`,
  },
  {
    id: "review",
    label: "design.action.review",
    prompt: (doc: string) =>
      `Review \`${doc}\` for gaps and risks. Add a "Review notes" section at the end as a task list of concrete issues: missing requirements, unclear decisions, edge cases, failure modes, security and performance risks, and anything that contradicts the project code. Leave the rest of the doc unchanged.`,
  },
  {
    id: "diagram",
    label: "design.action.diagram",
    prompt: (doc: string) =>
      `Add a mermaid diagram to \`${doc}\` that shows the most important flow or structure it describes. Pick the best type (flowchart, sequenceDiagram, erDiagram, classDiagram or stateDiagram-v2), put it in the section it illustrates, and add a one-line caption.`,
  },
  {
    id: "table",
    label: "design.action.table",
    prompt: (doc: string) =>
      `In \`${doc}\`, turn list-like content that would read better as a table (fields, endpoints, options, comparisons) into GitHub-flavoured markdown tables with a header row. Keep everything else as it is.`,
  },
  {
    id: "code",
    label: "design.action.code",
    prompt: (doc: string) =>
      `Write or update \`${doc}\` from the project code. Read the relevant source files first, then describe how the code works today: purpose, main components and their responsibilities, data model, APIs and key flows, with a mermaid diagram of the main flow. Keep sections the user wrote by hand, and correct facts that no longer match the code.`,
  },
] as const
