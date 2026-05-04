import {
  ADDON_UTM_CAMPAIGN,
  ADDON_UTM_SOURCE,
  LARGE_DOCUMENT_PERFORMANCE_HASH,
  LIMITATIONS_PATH,
  SITE_BASE_URL,
} from "./constants";

export const composeAddonSiteUrl = (
  path: `/${string}`,
  medium: string,
  hash?: string,
): string => {
  const anchor = hash ? `#${hash}` : "";
  return `${SITE_BASE_URL}${path}?utm_source=${ADDON_UTM_SOURCE}&utm_medium=${medium}&utm_campaign=${ADDON_UTM_CAMPAIGN}${anchor}`;
};

export const composeLargeDocumentPerformanceUrl = (medium: string): string =>
  composeAddonSiteUrl(
    LIMITATIONS_PATH,
    medium,
    LARGE_DOCUMENT_PERFORMANCE_HASH,
  );
