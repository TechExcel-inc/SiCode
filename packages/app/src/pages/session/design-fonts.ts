// The open fonts SiCode ships for UI designs (SIL Open Font License, from @fontsource). Screens run in a
// sandbox with no network, so each font a screen names is handed to it as a data URL.
import inter4 from "@fontsource/inter/files/inter-latin-400-normal.woff2?url"
import inter5 from "@fontsource/inter/files/inter-latin-500-normal.woff2?url"
import inter6 from "@fontsource/inter/files/inter-latin-600-normal.woff2?url"
import inter7 from "@fontsource/inter/files/inter-latin-700-normal.woff2?url"
import sans4 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?url"
import sans5 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2?url"
import sans6 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?url"
import sans7 from "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2?url"
import mono4 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url"
import mono6 from "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url"
import serif4 from "@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2?url"
import serif6 from "@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2?url"
import serif7 from "@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2?url"

const FAMILIES = [
  { name: "Inter", test: /\bInter\b/, files: { 400: inter4, 500: inter5, 600: inter6, 700: inter7 } },
  { name: "IBM Plex Sans", test: /IBM Plex Sans/i, files: { 400: sans4, 500: sans5, 600: sans6, 700: sans7 } },
  { name: "IBM Plex Mono", test: /IBM Plex Mono/i, files: { 400: mono4, 600: mono6 } },
  { name: "Source Serif 4", test: /Source Serif/i, files: { 400: serif4, 600: serif6, 700: serif7 } },
]

const cache = new Map<string, Promise<string>>()

const data = (url: string) => {
  const hit = cache.get(url)
  if (hit) return hit
  const next = fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => resolve("")
          reader.readAsDataURL(blob)
        }),
    )
    .catch(() => "")
  cache.set(url, next)
  return next
}

/** @font-face rules for the bundled fonts a screen uses, with the files inlined. */
export async function fonts(html: string) {
  const rules = await Promise.all(
    FAMILIES.filter((family) => family.test.test(html)).flatMap((family) =>
      Object.entries(family.files).map(async ([weight, url]) => {
        const src = await data(url)
        if (!src) return ""
        return `@font-face{font-family:"${family.name}";font-style:normal;font-weight:${weight};font-display:swap;src:url(${src}) format("woff2")}`
      }),
    ),
  )
  return rules.join("")
}
