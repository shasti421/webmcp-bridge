/**
 * Registry type definitions.
 */
export interface RegistryEntry {
  appId: string;
  name: string;
  description: string;
  publisher: string;
  tags: string[];
  license: string;
  versions: RegistryVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface RegistryVersion {
  version: string;
  publishedAt: string;
  pagesCount: number;
  toolsCount: number;
  workflowsCount: number;
  checksum: string;
}

export interface RegistrySearchResult {
  entries: RegistryEntry[];
  total: number;
  page: number;
  pageSize: number;
}
