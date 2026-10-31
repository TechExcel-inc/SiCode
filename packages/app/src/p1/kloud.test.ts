import { describe, expect, test } from "bun:test"
import { readKloud, readLinks, unique, viewer } from "./kloud"

describe("p1 kloud", () => {
  test("reads P1's link to Kloud, and none when it has no Kloud server", () => {
    const found = readKloud({
      Success: true,
      Data: {
        SubSystemId: 6708,
        KloudServer: {
          SubDomain_PeertimeApi: "api.kloud.cn",
          SubDomain_KloudWeb: "kloud.cn",
          SubDomain_MeetingApi: "wss.kloud.cn",
        },
      },
    })
    expect(found).toEqual({ company: 6708, api: "https://api.kloud.cn/peertime/V1/", web: "https://kloud.cn/" })
    expect(readKloud({ Data: { SubSystemId: 6708, KloudServer: "" } })).toBeUndefined()
    // P1's formal Kloud sites use company 6708, whatever the server reports.
    expect(
      readKloud(
        {
          Data: {
            SubSystemId: 190961,
            KloudServer: { SubDomain_PeertimeApi: "api.peertime.cn", SubDomain_KloudWeb: "kloud.cn" },
          },
        },
        "https://jiaxing.devsuite.cn",
      )?.company,
    ).toBe(6708)
    expect(
      readKloud({ Data: { SubSystemId: 0, KloudServer: { SubDomain_PeertimeApi: "a", SubDomain_KloudWeb: "b" } } }),
    ).toBeUndefined()
  })

  test("binds a file version to its Kloud document and opens it in LiveDoc's viewer", () => {
    expect(unique(9128, 24117, 55, 2)).toBe("projectOne+9128+24117+55+2")
    expect(
      readLinks({
        RetCode: 0,
        RetData: [
          { UniqueID: "projectOne+9128+24117+55+2", AttachmentID: 2462508, SyncCount: 1 },
          { UniqueID: "projectOne+9128+24117+56+1", AttachmentID: 0 },
        ],
      }),
    ).toEqual({ "projectOne+9128+24117+55+2": 2462508 })
    // Opened straight on Kloud's lesson for the document, so LiveDoc shows the viewer once.
    expect(
      viewer({ company: 1, api: "", web: "https://kloud.cn/" }, "t k", 8812, 2462508, "Logoff Issue.docx", "en"),
    ).toBe(
      "https://kloud.cn/docview/8812?languageid=1&title=Logoff%20Issue.docx&needClearSessionStorage=1&Type=2462508&token=t%20k",
    )
  })
})
