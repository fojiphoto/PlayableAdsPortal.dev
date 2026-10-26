export interface Network {
  id: string;
  name: string;
  format: string;
  maxSizeBytes: number;
  orientation: string;
  usesMraid: boolean;
  ext: string;
  notes?: string;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface PackResultView {
  network: string;
  networkName: string;
  filename: string;
  format: string;
  sizeBytes: number;
  maxSizeBytes: number;
  sizeLabel: string;
  ok: boolean;
  validation: ValidationIssue[];
}

export interface AuthUser {
  id: string;
  email: string;
}

export interface App {
  id: string;
  name: string;
  platform?: string | null;
  createdAt: string;
  conceptCount?: number;
}

export interface Concept {
  id: string;
  name: string;
  appId: string;
  createdAt: string;
}

export interface CreativeRef {
  id: string;
  name: string;
  entry: string;
  createdAt: string;
}

export interface CreativeSummary {
  id: string;
  name: string;
  entry: string;
  fileCount: number;
  conceptId: string;
  createdAt: string;
}

export interface CreativeDetail {
  id: string;
  name: string;
  entry: string;
  conceptId: string;
  createdAt: string;
  exports: PackResultView[];
}
