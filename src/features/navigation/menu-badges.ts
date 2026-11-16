import type { SQLiteDatabase } from 'expo-sqlite';

import { getBackupStatus } from '@/features/backup/backup-repository';

/** Counts shown beside side-menu sections: unfinished drafts, and whether a backup is due. */
export type MenuBadges = {
  serviceReportDrafts: number;
  quotationDrafts: number;
  deliveryDrafts: number;
  statementDrafts: number;
  backupDue: boolean;
};

type DraftCounts = {
  serviceReports: number;
  quotations: number;
  deliveries: number;
  statements: number;
};

export async function getMenuBadges(db: SQLiteDatabase): Promise<MenuBadges> {
  const [counts, backup] = await Promise.all([
    db.getFirstAsync<DraftCounts>(
      `SELECT
         (SELECT COUNT(*) FROM service_reports WHERE document_state = 'draft') AS serviceReports,
         (SELECT COUNT(*) FROM quotations WHERE document_state = 'draft') AS quotations,
         (SELECT COUNT(*) FROM deliveries WHERE document_state = 'draft') AS deliveries,
         (SELECT COUNT(*) FROM billing_statements WHERE document_state = 'draft') AS statements`,
    ),
    getBackupStatus(db),
  ]);

  return {
    serviceReportDrafts: counts?.serviceReports ?? 0,
    quotationDrafts: counts?.quotations ?? 0,
    deliveryDrafts: counts?.deliveries ?? 0,
    statementDrafts: counts?.statements ?? 0,
    backupDue: backup.noticeDue,
  };
}

/**
 * Screens that show a document page or a drawing pad need the full width,
 * so the side menu steps aside while they are open.
 */
export function hidesSideMenu(pathname: string): boolean {
  return /\/preview$/.test(pathname) || pathname === '/signatures/capture';
}
