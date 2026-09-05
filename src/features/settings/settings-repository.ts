import type { SQLiteDatabase } from 'expo-sqlite';

import { appendAuditEvent, incrementDatabaseRevision } from '@/db/revision';
import type { BusinessSettings } from '@/features/settings/settings-types';

type SettingsRow = {
  business_name: string;
  business_address: string;
  contact_details: string;
  owner_name: string;
  low_stock_notifications_enabled: number;
};

export async function getBusinessSettings(db: SQLiteDatabase): Promise<BusinessSettings> {
  const row = await db.getFirstAsync<SettingsRow>(
    `SELECT business_name, business_address, contact_details, owner_name,
            low_stock_notifications_enabled
     FROM settings
     WHERE id = 'business'`,
  );
  if (!row) throw new Error('Business settings are missing.');
  return {
    businessName: row.business_name,
    businessAddress: row.business_address,
    contactDetails: row.contact_details,
    ownerName: row.owner_name,
    lowStockNotificationsEnabled: row.low_stock_notifications_enabled === 1,
  };
}

export async function updateBusinessSettings(
  db: SQLiteDatabase,
  input: BusinessSettings,
): Promise<void> {
  const businessName = input.businessName.trim().replace(/\s+/g, ' ');
  if (!businessName) throw new Error('Business name is required.');
  const now = new Date().toISOString();

  await db.withExclusiveTransactionAsync(async (tx) => {
    const result = await tx.runAsync(
      `UPDATE settings
       SET business_name = ?, business_address = ?, contact_details = ?, owner_name = ?,
           low_stock_notifications_enabled = ?, updated_at = ?
       WHERE id = 'business'`,
      businessName,
      input.businessAddress.trim(),
      input.contactDetails.trim(),
      input.ownerName.trim(),
      input.lowStockNotificationsEnabled ? 1 : 0,
      now,
    );
    if (result.changes !== 1) throw new Error('Business settings are missing.');

    await appendAuditEvent(tx, {
      eventType: 'settings.updated',
      entityType: 'settings',
      entityId: 'business',
      details: { lowStockNotificationsEnabled: input.lowStockNotificationsEnabled },
      createdAt: now,
    });
    await incrementDatabaseRevision(tx);
  });
}
