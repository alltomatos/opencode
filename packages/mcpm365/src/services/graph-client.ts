import { ConfidentialClientApplication, PublicClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";
import type { M365Config } from "./schemas/config.schema.js";

let graphClientInstance: Client | null = null;
let currentConfig: M365Config | null = null;

export async function getGraphClient(config: M365Config): Promise<Client> {
  if (graphClientInstance && currentConfig === config) {
    return graphClientInstance;
  }

  currentConfig = config;

  if (config.auth.type === "client_credentials") {
    const cca = new ConfidentialClientApplication({
      auth: {
        clientId: config.auth.clientId,
        clientSecret: config.auth.clientSecret,
        authority: `https://login.microsoftonline.com/${config.auth.tenantId}`,
      },
    });

    graphClientInstance = Client.init({
      authProvider: async (done) => {
        try {
          const result = await cca.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"],
          });
          done(null, result?.accessToken || "");
        } catch (error) {
          done(error as Error, "");
        }
      },
    });

    return graphClientInstance;
  }

  // Device code / interactive flow
  const pca = new PublicClientApplication({
    auth: {
      clientId: config.auth.clientId,
      authority: `https://login.microsoftonline.com/${config.auth.tenantId || "common"}`,
    },
  });

  const scopes = config.auth.scopes;

  graphClientInstance = Client.init({
    authProvider: async (done) => {
      try {
        const tokenResponse = await pca.acquireTokenByDeviceCode({
          deviceCodeCallback: (response) => {
            console.error(response.message);
          },
          scopes,
        });
        done(null, tokenResponse?.accessToken || "");
      } catch (error) {
        done(error as Error, "");
      }
    },
  });

  return graphClientInstance;
}

export function getBasePath(config: M365Config): string {
  if (config.auth.type === "client_credentials" && config.auth.userPrincipalName) {
    return `/users/${config.auth.userPrincipalName}`;
  }
  return config.auth.type === "client_credentials" ? "/users" : "/me";
}
