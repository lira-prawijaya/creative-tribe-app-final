import { BossReportColorStatus } from './bossReport';
import {
  colorToDbStatusFields,
  normalizeStatusToColor,
  StatusWarna,
} from './statusWarna';

export type ProjectionManualSection = 'INVESTMENT' | 'PROJECT_COST';

export interface ProjectionManualItem {
  id: string;
  periode: string; // YYYY-MM e.g. '2026-12'
  section: ProjectionManualSection;
  namaItem: string;
  nominal: number;
  keterangan: string;
  projectId?: string;
  projectName?: string;
  vendor?: string;
  statusWarna: StatusWarna;
  color: BossReportColorStatus;
  createdBy: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectionManualItemInput {
  periode: string;
  section: ProjectionManualSection;
  namaItem: string;
  nominal: number;
  keterangan?: string;
  projectId?: string;
  projectName?: string;
  vendor?: string;
  statusWarna?: StatusWarna;
  color?: BossReportColorStatus;
  createdBy?: string;
}

export function normalizeProjectionManualSection(raw: unknown): ProjectionManualSection {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'PROJECT_COST' || s === 'PROJECTCOST') {
    return 'PROJECT_COST';
  }
  return 'INVESTMENT';
}

export function resolveProjectionManualColor(
  statusWarna?: unknown,
  color?: unknown
): { color: BossReportColorStatus; statusWarna: StatusWarna } {
  const normalizedColor = normalizeStatusToColor(
    typeof color === 'string' ? color : undefined,
    typeof statusWarna === 'string' ? statusWarna : undefined
  );
  return {
    color: normalizedColor,
    statusWarna: colorToDbStatusFields(normalizedColor).statusWarna,
  };
}
