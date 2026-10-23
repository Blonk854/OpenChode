import { Credential } from "@opencode/schema/credential"
import { CredentialQuota } from "@opencode/schema/credential-quota"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { ConflictError, CredentialNotFoundError, InvalidRequestError } from "../errors.js"

export const CredentialGroup = HttpApiGroup.make("server.credential")
  .add(
    HttpApiEndpoint.get("credential.list", "/api/credential", {
      success: Schema.Struct({ data: Schema.Array(Credential.Entry) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.list",
        summary: "List credentials",
        description: "List every stored integration credential, including its secret value.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("credential.create", "/api/credential", {
      payload: Credential.CreateInput,
      success: Schema.Struct({ data: Credential.Entry }),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.create",
        summary: "Create credential",
        description:
          "Store an integration credential. It becomes the integration's active credential unless activate is false and the integration already has one. Fails with a conflict when the requested ID already exists.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("credential.update", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      payload: Schema.Struct({ label: Schema.String }),
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "credential.update",
          summary: "Update credential",
          description: "Update a stored credential label.",
        }),
      ),
  )
  .annotateMerge(OpenApi.annotations({ title: "credential" }))
  .add(
    HttpApiEndpoint.post("credential.activate", "/api/credential/:credentialID/activate", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "credential.activate",
          summary: "Activate credential",
          description: "Activate a stored integration credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("credential.remove", "/api/credential/:credentialID", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(
        OpenApi.annotations({
          identifier: "credential.remove",
          summary: "Remove credential",
          description: "Remove a stored integration credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("credential.usage", "/api/usage", {
      success: CredentialQuota.Report,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.usage",
        summary: "List quota usage",
        description: "Monthly quota usage for stored credentials. The payload has labels and totals only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("credential.refresh", "/api/usage/refresh", {
      success: CredentialQuota.Report,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.refresh",
        summary: "Refresh provider usage",
        description:
          "Reads Google model limits and OpenRouter credit for stored API keys, then returns the usage report. The payload has labels and totals only.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("credential.limit", "/api/credential/:credentialID/limit", {
      params: { credentialID: Credential.ID },
      payload: Schema.Struct({ limit: Schema.NullOr(CredentialQuota.Limit) }),
      success: HttpApiSchema.NoContent,
      error: [CredentialNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.limit",
        summary: "Set credential limit",
        description: "Set or clear the monthly quota limit for one stored API key. Null clears the limit.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("credential.unblock", "/api/credential/:credentialID/block", {
      params: { credentialID: Credential.ID },
      success: HttpApiSchema.NoContent,
      error: CredentialNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "credential.unblock",
        summary: "Unblock credential",
        description: "Clear a quota block on a stored credential.",
      }),
    ),
  )
