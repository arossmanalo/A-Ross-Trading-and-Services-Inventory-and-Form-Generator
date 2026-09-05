import { mkdirSync, writeFileSync } from 'node:fs';

import { buildCsrHtml, type CsrRenderSnapshot } from '../src/features/service-reports/csr-template.ts';

const repeated = Array.from({ length: 28 }, (_, index) => `Detailed service note ${index + 1}: inspection and corrective work completed for the customer equipment.`);
const snapshot: CsrRenderSnapshot = {
  csrNumber: 'CSR-000042',
  businessDate: '2026-09-06',
  fingerprint: '8F12A09C4D31',
  business: {
    name: 'A.Ross Trading and Services',
    address: 'Candelaria, Quezon',
    contactDetails: '(0917) 5794065 | arosstradingandservices@gmail.com',
  },
  customer: { name: 'C & C Laundry', address: 'Lucban, Quezon' },
  equipment: {
    machineType: 'Industrial Washing Machine',
    model: 'AR-WM-800',
    serialNumber: 'SAMPLE-2026-001',
    nicknameOrLocation: 'Main laundry area',
  },
  serviceOutcome: 'under_observation',
  reportedProblem: repeated,
  diagnosis: repeated.slice(0, 5),
  actionTaken: repeated.slice(0, 6),
  recommendations: repeated.slice(0, 4),
  billing: ['Parts and materials are billable.', 'Service labor billed separately.'],
  customerRemarks: ['Unit accepted for continued observation.'],
  machineStatus: 'Operational after testing; monitor the replaced assembly for seven days.',
  warrantyText: 'Warranty terms are recorded by the owner for this specific service visit.',
  servicedBy: 'Aryl Ross A. Manalo',
  acknowledgedBy: 'Customer Representative',
  totalBillCentavos: 1327500,
  usages: [
    { description: 'Liquid Detergent', quantity: 7, unitLabel: 'carboy', billable: true },
    { description: 'Workshop cleaning material', quantity: 2, unitLabel: 'pc', billable: false },
  ],
};

mkdirSync('tmp/pdfs', { recursive: true });
writeFileSync('tmp/pdfs/csr-fixture.html', buildCsrHtml(snapshot), 'utf8');
