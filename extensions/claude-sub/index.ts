import { anthropicMessagesApi, type Model } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterPayloadHook } from "./core";

export default function (pi: ExtensionAPI) {
  const streamSimple = anthropicMessagesApi().streamSimple;

  // Keep Pi's provider, models, OAuth login/refresh, API-key auth, and transport.
  // Unlike before_provider_request, this seam also covers built-in compaction.
  pi.registerProvider("anthropic", {
    api: "anthropic-messages",
    streamSimple(model, context, options) {
      // Do not even wrap the payload callback for API-key requests.
      if (model.provider !== "anthropic" || !options?.apiKey?.startsWith("sk-ant-oat")) {
        return streamSimple(model as Model<"anthropic-messages">, context, options);
      }
      return streamSimple(model as Model<"anthropic-messages">, context, {
        ...options,
        onPayload: (payload, payloadModel) =>
          afterPayloadHook(payload, payloadModel, options?.onPayload, options?.apiKey),
      });
    },
  });
}
