// Integration Hub — Registry
// All integrations register here. Adding a new one = import + one line.

import type { ExternalIntegration, IntegrationMeta } from './types';
import { MondayIntegration } from './monday';
import { QuickBooksIntegration } from './quickbooks';
import { SalesforceIntegration } from './salesforce';

// Central map: integration_id → implementation
const integrationMap = new Map<string, ExternalIntegration<unknown, unknown>>([
  ['monday',      new MondayIntegration()],
  ['quickbooks',  new QuickBooksIntegration()],
  ['salesforce',  new SalesforceIntegration()],
]);

export function getIntegration(id: string): ExternalIntegration<unknown, unknown> | undefined {
  return integrationMap.get(id);
}

export function listIntegrations(): IntegrationMeta[] {
  return Array.from(integrationMap.values()).map(i => i.meta);
}

export function registerIntegration(integration: ExternalIntegration<unknown, unknown>): void {
  if (integrationMap.has(integration.meta.id)) {
    console.warn(`[IntegrationHub] Overwriting existing integration: ${integration.meta.id}`);
  }
  integrationMap.set(integration.meta.id, integration);
}
