import { describe, expect, test } from "bun:test"
import { googleCatalog } from "../src/credential/provider-snapshot"

describe("provider snapshots", () => {
  test("turns Google models.list JSON into token limits without an rpm field", () => {
    const models = googleCatalog([
      {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
            supportedGenerationMethods: ["generateContent"],
          },
        ],
      },
    ])

    expect(models).toEqual([
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
      },
    ])
    expect(models[0] && "rpm" in models[0]).toBe(false)
  })
})
