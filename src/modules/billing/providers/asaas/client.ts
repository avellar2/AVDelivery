import "server-only";

import { AsaasConfigurationError as ConfigError, resolveAsaasConfig } from "./config";
import { AsaasClientCore } from "./client-core";

export { AsaasClientCore } from "./client-core";
export { AsaasError, isAsaasError } from "./errors";
export { centsToAsaasValue, asaasValueToCents, formatSaoPauloDate } from "./money";
export { AsaasConfigurationError, getAsaasConfigurationStatus } from "./config";

/**
 * Server-only factory. There is deliberately no browser entry point for this
 * module: the API key never reaches client components or public bundles.
 */
export function createAsaasClient(): AsaasClientCore {
  const config = resolveAsaasConfig();

  if (!config) {
    throw new ConfigError(
      "A integração com o Asaas Sandbox ainda não está configurada no servidor.",
    );
  }

  return new AsaasClientCore(config);
}
