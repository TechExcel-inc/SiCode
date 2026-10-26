declare module "turndown-plugin-gfm" {
  import type TurndownService from "turndown"
  export const gfm: TurndownService.Plugin
  export const tables: TurndownService.Plugin
  export const taskListItems: TurndownService.Plugin
  export const strikethrough: TurndownService.Plugin
  export const highlightedCodeBlock: TurndownService.Plugin
}

declare module "mammoth/mammoth.browser.js" {
  import mammoth from "mammoth"
  export default mammoth
}
